//! Pure, bounded rename evaluation. No filesystem, network, shell or model access.
use crate::{
    files::{Change, Entry},
    rules::{valid_date, Rule},
    Result,
};
use chrono::{DateTime, Datelike, FixedOffset, NaiveDate, Timelike};
use regex::{Captures, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;

pub const SCHEMA: &str = include_str!("../rule-schema.json");
const MAX_TEXT: usize = 4096;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Step {
    pub id: String,
    pub enabled: bool,
    pub rule: Rule,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub sort: String,
    pub descending: bool,
    pub extension_mode: String,
    pub reference_date: String,
    pub timezone_offset: i32,
    #[serde(default)]
    pub trace_id: Option<String>,
    #[serde(default)]
    pub timezone_offsets: HashMap<String, i32>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scheme {
    pub sort: String,
    pub descending: bool,
    pub extension_mode: String,
}
impl Scheme {
    pub fn validate(&self) -> Result<()> {
        if !matches!(
            self.sort.as_str(),
            "input" | "natural" | "name" | "modified" | "size"
        ) || !matches!(self.extension_mode.as_str(), "last" | "compound")
        {
            Err("方案排序或扩展名选项无效".into())
        } else {
            Ok(())
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Example {
    pub id: String,
    pub expected: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Trace {
    pub id: String,
    pub before: String,
    pub after: String,
    pub fields: BTreeMap<String, String>,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Detail {
    pub id: String,
    pub name: String,
    pub status: String,
    pub unmatched: bool,
    pub error: Option<String>,
    pub trace: Vec<Trace>,
}
#[derive(Clone, Debug, Serialize)]
pub struct ExampleResult {
    pub id: String,
    pub expected: String,
    pub actual: Option<String>,
    pub passed: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct Report {
    pub changes: Vec<Change>,
    pub details: Vec<Detail>,
    pub examples: Vec<ExampleResult>,
}

fn exact(v: &Value, keys: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|m| m.len() == keys.len() && keys.iter().all(|k| m.contains_key(*k)))
}
fn string<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn integer(v: &Value, key: &str) -> i64 {
    v[key].as_i64().unwrap_or(0)
}
fn boolean(v: &Value, key: &str) -> bool {
    v[key].as_bool().unwrap_or(false)
}
fn regex(pattern: &str, sensitive: bool) -> Result<Regex> {
    if pattern.len() > MAX_TEXT || pattern.is_empty() {
        return Err("表达式不能为空或超过 4096 字节".into());
    }
    RegexBuilder::new(pattern)
        .case_insensitive(!sensitive)
        .size_limit(1_000_000)
        .dfa_size_limit(1_000_000)
        .build()
        .map_err(|_| "正则无效或超出资源限制；不支持环视和模式内反向引用".into())
}
fn fragment(value: &str) -> Result<()> {
    if value.len() > MAX_TEXT
        || value
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        Err("名称参数包含非法字符或过长".into())
    } else {
        Ok(())
    }
}
pub fn validate_condition(c: &Value, depth: usize) -> Result<()> {
    if depth > 4 {
        return Err("条件最多嵌套 4 层".into());
    }
    match string(c, "kind") {
        "test" if exact(c, &["kind", "field", "operator", "value", "negate"]) => {
            let field = string(c, "field");
            if !(matches!(field, "name" | "original" | "extension" | "parent")
                || field
                    .strip_prefix("field:")
                    .is_some_and(|f| !f.is_empty() && f.len() <= 128))
                || !matches!(
                    string(c, "operator"),
                    "contains" | "starts" | "ends" | "equals" | "regex" | "exists"
                )
                || !c["negate"].is_boolean()
                || c["value"].as_str().is_none_or(|v| v.len() > MAX_TEXT)
            {
                return Err("条件参数无效".into());
            }
            if string(c, "operator") == "regex" {
                regex(string(c, "value"), true)?;
            }
        }
        "all" | "any" if exact(c, &["kind", "conditions"]) => {
            let list = c["conditions"].as_array().ok_or("条件列表无效")?;
            if list.is_empty() || list.len() > 8 {
                return Err("每组条件需要 1–8 项".into());
            }
            for item in list {
                validate_condition(item, depth + 1)?;
            }
        }
        "not" if exact(c, &["kind", "condition"]) => {
            validate_condition(&c["condition"], depth + 1)?
        }
        _ => return Err("不支持的条件或额外字段".into()),
    }
    Ok(())
}
pub fn validate_rule(rule: &Rule, depth: usize, allow_names: bool) -> Result<()> {
    if depth > 4 {
        return Err("分支最多嵌套 4 层".into());
    }
    match rule {
        Rule::Expression(p) => {
            let schema: Vec<Value> = serde_json::from_str(SCHEMA).map_err(|_| "规则定义不可用")?;
            let def = schema
                .iter()
                .find(|d| d["op"] == p["op"])
                .ok_or("未知表达式类型")?;
            let fields = def["fields"].as_array().unwrap();
            if !p.as_object().is_some_and(|m| m.len() == fields.len() + 1) {
                return Err("规则包含未知或缺失参数".into());
            }
            for field in fields {
                let key = string(field, "key");
                let value = &p[key];
                match string(field, "type") {
                    "text" => {
                        if value.as_str().is_none_or(|s| s.len() > MAX_TEXT) {
                            return Err(format!("{key} 文字无效或过长"));
                        }
                    }
                    "bool" => {
                        if !value.is_boolean() {
                            return Err(format!("{key} 必须为布尔值"));
                        }
                    }
                    "number" => {
                        if value
                            .as_i64()
                            .is_none_or(|n| n < integer(field, "min") || n > integer(field, "max"))
                        {
                            return Err(format!("{key} 数值超出范围"));
                        }
                    }
                    "enum" => {
                        if !field["options"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|o| o[0] == *value)
                        {
                            return Err(format!("{key} 选项无效"));
                        }
                    }
                    "condition" => validate_condition(value, 0)?,
                    "pairs" => {
                        let pairs = value.as_array().ok_or("映射表无效")?;
                        if pairs.is_empty() || pairs.len() > 256 {
                            return Err("映射表需要 1–256 项".into());
                        }
                        let mut seen = HashSet::new();
                        for pair in pairs {
                            if !exact(pair, &["from", "to"])
                                || pair["from"]
                                    .as_str()
                                    .is_none_or(|s| s.is_empty() || s.len() > MAX_TEXT)
                                || pair["to"].as_str().is_none()
                                || !seen.insert(string(pair, "from"))
                            {
                                return Err("映射含空值、重复来源或额外字段".into());
                            }
                            fragment(string(pair, "to"))?;
                        }
                    }
                    "rules" => {
                        let rules: Vec<Rule> =
                            serde_json::from_value(value.clone()).map_err(|_| "分支规则无效")?;
                        if rules.len() > 16 {
                            return Err("每个分支最多 16 条规则".into());
                        }
                        for child in &rules {
                            validate_rule(child, depth + 1, allow_names)?;
                        }
                    }
                    _ => return Err("规则定义无效".into()),
                }
            }
            match string(p, "op") {
                "replace" => {
                    let re = regex(
                        &if boolean(p, "regex") {
                            string(p, "pattern").to_string()
                        } else {
                            regex::escape(string(p, "pattern"))
                        },
                        boolean(p, "caseSensitive"),
                    )?;
                    if boolean(p, "regex") {
                        validate_replacement(string(p, "replacement"), &re)?;
                    } else {
                        fragment(string(p, "replacement"))?;
                    }
                }
                "extract" => {
                    regex(string(p, "pattern"), true)?;
                }
                "split" if string(p, "separator").is_empty() => {
                    return Err("字段分隔符不能为空".into())
                }
                "edit" => {
                    if matches!(string(p, "anchor"), "before" | "after")
                        && string(p, "marker").is_empty()
                    {
                        return Err("请填写定位文字".into());
                    }
                    fragment(string(p, "text"))?;
                }
                "sequence" => {
                    if string(p, "position") != "replace" {
                        fragment(string(p, "separator"))?;
                    }
                    if string(p, "group") == "field" && string(p, "field").is_empty() {
                        return Err("请填写分组字段".into());
                    }
                }
                "template" => {
                    template_tokens(string(p, "text"))?;
                }
                "setName" => {
                    if string(p, "text").trim().is_empty() {
                        return Err("请填写新名称".into());
                    }
                    fragment(string(p, "text"))?;
                }
                "dateFormat" => {
                    if matches!(string(p, "source"), "name" | "field") {
                        date_pattern(string(p, "input"))?;
                    }
                    if string(p, "source") == "field" && string(p, "field").is_empty() {
                        return Err("请填写日期字段".into());
                    }
                    if string(p, "mode") == "replace" && string(p, "source") != "name" {
                        return Err(
                            "替换原日期只适用于名称来源；请选择前置、后置、完整替换名称或写回字段"
                                .into(),
                        );
                    }
                    if string(p, "mode") == "field" && string(p, "field").is_empty() {
                        return Err("写回字段名不能为空".into());
                    }
                    date_output(2026, 1, 1, 0, 0, 0, string(p, "output"))?;
                    if matches!(string(p, "mode"), "prefix" | "suffix") {
                        fragment(string(p, "separator"))?;
                    }
                }
                "extension" if string(p, "action") == "set" => {
                    let ext = string(p, "text");
                    fragment(ext)?;
                    if ext.is_empty()
                        || ext.starts_with('.')
                        || ext.ends_with('.')
                        || ext.ends_with(' ')
                    {
                        return Err("扩展名不能为空或以点/空格结尾".into());
                    }
                }
                _ => {}
            }
        }
        Rule::AiNames(p) => {
            if !allow_names {
                return Err("逐文件名称必须通过独立的 suggestions 字段提交".into());
            }
            if p.names.len() > 10000 || p.reasons.len() > 10000 {
                return Err("名称映射过大".into());
            }
            for (id, name) in &p.names {
                if id.len() > 128 {
                    return Err("文件标识过长".into());
                }
                crate::files::valid_name(name)?;
            }
        }
        Rule::Prefix(p) | Rule::Suffix(p) => {
            if p.text.is_empty() {
                return Err("请填写名称文字".into());
            }
            fragment(&p.text)?;
        }
        Rule::Replace(p) => {
            if p.find.is_empty() || p.find.len() > MAX_TEXT {
                return Err("请填写查找文字".into());
            }
            fragment(&p.replacement)?;
        }
        Rule::Spaces(p) => fragment(&p.separator)?,
        Rule::Number(p) => {
            if p.start > 999999 || !(1..=6).contains(&p.digits) {
                return Err("编号参数超出范围".into());
            }
            if !matches!(p.position, crate::rules::Position::Replace) {
                fragment(&p.separator)?;
            }
        }
        Rule::Date(p) => {
            if !valid_date(&p.date) {
                return Err("日期无效".into());
            }
            if !matches!(p.position, crate::rules::Position::Replace) {
                fragment(&p.separator)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn count_rules(rule: &Rule) -> usize {
    1 + if let Rule::Expression(p) = rule {
        ["rules", "otherwise"]
            .iter()
            .filter_map(|k| p[k].as_array())
            .flatten()
            .filter_map(|v| serde_json::from_value::<Rule>(v.clone()).ok())
            .map(|r| count_rules(&r))
            .sum()
    } else {
        0
    }
}
pub fn rule_count(rules: &[Rule]) -> usize {
    rules.iter().map(count_rules).sum()
}
pub fn validate_rules(rules: &[Rule], allow_names: bool) -> Result<()> {
    if rules.len() > 64 || rule_count(rules) > 128 {
        return Err("规则总数超出限制（顶层 64，总计 128）".into());
    }
    for rule in rules {
        validate_rule(rule, 0, allow_names)?;
    }
    Ok(())
}

fn validate_replacement(text: &str, re: &Regex) -> Result<()> {
    let token = Regex::new(r"\$\{([^}]+)\}").unwrap();
    let names: HashSet<_> = re.capture_names().flatten().collect();
    for c in token.captures_iter(text) {
        if !names.contains(&c[1])
            && c[1]
                .parse::<usize>()
                .ok()
                .is_none_or(|n| n >= re.captures_len())
        {
            return Err("替换模板引用了不存在的捕获组".into());
        }
    }
    let left = token.replace_all(text, "");
    if left.contains('$') {
        return Err("捕获组请使用 ${1} / ${字段名}；字面 $ 请使用普通文字替换".into());
    }
    Ok(())
}
fn template_tokens(text: &str) -> Result<Vec<(usize, usize, String)>> {
    let mut result = Vec::new();
    let mut offset = 0;
    while let Some(start) = text[offset..].find('{') {
        let start = offset + start;
        if text[offset..start].contains('}') {
            return Err("模板括号未配对".into());
        }
        let end = start + 1 + text[start + 1..].find('}').ok_or("模板括号未配对")?;
        let key = &text[start + 1..end];
        if key.is_empty() || key.contains('{') || key.len() > 256 {
            return Err("模板变量无效".into());
        }
        result.push((start, end + 1, key.to_string()));
        offset = end + 1;
    }
    if text[offset..].contains('}') {
        return Err("模板括号未配对".into());
    }
    Ok(result)
}

pub fn split_name(name: &str, compound: bool) -> (String, String) {
    if compound {
        let lower = name.to_lowercase();
        for ext in [
            ".tar.gz",
            ".tar.bz2",
            ".tar.xz",
            ".tar.zst",
            ".tar.lz",
            ".tar.lzma",
            ".user.js",
            ".d.ts",
        ] {
            if name.len() > ext.len() && lower.ends_with(ext) {
                let at = name.len() - ext.len();
                return (name[..at].into(), name[at..].into());
            }
        }
    }
    match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].into(), name[i..].into()),
        _ => (name.into(), String::new()),
    }
}
fn natural(a: &str, b: &str) -> std::cmp::Ordering {
    static NATURAL: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = NATURAL.get_or_init(|| Regex::new(r"[0-9]+|[^0-9]+").unwrap());
    let aa: Vec<_> = re.find_iter(a).map(|m| m.as_str()).collect();
    let bb: Vec<_> = re.find_iter(b).map(|m| m.as_str()).collect();
    for (a, b) in aa.iter().zip(&bb) {
        let c = if a.as_bytes()[0].is_ascii_digit() && b.as_bytes()[0].is_ascii_digit() {
            let na = a.trim_start_matches('0');
            let nb = b.trim_start_matches('0');
            na.len()
                .cmp(&nb.len())
                .then_with(|| na.cmp(nb))
                .then_with(|| a.len().cmp(&b.len()))
        } else {
            a.to_lowercase().cmp(&b.to_lowercase())
        };
        if !c.is_eq() {
            return c;
        }
    }
    aa.len().cmp(&bb.len())
}

struct Context<'a> {
    file: &'a Entry,
    original: String,
    name: String,
    extension: String,
    fields: BTreeMap<String, String>,
    parent: String,
    parent_path: String,
    index: usize,
    unmatched: bool,
}
impl Context<'_> {
    fn full(&self) -> String {
        format!("{}{}", self.name, self.extension)
    }
}
#[derive(Default)]
struct Runtime {
    patterns: HashMap<(String, bool), Regex>,
    counters: HashMap<(String, String), i64>,
    work: usize,
}
fn replace_bounded(
    re: &Regex,
    input: &str,
    mut replacement: impl FnMut(&Captures<'_>, usize) -> Result<String>,
) -> Result<(String, usize)> {
    let mut output = String::new();
    let mut end = 0;
    let mut count = 0;
    for caps in re.captures_iter(input) {
        count += 1;
        let m = caps.get(0).unwrap();
        let value = replacement(&caps, count)?;
        if output.len() + (m.start() - end) + value.len() > MAX_TEXT {
            return Err("替换结果超过 4096 字节".into());
        }
        output.push_str(&input[end..m.start()]);
        output.push_str(&value);
        end = m.end();
    }
    if output.len() + input.len() - end > MAX_TEXT {
        return Err("替换结果超过 4096 字节".into());
    }
    output.push_str(&input[end..]);
    Ok((output, count))
}
impl Runtime {
    fn pattern(&mut self, pattern: &str, sensitive: bool) -> Result<Regex> {
        let key = (pattern.to_string(), sensitive);
        if !self.patterns.contains_key(&key) {
            self.patterns
                .insert(key.clone(), regex(pattern, sensitive)?);
        }
        Ok(self.patterns[&key].clone())
    }
}
fn condition(v: &Value, c: &Context<'_>, rt: &mut Runtime) -> Result<bool> {
    match string(v, "kind") {
        "all" => {
            for v in v["conditions"].as_array().unwrap() {
                if !condition(v, c, rt)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        "any" => {
            for v in v["conditions"].as_array().unwrap() {
                if condition(v, c, rt)? {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        "not" => Ok(!condition(&v["condition"], c, rt)?),
        _ => {
            let key = string(v, "field");
            let value = match key {
                "name" => Some(&c.name),
                "original" => Some(&c.original),
                "extension" => Some(&c.extension),
                "parent" => Some(&c.parent),
                _ => c.fields.get(key.strip_prefix("field:").unwrap_or("")),
            };
            let needle = string(v, "value");
            let matched = if string(v, "operator") == "exists" {
                value.is_some_and(|s| !s.is_empty())
            } else if let Some(value) = value {
                match string(v, "operator") {
                    "contains" => value.contains(needle),
                    "starts" => value.starts_with(needle),
                    "ends" => value.ends_with(needle),
                    "equals" => value == needle,
                    "regex" => rt.pattern(needle, true)?.is_match(value),
                    _ => false,
                }
            } else {
                false
            };
            Ok(matched != boolean(v, "negate"))
        }
    }
}
fn file_time(c: &Context<'_>, o: &Options) -> Result<DateTime<FixedOffset>> {
    let secs = i64::try_from(c.file.modified / 1_000_000_000).map_err(|_| "文件时间超出范围")?;
    let minutes = o
        .timezone_offsets
        .get(&c.file.id)
        .copied()
        .unwrap_or(o.timezone_offset);
    let offset = FixedOffset::east_opt(-minutes * 60).ok_or("时区偏移无效")?;
    DateTime::from_timestamp(secs, 0)
        .map(|d| d.with_timezone(&offset))
        .ok_or("文件时间无效".into())
}
const DATE_TOKENS: [&str; 9] = ["YYYY", "MM", "DD", "HH", "mm", "ss", "M", "D", "YY"];
fn scan_date_format(format: &str, mut token: impl FnMut(&str) -> Result<String>) -> Result<String> {
    if format.is_empty() || format.len() > 128 {
        return Err("日期格式为空或过长".into());
    }
    let mut result = String::new();
    let mut i = 0;
    while i < format.len() {
        if let Some(t) = DATE_TOKENS.iter().find(|t| format[i..].starts_with(**t)) {
            if *t == "YY" {
                return Err("请使用四位年份 YYYY，避免世纪歧义".into());
            }
            result.push_str(&token(t)?);
            i += t.len();
        } else {
            let c = format[i..].chars().next().unwrap();
            if c.is_ascii_alphabetic() {
                return Err("日期格式包含未知标记".into());
            }
            result.push(c);
            i += c.len_utf8();
        }
    }
    Ok(result)
}
fn date_pattern(format: &str) -> Result<Regex> {
    let mut seen = HashSet::new();
    let mut output = String::new();
    let mut i = 0;
    let mut variable_in_digit_run = false;
    while i < format.len() {
        if let Some(t) = DATE_TOKENS.iter().find(|t| format[i..].starts_with(**t)) {
            if matches!(*t, "M" | "D") {
                if variable_in_digit_run {
                    return Err("不定长月份和日期之间需要分隔符，或使用 MMDD 固定位数".into());
                }
                variable_in_digit_run = true;
            }
            let (key, size) = match *t {
                "YYYY" => ("y", "[0-9]{4}"),
                "MM" => ("m", "[0-9]{2}"),
                "M" => ("m", "[0-9]{1,2}"),
                "DD" => ("d", "[0-9]{2}"),
                "D" => ("d", "[0-9]{1,2}"),
                "HH" => ("h", "[0-9]{2}"),
                "mm" => ("min", "[0-9]{2}"),
                "ss" => ("s", "[0-9]{2}"),
                _ => return Err("请使用 YYYY 明确年份".into()),
            };
            if !seen.insert(key) {
                return Err("日期格式含重复字段".into());
            }
            output.push_str(&format!("(?P<{key}>{size})"));
            i += t.len();
        } else {
            let ch = format[i..].chars().next().unwrap();
            if ch.is_ascii_alphabetic() {
                return Err("日期格式含未知标记".into());
            }
            output.push_str(&regex::escape(&ch.to_string()));
            if !ch.is_ascii_digit() {
                variable_in_digit_run = false;
            }
            i += ch.len_utf8();
        }
    }
    if !["y", "m", "d"].iter().all(|k| seen.contains(k)) || format.len() > 128 {
        return Err("输入格式必须明确包含 YYYY、月和日".into());
    }
    regex(&output, true)
}
fn date_output(y: i32, m: u32, d: u32, h: u32, min: u32, s: u32, format: &str) -> Result<String> {
    let result = scan_date_format(format, |t| {
        Ok(match t {
            "YYYY" => format!("{y:04}"),
            "MM" => format!("{m:02}"),
            "DD" => format!("{d:02}"),
            "M" => m.to_string(),
            "D" => d.to_string(),
            "HH" => format!("{h:02}"),
            "mm" => format!("{min:02}"),
            "ss" => format!("{s:02}"),
            _ => return Err("日期标记无效".into()),
        })
    })?;
    fragment(&result)?;
    Ok(result)
}
fn format_time(dt: DateTime<FixedOffset>, format: &str) -> Result<String> {
    date_output(
        dt.year(),
        dt.month(),
        dt.day(),
        dt.hour(),
        dt.minute(),
        dt.second(),
        format,
    )
}
fn today(o: &Options, format: &str) -> Result<String> {
    let d = NaiveDate::parse_from_str(&o.reference_date, "%Y-%m-%d").map_err(|_| "参考日期无效")?;
    date_output(d.year(), d.month(), d.day(), 0, 0, 0, format)
}
fn render_template(text: &str, c: &Context<'_>, o: &Options) -> Result<String> {
    let tokens = template_tokens(text)?;
    let mut output = String::new();
    let mut offset = 0;
    for (start, end, key) in tokens {
        output.push_str(&text[offset..start]);
        let value = if let Some(field) = key.strip_prefix("field:") {
            c.fields
                .get(field)
                .filter(|v| !v.is_empty())
                .cloned()
                .ok_or_else(|| format!("缺少模板字段：{field}"))?
        } else {
            match key.as_str() {
                "original" => c.original.clone(),
                "name" => c.name.clone(),
                "parent" => c.parent.clone(),
                "size" => c.file.size.to_string(),
                "ext" => return Err("模板默认保留扩展名；如需改动，请添加扩展名规则".into()),
                _ => {
                    if let Some(f) = key.strip_prefix("modified:") {
                        format_time(file_time(c, o)?, f)?
                    } else if let Some(f) = key.strip_prefix("today:") {
                        today(o, f)?
                    } else {
                        c.fields
                            .get(&key)
                            .filter(|v| !v.is_empty())
                            .cloned()
                            .ok_or_else(|| format!("缺少模板字段：{key}"))?
                    }
                }
            }
        };
        output.push_str(&value);
        offset = end;
        if output.len() > MAX_TEXT {
            return Err("模板结果过长".into());
        }
    }
    output.push_str(&text[offset..]);
    Ok(output)
}
fn put_target(c: &mut Context<'_>, target: &str, text: String, o: &Options) {
    match target {
        "extension" => c.extension = text,
        "full" => {
            let (n, e) = split_name(&text, o.extension_mode == "compound");
            c.name = n;
            c.extension = e;
        }
        _ => c.name = text,
    }
}
fn apply_expression(
    p: &Value,
    c: &mut Context<'_>,
    o: &Options,
    rt: &mut Runtime,
    path: &str,
) -> Result<()> {
    match string(p, "op") {
        "replace" => {
            let pattern = if boolean(p, "regex") {
                string(p, "pattern").to_string()
            } else {
                regex::escape(string(p, "pattern"))
            };
            let re = rt.pattern(&pattern, boolean(p, "caseSensitive"))?;
            let input = match string(p, "target") {
                "extension" => c.extension.clone(),
                "full" => c.full(),
                _ => c.name.clone(),
            };
            let (result, i) = replace_bounded(&re, &input, |caps, i| {
                if integer(p, "occurrence") != 0 && i as i64 != integer(p, "occurrence") {
                    return Ok(caps[0].to_string());
                }
                if boolean(p, "regex") {
                    let token = rt.pattern(r"\$\{([^}]+)\}", true)?;
                    let (text, _) = replace_bounded(&token, string(p, "replacement"), |cap, _| {
                        cap[1]
                            .parse::<usize>()
                            .ok()
                            .and_then(|n| caps.get(n))
                            .or_else(|| caps.name(&cap[1]))
                            .map(|m| m.as_str().to_string())
                            .ok_or("替换所需捕获组未匹配".into())
                    })?;
                    Ok(text)
                } else {
                    Ok(string(p, "replacement").to_string())
                }
            })?;
            if i == 0 || (integer(p, "occurrence") > i as i64) {
                c.unmatched = true;
            }
            put_target(c, string(p, "target"), result, o);
        }
        "edit" => {
            let chars: Vec<_> = c.name.graphemes(true).collect();
            let len = chars.len();
            let pos = integer(p, "position") as usize;
            let length = integer(p, "length") as usize;
            let at = match string(p, "anchor") {
                "start" => pos,
                "end" => len.checked_sub(pos).ok_or("位置超出名称范围")?,
                a => {
                    let marker = string(p, "marker");
                    let byte = c.name.find(marker).ok_or("没有找到定位文字")?;
                    let boundary = byte + if a == "after" { marker.len() } else { 0 };
                    let mut bytes = 0;
                    let index = chars
                        .iter()
                        .position(|ch| {
                            let start = bytes;
                            bytes += ch.len();
                            start == boundary
                        })
                        .or(if boundary == c.name.len() {
                            Some(len)
                        } else {
                            None
                        })
                        .ok_or("定位文字拆开了组合字符")?;
                    index.checked_add(pos).ok_or("位置溢出")?
                }
            };
            let (start, end) = if string(p, "action") == "insert" {
                (at, at)
            } else if string(p, "anchor") == "end" {
                (at.checked_sub(length).ok_or("区间超出名称范围")?, at)
            } else {
                (at, at.checked_add(length).ok_or("区间超出名称范围")?)
            };
            if end > len || start > len {
                return Err("区间超出名称范围".into());
            }
            c.name = match string(p, "action") {
                "insert" => format!(
                    "{}{}{}",
                    chars[..start].concat(),
                    string(p, "text"),
                    chars[start..].concat()
                ),
                "remove" => format!("{}{}", chars[..start].concat(), chars[end..].concat()),
                _ => chars[start..end].concat(),
            };
        }
        "clean" => {
            let keep = string(p, "keep");
            if boolean(p, "brackets") {
                let mut stack = Vec::new();
                let mut out = String::new();
                let mut buffered = String::new();
                for ch in c.name.chars() {
                    if keep.contains(ch) {
                        if stack.is_empty() {
                            out.push(ch)
                        } else {
                            buffered.push(ch)
                        };
                        continue;
                    }
                    if let Some(end) = match ch {
                        '(' => Some(')'),
                        '（' => Some('）'),
                        '[' => Some(']'),
                        '【' => Some('】'),
                        '{' => Some('}'),
                        _ => None,
                    } {
                        stack.push(end);
                        buffered.push(ch);
                    } else if stack.last() == Some(&ch) {
                        stack.pop();
                        buffered.push(ch);
                        if stack.is_empty() {
                            buffered.clear();
                        }
                    } else if stack.is_empty() {
                        out.push(ch)
                    } else {
                        buffered.push(ch)
                    }
                }
                // An unmatched opening bracket is retained, not used to erase the rest of a name.
                out.push_str(&buffered);
                c.name = out;
            }
            if boolean(p, "copyMarkers") {
                c.name = rt
                    .pattern(
                        r"(?i)(?:[_ -]*副本|[_ -]+copy)(?:\s*[（(][0-9]+[）)])?$",
                        true,
                    )?
                    .replace(&c.name, "")
                    .into_owned();
            }
            if boolean(p, "bracketNumbers") {
                c.name = rt
                    .pattern(r"\s*[（(][0-9]+[）)]$", true)?
                    .replace(&c.name, "")
                    .into_owned();
            }
            c.name=c.name.chars().filter(|ch|keep.contains(*ch) || (!string(p,"characters").contains(*ch) && !(boolean(p,"invisible") && matches!(*ch,'\u{200b}'..='\u{200f}'|'\u{202a}'..='\u{202e}'|'\u{2060}'..='\u{206f}'|'\u{feff}')))).collect();
            if boolean(p, "spaces") {
                c.name = c.name.split_whitespace().collect::<Vec<_>>().join(" ");
            }
            let mut last = None;
            c.name = c
                .name
                .chars()
                .filter(|ch| {
                    let take = keep.contains(*ch)
                        || !(last == Some(*ch) && string(p, "separators").contains(*ch));
                    last = Some(*ch);
                    take
                })
                .collect();
        }
        "normalize" => {
            c.name = match string(p, "mode") {
                "nfc" => c.name.nfc().collect(),
                "half" => c
                    .name
                    .chars()
                    .map(|ch| match ch {
                        '\u{3000}' => ' ',
                        '\u{ff01}'..='\u{ff5e}' => char::from_u32(ch as u32 - 0xfee0).unwrap(),
                        _ => ch,
                    })
                    .collect(),
                _ => c
                    .name
                    .chars()
                    .map(|ch| match ch {
                        ' ' => '\u{3000}',
                        '!'..='~' => char::from_u32(ch as u32 + 0xfee0).unwrap(),
                        _ => ch,
                    })
                    .collect(),
            }
        }
        "letterCase" => {
            c.name = match string(p, "mode") {
                "lower" => c.name.to_lowercase(),
                "upper" => c.name.to_uppercase(),
                _ => {
                    let mut start = true;
                    let mut out = String::new();
                    for ch in c.name.chars() {
                        if ch.is_alphabetic() {
                            out.extend(if start {
                                ch.to_uppercase().collect::<Vec<_>>()
                            } else {
                                ch.to_lowercase().collect()
                            });
                            start = false;
                        } else {
                            out.push(ch);
                            start = !ch.is_numeric();
                        }
                    }
                    out
                }
            }
        }
        "extract" => {
            let re = rt.pattern(string(p, "pattern"), true)?;
            let input = if string(p, "source") == "original" {
                &c.original
            } else {
                &c.name
            };
            if let Some(caps) = re.captures(input) {
                // A new extraction replaces previous captures so absent optional groups cannot reuse stale values.
                c.fields.clear();
                for (i, cap) in caps.iter().enumerate() {
                    if let Some(cap) = cap {
                        c.fields.insert(i.to_string(), cap.as_str().into());
                    }
                }
                for key in re.capture_names().flatten() {
                    if let Some(cap) = caps.name(key) {
                        c.fields.insert(key.to_string(), cap.as_str().into());
                    }
                }
            } else {
                c.fields.clear();
                c.unmatched = true;
                if boolean(p, "required") {
                    return Err("提取表达式未匹配".into());
                }
            }
        }
        "split" => {
            let input = if string(p, "source") == "original" {
                &c.original
            } else {
                &c.name
            };
            c.fields = input
                .split(string(p, "separator"))
                .enumerate()
                .map(|(i, s)| ((i + 1).to_string(), s.to_string()))
                .collect();
        }
        "template" => c.name = render_template(string(p, "text"), c, o)?,
        "setName" => c.name = string(p, "text").to_string(),
        "guard" => {
            let branch = if condition(&p["condition"], c, rt)? {
                "rules"
            } else {
                c.unmatched = true;
                "otherwise"
            };
            for (i, value) in p[branch].as_array().unwrap().iter().enumerate() {
                let rule: Rule =
                    serde_json::from_value(value.clone()).map_err(|_| "分支规则无效")?;
                apply(&rule, c, o, rt, &format!("{path}/{branch}/{i}"))?;
            }
        }
        "map" => {
            let pairs = p["pairs"].as_array().unwrap();
            let mut hit = false;
            if string(p, "mode") == "exact" {
                if let Some(pair) = pairs.iter().find(|pair| string(pair, "from") == c.name) {
                    c.name = string(pair, "to").to_string();
                    hit = true;
                }
            } else {
                let pattern = pairs
                    .iter()
                    .map(|p| regex::escape(string(p, "from")))
                    .collect::<Vec<_>>()
                    .join("|");
                c.name = replace_bounded(&rt.pattern(&pattern, true)?, &c.name, |caps, _| {
                    hit = true;
                    Ok(string(
                        pairs
                            .iter()
                            .find(|p| string(p, "from") == &caps[0])
                            .unwrap(),
                        "to",
                    )
                    .to_string())
                })?
                .0;
            }
            if !hit {
                c.unmatched = true;
                if boolean(p, "required") {
                    return Err("没有命中映射表".into());
                }
            }
        }
        "sequence" => {
            let group = match string(p, "group") {
                "parent" => c.parent_path.clone(),
                "field" => c
                    .fields
                    .get(string(p, "field"))
                    .filter(|s| !s.is_empty())
                    .cloned()
                    .ok_or("缺少编号分组字段")?,
                _ => String::new(),
            };
            let count = rt.counters.entry((path.to_string(), group)).or_insert(0);
            let number = integer(p, "start")
                .checked_add(integer(p, "step").checked_mul(*count).ok_or("编号溢出")?)
                .ok_or("编号溢出")?;
            *count += 1;
            if !(0..=999_999_999_999).contains(&number) {
                return Err("编号结果超出范围".into());
            }
            let number = format!("{:0width$}", number, width = integer(p, "digits") as usize);
            c.name = match string(p, "position") {
                "prefix" => format!("{number}{}{}", string(p, "separator"), c.name),
                "suffix" => format!("{}{}{number}", c.name, string(p, "separator")),
                _ => number,
            };
        }
        "digits" => {
            let re = rt.pattern(r"[0-9]+", true)?;
            let mut i = 0;
            let mut error = false;
            c.name = re
                .replace_all(&c.name, |caps: &Captures<'_>| {
                    i += 1;
                    if integer(p, "occurrence") != 0 && i != integer(p, "occurrence") {
                        return caps[0].to_string();
                    }
                    match caps[0]
                        .parse::<i64>()
                        .ok()
                        .and_then(|n| n.checked_add(integer(p, "delta")))
                        .filter(|n| *n >= 0 && *n <= 999_999_999_999)
                    {
                        Some(n) => format!("{:0width$}", n, width = integer(p, "digits") as usize),
                        None => {
                            error = true;
                            caps[0].to_string()
                        }
                    }
                })
                .into_owned();
            if error {
                return Err("数字运算超出范围".into());
            }
            if i == 0 || integer(p, "occurrence") > i {
                c.unmatched = true;
            }
        }
        "dateFormat" => {
            let mut range = None;
            let output = match string(p, "source") {
                "today" => today(o, string(p, "output"))?,
                "modified" => format_time(file_time(c, o)?, string(p, "output"))?,
                _ => {
                    let input = if string(p, "source") == "field" {
                        c.fields.get(string(p, "field")).ok_or("缺少日期字段")?
                    } else {
                        &c.name
                    };
                    let re = date_pattern(string(p, "input"))?;
                    let caps = re.captures(input).ok_or("没有匹配指定格式的日期")?;
                    if re.find_iter(input).count() != 1 {
                        return Err("匹配到多个日期，请先提取明确的日期字段".into());
                    }
                    let m = caps.get(0).unwrap();
                    if input[..m.start()]
                        .chars()
                        .next_back()
                        .is_some_and(|c| c.is_ascii_digit())
                        || input[m.end()..]
                            .chars()
                            .next()
                            .is_some_and(|c| c.is_ascii_digit())
                    {
                        return Err("日期与其他数字连写，请先提取日期字段".into());
                    }
                    if string(p, "source") == "field" && m.as_str() != input {
                        return Err("日期字段存在未解析内容".into());
                    }
                    range = Some((m.start(), m.end()));
                    let num = |key, default| -> Result<u32> {
                        caps.name(key).map_or(Ok(default), |m| {
                            m.as_str().parse().map_err(|_| "日期数字无效".into())
                        })
                    };
                    let (y, mo, d, h, mi, s) = (
                        num("y", 0)?,
                        num("m", 0)?,
                        num("d", 0)?,
                        num("h", 0)?,
                        num("min", 0)?,
                        num("s", 0)?,
                    );
                    if !(1..=9999).contains(&y)
                        || NaiveDate::from_ymd_opt(y as i32, mo, d)
                            .and_then(|d| d.and_hms_opt(h, mi, s))
                            .is_none()
                    {
                        return Err("日期或时间无效".into());
                    }
                    date_output(y as i32, mo, d, h, mi, s, string(p, "output"))?
                }
            };
            match string(p, "mode") {
                "field" => {
                    c.fields.insert(string(p, "field").to_string(), output);
                }
                "prefix" => c.name = format!("{output}{}{}", string(p, "separator"), c.name),
                "suffix" => c.name = format!("{}{}{output}", c.name, string(p, "separator")),
                "name" => c.name = output,
                _ => {
                    let (start, end) = range.ok_or("没有可替换的原日期")?;
                    c.name.replace_range(start..end, &output);
                }
            }
        }
        "extension" => {
            c.extension = match string(p, "action") {
                "lower" => c.extension.to_lowercase(),
                "upper" => c.extension.to_uppercase(),
                "set" => format!(".{}", string(p, "text")),
                _ => String::new(),
            }
        }
        _ => return Err("未知表达式".into()),
    }
    Ok(())
}
fn apply(
    rule: &Rule,
    c: &mut Context<'_>,
    o: &Options,
    rt: &mut Runtime,
    path: &str,
) -> Result<()> {
    rt.work = rt.work.saturating_add(c.name.len() + c.extension.len() + 1);
    if rt.work > 64_000_000 {
        return Err("任务计算量超过限制，请减少文件或规则".into());
    }
    match rule {
        Rule::Expression(p) => apply_expression(p, c, o, rt, path)?,
        Rule::AiNames(p) => {
            if let Some(name) = p.names.get(&c.file.id) {
                let (n, e) = split_name(name, o.extension_mode == "compound");
                c.name = n;
                c.extension = e;
            }
        }
        Rule::Trim(_) => c.name = c.name.trim().to_string(),
        Rule::Replace(p) => {
            c.name = replace_bounded(
                &rt.pattern(&regex::escape(&p.find), true)?,
                &c.name,
                |_, _| Ok(p.replacement.clone()),
            )?
            .0
        }
        Rule::Prefix(p) => c.name = format!("{}{}", p.text, c.name),
        Rule::Suffix(p) => c.name.push_str(&p.text),
        Rule::Spaces(p) => {
            c.name = replace_bounded(&rt.pattern(r"\s+", true)?, &c.name, |_, _| {
                Ok(p.separator.clone())
            })?
            .0
        }
        Rule::CleanCopies(_) => {
            c.name = rt
                .pattern(
                    r"(?i)(?:[_ -]*副本|[_ -]+copy)(?:\s*[（(][0-9]+[）)])?$",
                    true,
                )?
                .replace(&c.name, "")
                .into_owned();
            c.name = rt
                .pattern(r"\s*[（(][0-9]+[）)]$", true)?
                .replace(&c.name, "")
                .into_owned();
        }
        Rule::StripSpecial(_) => {
            c.name = rt
                .pattern(r"[\[\]【】!！@#$%^&]+", true)?
                .replace_all(&c.name, "")
                .into_owned()
        }
        Rule::RemoveNumber(_) => {
            c.name = rt
                .pattern(r"^[0-9]+[_ .-]+", true)?
                .replace(&c.name, "")
                .into_owned()
        }
        Rule::ExtensionLower(_) => c.extension = c.extension.to_lowercase(),
        Rule::Case(p) => {
            c.name = match p.mode {
                crate::rules::LetterCase::Lower => c.name.to_lowercase(),
                crate::rules::LetterCase::Upper => c.name.to_uppercase(),
            }
        }
        Rule::Number(p) => {
            let n = format!(
                "{:0width$}",
                u64::from(p.start) + c.index as u64,
                width = p.digits as usize
            );
            c.name = match p.position {
                crate::rules::Position::Prefix => format!("{n}{}{}", p.separator, c.name),
                crate::rules::Position::Suffix => format!("{}{}{n}", c.name, p.separator),
                crate::rules::Position::Replace => n,
            };
        }
        Rule::Date(p) => {
            c.name = match p.position {
                crate::rules::Position::Prefix => format!("{}{}{}", p.date, p.separator, c.name),
                crate::rules::Position::Suffix => format!("{}{}{}", c.name, p.separator, p.date),
                crate::rules::Position::Replace => p.date.clone(),
            }
        }
    }
    if c.name.len() + c.extension.len() > MAX_TEXT {
        return Err("中间结果超过 4096 字节".into());
    }
    Ok(())
}

pub fn evaluate(
    files: &[Entry],
    steps: &[Step],
    o: &Options,
    edits: &HashMap<String, String>,
    examples: &[Example],
) -> Result<Report> {
    if files.len() > 10000 || steps.len() > 64 || examples.len() > 8 || edits.len() > 10000 {
        return Err("任务超出数量限制".into());
    }
    if !matches!(
        o.sort.as_str(),
        "input" | "natural" | "name" | "modified" | "size"
    ) || !matches!(o.extension_mode.as_str(), "last" | "compound")
        || !valid_date(&o.reference_date)
        || o.timezone_offset.unsigned_abs() > 1440
        || o.timezone_offsets.len() > 10000
        || o.timezone_offsets.values().any(|v| v.unsigned_abs() > 1440)
    {
        return Err("方案排序、扩展名或时间设置无效".into());
    }
    let rules: Vec<_> = steps
        .iter()
        .filter(|s| s.enabled)
        .map(|s| s.rule.clone())
        .collect();
    validate_rules(&rules, true)?;
    let mut ids = HashSet::new();
    if files.iter().any(|f| !ids.insert(&f.id)) {
        return Err("文件标识重复".into());
    }
    let mut step_ids = HashSet::new();
    if steps
        .iter()
        .any(|s| s.id.is_empty() || s.id.len() > 128 || !step_ids.insert(&s.id))
    {
        return Err("规则标识为空或重复".into());
    }
    let mut ordered: Vec<_> = files.iter().enumerate().collect();
    ordered.sort_by(|(ia, a), (ib, b)| {
        let cmp = match o.sort.as_str() {
            "natural" => natural(&a.name, &b.name),
            "name" => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            "modified" => a.modified.cmp(&b.modified),
            "size" => a.size.cmp(&b.size),
            _ => ia.cmp(ib),
        };
        let cmp = if o.descending { cmp.reverse() } else { cmp };
        cmp.then_with(|| a.path.cmp(&b.path))
            .then_with(|| a.id.cmp(&b.id))
    });
    let mut rt = Runtime::default();
    let mut details = Vec::new();
    let trace_id = o
        .trace_id
        .as_deref()
        .or_else(|| files.first().map(|f| f.id.as_str()));
    for (index, (_, file)) in ordered.into_iter().enumerate() {
        let (name, extension) = split_name(&file.name, o.extension_mode == "compound");
        let parent_path = file
            .path
            .rsplit_once(['/', '\\'])
            .map(|(p, _)| p)
            .unwrap_or("")
            .to_string();
        let parent = parent_path
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("")
            .to_string();
        let mut c = Context {
            file,
            original: name.clone(),
            name,
            extension,
            fields: BTreeMap::new(),
            parent,
            parent_path,
            index,
            unmatched: false,
        };
        let mut error = None;
        let mut trace = Vec::new();
        for step in steps {
            let before = c.full();
            if step.enabled && error.is_none() {
                if let Err(e) = apply(&step.rule, &mut c, o, &mut rt, &step.id) {
                    error = Some(e);
                }
            }
            // Bound trace memory for 10k files. The caller can put the inspected file first.
            if Some(file.id.as_str()) == trace_id {
                trace.push(Trace {
                    id: step.id.clone(),
                    before,
                    after: c.full(),
                    fields: c.fields.clone(),
                    error: error.clone(),
                });
            }
        }
        let name = edits.get(&file.id).cloned().unwrap_or_else(|| c.full());
        if error.is_none() {
            error = crate::files::valid_name(&name).err();
        }
        let status = if error.is_some() {
            "error"
        } else if name != file.name {
            "changed"
        } else if c.unmatched {
            "unmatched"
        } else {
            "unchanged"
        };
        details.push(Detail {
            id: file.id.clone(),
            name,
            status: status.into(),
            unmatched: c.unmatched,
            error,
            trace,
        });
    }
    // Collision checks need destination and filesystem state, and are performed by files::plan.
    let results = examples
        .iter()
        .map(|e| {
            let d = details.iter().find(|d| d.id == e.id);
            ExampleResult {
                id: e.id.clone(),
                expected: e.expected.clone(),
                actual: d.map(|d| d.name.clone()),
                passed: d.is_some_and(|d| d.error.is_none() && d.name == e.expected),
            }
        })
        .collect();
    Ok(Report {
        changes: details
            .iter()
            .map(|d| Change {
                id: d.id.clone(),
                name: d.name.clone(),
            })
            .collect(),
        details,
        examples: results,
    })
}
pub fn expression_defaults(op: &str) -> Value {
    let schema: Vec<Value> = serde_json::from_str(SCHEMA).unwrap();
    let d = schema.iter().find(|d| d["op"] == op).unwrap();
    let mut p = serde_json::Map::new();
    p.insert("op".into(), json!(op));
    for f in d["fields"].as_array().unwrap() {
        p.insert(string(f, "key").to_string(), f["default"].clone());
    }
    Value::Object(p)
}
