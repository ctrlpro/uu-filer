use serde_json::{json, Value};
use std::collections::HashMap;
use uu_filer::{
    engine::{self, Example, Options, Step},
    files::Entry,
    rules::Rule,
    store::Policy,
};
fn file(id: &str, name: &str, parent: &str) -> Entry {
    Entry {
        id: id.into(),
        name: name.into(),
        path: format!("{parent}/{name}"),
        extension: engine::split_name(name, false)
            .1
            .trim_start_matches('.')
            .to_lowercase(),
        size: 42,
        modified: 1_704_067_200_000_000_000,
        policy: Policy::Local,
    }
}
fn options() -> Options {
    Options {
        sort: "input".into(),
        descending: false,
        extension_mode: "compound".into(),
        reference_date: "2026-10-26".into(),
        timezone_offset: -480,
        trace_id: None,
        timezone_offsets: HashMap::new(),
    }
}
fn expr(op: &str, updates: Value) -> Rule {
    let mut p = engine::expression_defaults(op);
    for (k, v) in updates.as_object().unwrap() {
        p[k] = v.clone();
    }
    Rule::Expression(p)
}
fn steps(rules: Vec<Rule>) -> Vec<Step> {
    rules
        .into_iter()
        .enumerate()
        .map(|(i, rule)| Step {
            id: format!("r{i}"),
            enabled: true,
            rule,
            source: None,
        })
        .collect()
}
fn run(files: &[Entry], rules: Vec<Rule>) -> engine::Report {
    engine::evaluate(files, &steps(rules), &options(), &HashMap::new(), &[]).unwrap()
}
fn name(input: &str, rules: Vec<Rule>) -> String {
    let r = run(&[file("1", input, "/x")], rules);
    assert!(r.details[0].error.is_none(), "{:?}", r.details);
    r.changes[0].name.clone()
}

#[test]
fn extracts_converts_and_reorders_new_fields() {
    let rules = vec![
        expr(
            "extract",
            json!({"pattern":"^(?P<客户>.+)-(?P<日期>[0-9]{8})-(?P<编号>.+)$"}),
        ),
        expr("dateFormat", json!({"source":"field","mode":"field"})),
        expr("template", json!({"text":"{日期}_{客户}_{编号}"})),
    ];
    let r = run(&[file("1", "华星-20260105-HT003.pdf", "/contracts")], rules);
    assert_eq!(r.changes[0].name, "2026-01-05_华星_HT003.pdf");
    assert_eq!(r.details[0].trace[0].fields["客户"], "华星");
}
#[test]
fn supports_multiple_patterns_with_explicit_branches() {
    let first = expr(
        "extract",
        json!({"pattern":"^(?P<客户>.+)-(?P<日期>[0-9]{8})-(?P<编号>.+)$"}),
    );
    let second = expr(
        "extract",
        json!({"pattern":"^(?P<客户>.+)_合同_(?P<编号>.+)_(?P<日期>[0-9]{8})$"}),
    );
    let guard = expr(
        "guard",
        json!({"condition":{"kind":"test","field":"name","operator":"contains","value":"_合同_","negate":false},"rules":[second],"otherwise":[first]}),
    );
    let r = run(
        &[
            file("1", "华星-20260105-HT003.pdf", "/x"),
            file("2", "天河_合同_HT004_20260106.pdf", "/x"),
        ],
        vec![
            guard,
            expr("template", json!({"text":"{日期}_{客户}_{编号}"})),
        ],
    );
    assert_eq!(r.changes[0].name, "20260105_华星_HT003.pdf");
    assert_eq!(r.changes[1].name, "20260106_天河_HT004.pdf");
}
#[test]
fn missing_fields_are_errors_and_manual_edits_do_not_hide_them() {
    let f = vec![file("1", "no-code.pdf", "/x")];
    let mut edits = HashMap::new();
    edits.insert("1".into(), "safe.pdf".into());
    let r = engine::evaluate(
        &f,
        &steps(vec![expr("template", json!({"text":"{编号}"}))]),
        &options(),
        &edits,
        &[],
    )
    .unwrap();
    assert!(r.details[0].error.as_ref().unwrap().contains("缺少"));
    assert_eq!(r.details[0].status, "error");
}
#[test]
fn conditional_preservation_is_explicit_and_prefix_is_idempotent() {
    let rule = expr("guard", json!({}));
    assert_eq!(name("report.pdf", vec![rule.clone()]), "项目_report.pdf");
    let r = run(&[file("1", "项目_report.pdf", "/x")], vec![rule]);
    assert_eq!(r.changes[0].name, "项目_report.pdf");
    assert_eq!(r.details[0].status, "unmatched");
}
#[test]
fn optional_extraction_does_not_reuse_stale_captures() {
    let r = run(
        &[file("1", "abc.txt", "/x")],
        vec![
            expr("extract", json!({"pattern":"(?P<客户>abc)"})),
            expr("extract", json!({"pattern":"xyz","required":false})),
            expr("template", json!({"text":"{客户}"})),
        ],
    );
    assert!(r.details[0].error.is_some());
}
#[test]
fn supports_numbered_captures_and_non_cascading_mapping() {
    assert_eq!(
        name(
            "客户_合同_003.txt",
            vec![
                expr("split", json!({})),
                expr("template", json!({"text":"{3}-{1}-{2}"}))
            ]
        ),
        "003-客户-合同.txt"
    );
    assert_eq!(
        name(
            "A_B.txt",
            vec![expr(
                "map",
                json!({"pairs":[{"from":"A","to":"B"},{"from":"B","to":"C"}]})
            )]
        ),
        "B_C.txt"
    );
}
#[test]
fn replacement_respects_occurrence_literal_values_and_named_groups() {
    assert_eq!(
        name(
            "a-a-a.txt",
            vec![expr(
                "replace",
                json!({"pattern":"a","replacement":"$&","occurrence":2})
            )]
        ),
        "a-$&-a.txt"
    );
    assert_eq!(
        name(
            "ABC123.txt",
            vec![expr(
                "replace",
                json!({"pattern":"(?P<letters>[A-Z]+)([0-9]+)","replacement":"${2}_${letters}","regex":true})
            )]
        ),
        "123_ABC.txt"
    );
    assert_eq!(
        name(
            "ABCabc.txt",
            vec![expr(
                "replace",
                json!({"pattern":"abc","replacement":"x","caseSensitive":false})
            )]
        ),
        "xx.txt"
    );
}
#[test]
fn regex_rejects_unknown_capture_groups_lookaround_and_extra_fields() {
    for updates in [
        json!({"pattern":"(x)","regex":true,"replacement":"${2}"}),
        json!({"pattern":"(?<=x)y","regex":true}),
        json!({"pattern":"(a)\\1","regex":true}),
        json!({"pattern":"a","shell":"bad"}),
    ] {
        assert!(engine::validate_rule(&expr("replace", updates), 0, false).is_err());
    }
}
#[test]
fn edits_preserve_grapheme_clusters_and_support_marker_offsets() {
    assert_eq!(
        name(
            "👨‍👩‍👧‍👦e\u{301}合同.txt",
            vec![expr("edit", json!({"action":"remove","length":1}))]
        ),
        "e\u{301}合同.txt"
    );
    assert_eq!(
        name(
            "甲乙丙丁.txt",
            vec![expr(
                "edit",
                json!({"action":"keep","anchor":"end","position":0,"length":2})
            )]
        ),
        "丙丁.txt"
    );
    assert_eq!(
        name(
            "合同HT003.txt",
            vec![expr(
                "edit",
                json!({"anchor":"after","marker":"合同","text":"_"})
            )]
        ),
        "合同_HT003.txt"
    );
}
#[test]
fn invalid_ranges_stop_that_file() {
    let r = run(
        &[file("1", "短.txt", "/x")],
        vec![expr("edit", json!({"action":"remove","length":10}))],
    );
    assert!(r.details[0].error.is_some());
}
#[test]
fn cleanup_is_configurable_and_does_not_assume_parentheses_are_duplicates() {
    assert_eq!(
        name("报告(2026).txt", vec![expr("clean", json!({}))]),
        "报告(2026).txt"
    );
    assert_eq!(
        name(
            "报告【扫描件】__最终版.txt",
            vec![expr("clean", json!({"brackets":true}))]
        ),
        "报告_最终版.txt"
    );
    assert_eq!(
        name(
            "报告【未闭合.txt",
            vec![expr("clean", json!({"brackets":true}))]
        ),
        "报告【未闭合.txt"
    );
    assert_eq!(
        name("副本管理指南.txt", vec![expr("clean", json!({}))]),
        "副本管理指南.txt"
    );
    assert_eq!(
        name(
            "A-__B.txt",
            vec![expr("clean", json!({"characters":"-_","keep":"_"}))]
        ),
        "A__B.txt"
    );
}
#[test]
fn normalizes_width_without_compatibility_folding_other_symbols() {
    assert_eq!(
        name("ＡＢＣ１２３①.txt", vec![expr("normalize", json!({}))]),
        "ABC123①.txt"
    );
    assert_eq!(
        name(
            "e\u{301}.txt",
            vec![expr("normalize", json!({"mode":"nfc"}))]
        ),
        "é.txt"
    );
    assert_eq!(
        name("hello_WORLD.txt", vec![expr("letterCase", json!({}))]),
        "Hello_World.txt"
    );
}
#[test]
fn natural_sort_and_group_counts_are_stable_and_not_based_on_trace_file() {
    let files = vec![
        file("2", "10.txt", "/a"),
        file("1", "2.txt", "/a"),
        file("3", "1.txt", "/b"),
    ];
    let mut o = options();
    o.sort = "natural".into();
    o.trace_id = Some("2".into());
    let s = steps(vec![expr(
        "sequence",
        json!({"group":"parent","start":10,"step":2,"digits":3}),
    )]);
    let r = engine::evaluate(&files, &s, &o, &HashMap::new(), &[]).unwrap();
    assert_eq!(
        r.changes
            .iter()
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>(),
        vec!["1_010.txt", "2_010.txt", "10_012.txt"]
    );
    assert_eq!(
        r.details
            .iter()
            .filter(|d| !d.trace.is_empty())
            .map(|d| d.id.as_str())
            .collect::<Vec<_>>(),
        vec!["2"]
    );
    o.trace_id = Some("1".into());
    let again = engine::evaluate(&files, &s, &o, &HashMap::new(), &[]).unwrap();
    assert_eq!(
        serde_json::to_value(r.changes).unwrap(),
        serde_json::to_value(again.changes).unwrap()
    );
}
#[test]
fn groups_counters_by_captured_field_across_interleaved_files() {
    let files = vec![
        file("1", "甲_a.txt", "/x"),
        file("2", "乙_b.txt", "/x"),
        file("3", "甲_c.txt", "/x"),
    ];
    let r = run(
        &files,
        vec![
            expr("split", json!({})),
            expr("sequence", json!({"group":"field","field":"1"})),
        ],
    );
    assert_eq!(r.changes[2].name, "甲_c_002.txt");
}
#[test]
fn arithmetic_rejects_overflow_and_supports_existing_digit_adjustment() {
    assert_eq!(
        name("第9集.mp4", vec![expr("digits", json!({"delta":1}))]),
        "第010集.mp4"
    );
    let r = run(
        &[file("1", "第0集.mp4", "/x")],
        vec![expr("digits", json!({"delta":-1}))],
    );
    assert!(r.details[0].error.is_some());
}
#[test]
fn dates_are_explicit_and_calendar_validated() {
    assert_eq!(
        name(
            "报告_2026年1月5日.pdf",
            vec![expr("dateFormat", json!({"input":"YYYY年M月D日"}))]
        ),
        "报告_2026-01-05.pdf"
    );
    for n in ["20260230.txt", "x_20260101_20260102.txt", "1202601019.txt"] {
        let r = run(&[file("1", n, "/x")], vec![expr("dateFormat", json!({}))]);
        assert!(r.details[0].error.is_some(), "{n}");
    }
    for input in ["auto", "YYYYMD"] {
        assert!(
            engine::validate_rule(&expr("dateFormat", json!({"input":input})), 0, false).is_err()
        );
    }
}
#[test]
fn dates_and_local_variables_use_the_frozen_reference_and_timezone() {
    assert_eq!(
        name(
            "合同.txt",
            vec![expr(
                "template",
                json!({"text":"{parent}_{today:YYYYMMDD}_{modified:YYYY-MM-DD_HH-mm}_{size}_{original}"})
            )]
        ),
        "x_20261026_2024-01-01_08-00_42_合同.txt"
    );
    let mut o = options();
    o.timezone_offsets.insert("1".into(), 300);
    let report = engine::evaluate(
        &[file("1", "合同.txt", "/x")],
        &steps(vec![expr(
            "template",
            json!({"text":"{modified:YYYY-MM-DD_HH}"}),
        )]),
        &o,
        &HashMap::new(),
        &[],
    )
    .unwrap();
    assert_eq!(report.changes[0].name, "2023-12-31_19.txt");
}
#[test]
fn compound_extensions_and_extensionless_files_keep_their_boundaries() {
    assert_eq!(
        name(
            "archive.tar.gz",
            vec![serde_json::from_value(json!({"kind":"suffix","params":{"text":".v2"}})).unwrap()]
        ),
        "archive.v2.tar.gz"
    );
    assert_eq!(
        name(
            "README",
            vec![
                serde_json::from_value(json!({"kind":"suffix","params":{"text":".v2"}})).unwrap(),
                expr("letterCase", json!({"mode":"lower"}))
            ]
        ),
        "readme.v2"
    );
    assert_eq!(name(".ENV", vec![expr("extension", json!({}))]), ".ENV");
    assert_eq!(
        name(
            "PHOTO.JPEG",
            vec![expr("extension", json!({"action":"set","text":"jpg"}))]
        ),
        "PHOTO.jpg"
    );
}
#[test]
fn templates_cannot_access_paths_or_implicitly_change_extensions() {
    for text in ["{path}", "{name}/{parent}", "{name}{ext}", "{not_found}"] {
        let r = run(
            &[file("1", "a.txt", "/private")],
            vec![expr("template", json!({"text":text}))],
        );
        assert!(r.details[0].error.is_some());
    }
}
#[test]
fn explicit_field_namespace_handles_builtin_variable_names() {
    assert_eq!(
        name(
            "abc.txt",
            vec![
                expr("extract", json!({"pattern":"(?P<name>abc)"})),
                expr("template", json!({"text":"{field:name}_{name}"}))
            ]
        ),
        "abc_abc.txt"
    );
}
#[test]
fn bounds_expansion_and_rejects_extreme_timezone_values_without_panics() {
    let r = run(
        &[file("1", "a".repeat(200).as_str(), "/x")],
        vec![expr(
            "replace",
            json!({"pattern":"a","replacement":"b".repeat(4096)}),
        )],
    );
    assert!(r.details[0].error.as_ref().unwrap().contains("4096"));
    let mut o = options();
    o.timezone_offset = i32::MIN;
    assert!(engine::evaluate(&[], &[], &o, &HashMap::new(), &[]).is_err());
    let mut guard = expr("guard", json!({}));
    for _ in 0..6 {
        guard = expr("guard", json!({"rules":[guard]}));
    }
    assert!(engine::validate_rule(&guard, 0, false).is_err());
}
#[test]
fn condition_groups_and_missing_field_guards_are_deterministic() {
    let guard = expr(
        "guard",
        json!({"condition":{"kind":"all","conditions":[{"kind":"test","field":"extension","operator":"equals","value":".pdf","negate":false},{"kind":"not","condition":{"kind":"test","field":"field:编号","operator":"exists","value":"","negate":false}}]},"rules":[{"kind":"prefix","params":{"text":"待补号_"}}]}),
    );
    assert_eq!(name("合同.pdf", vec![guard]), "待补号_合同.pdf");
}
#[test]
fn validates_examples_and_bounds_intermediate_names() {
    let f = vec![file("1", "a.txt", "/x")];
    let s = steps(vec![expr("template", json!({"text":"b"}))]);
    let r = engine::evaluate(
        &f,
        &s,
        &options(),
        &HashMap::new(),
        &[Example {
            id: "1".into(),
            expected: "c.txt".into(),
        }],
    )
    .unwrap();
    assert!(!r.examples[0].passed);
    let r = run(&f, vec![expr("template", json!({"text":"a".repeat(300)}))]);
    assert!(r.details[0].error.is_some());
}
#[test]
fn old_schemes_can_keep_last_dot_semantics_and_disabled_rules_are_inert() {
    let mut o = options();
    o.extension_mode = "last".into();
    let s = steps(vec![serde_json::from_value(
        json!({"kind":"suffix","params":{"text":"_001"}}),
    )
    .unwrap()]);
    let r = engine::evaluate(&[file("1", "a.tar.gz", "/x")], &s, &o, &HashMap::new(), &[]).unwrap();
    assert_eq!(r.changes[0].name, "a.tar_001.gz");
    let mut s = steps(vec![expr("replace", json!({}))]);
    s[0].enabled = false;
    assert!(engine::evaluate(&[file("1", "a.txt", "/x")], &s, &o, &HashMap::new(), &[]).is_ok());
}
#[test]
fn generated_rules_go_through_real_file_execution_and_undo() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("客户-20260105-HT003.pdf");
    std::fs::write(&path, b"UNCHANGED_CONTENT").unwrap();
    let store = uu_filer::store::Store::open(&dir.path().join("journal.sqlite")).unwrap();
    let files = uu_filer::files::scan(&[path.to_string_lossy().into()], false, &store).unwrap();
    let r = run(
        &files,
        vec![
            expr("extract", json!({})),
            expr("template", json!({"text":"{日期}_{客户}_{编号}"})),
        ],
    );
    assert!(r.details[0].error.is_none());
    let entries = files.into_iter().map(|f| (f.id.clone(), f)).collect();
    let result = uu_filer::files::execute(&store, &entries, &r.changes, "rename", None).unwrap();
    assert_eq!(result.completed, 1);
    let renamed = dir.path().join("20260105_客户_HT003.pdf");
    assert_eq!(std::fs::read(&renamed).unwrap(), b"UNCHANGED_CONTENT");
    uu_filer::files::undo(&store, &result.batch).unwrap();
    assert_eq!(std::fs::read(path).unwrap(), b"UNCHANGED_CONTENT");
    assert!(!renamed.exists());
}
