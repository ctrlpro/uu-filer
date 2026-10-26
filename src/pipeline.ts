import { invalidName, splitName, type Change, type FileEntry, type Rules } from './domain';
import {
  expressionCatalog,
  expressionDefaults,
  expressionProblem,
  parseExpression,
  containsFileNames,
  type Expression,
} from './expressions';
import type { Suggestion } from './types';
import { parseScheme, type SchemeOptions } from './scheme';

interface Parameters {
  expression: Expression;
  replace: { find: string; replacement: string };
  prefix: { text: string };
  suffix: { text: string };
  number: { start: number; digits: number; separator: string; position: 'prefix' | 'suffix' };
  trim: Record<string, never>;
  cleanCopies: Record<string, never>;
  stripSpecial: Record<string, never>;
  removeNumber: Record<string, never>;
  extensionLower: Record<string, never>;
  spaces: { separator: string };
  case: { mode: 'lower' | 'upper' };
  date: { date: string; separator: string; position: 'prefix' | 'suffix' };
  aiNames: { names: Record<string, string>; reasons: Record<string, string> };
}
export type RuleKind = keyof Parameters;
export type Rule = { [K in RuleKind]: { kind: K; params: Parameters[K] } }[RuleKind];
export interface RuleStep {
  id: string;
  enabled: boolean;
  rule: Rule;
  source?: 'manual' | 'ai';
}
export interface RuleDraft {
  rules: Rule[];
  explanation: string;
  suggestions?: Suggestion[];
  options?: SchemeOptions;
}
export interface RuleCatalogEntry {
  id: string;
  name: string;
  category: string;
  example: string;
  symbol: string;
  create: () => Rule;
}
export function localDate(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
export const ruleCatalog: RuleCatalogEntry[] = [
  ...expressionCatalog.map((d) => ({
    id: `expr-${d.op}`,
    name: d.name,
    category: d.category,
    example: d.example,
    symbol: 'ƒ',
    create: (): Rule => ({ kind: 'expression', params: expressionDefaults(d.op) }),
  })),
  {
    id: 'replace',
    name: '查找替换',
    category: '文本处理',
    example: '替换指定文字，可重复添加',
    symbol: '↔',
    create: () => ({ kind: 'replace', params: { find: '', replacement: '' } }),
  },
  {
    id: 'prefix',
    name: '添加前缀',
    category: '文本处理',
    example: '项目_原名称',
    symbol: 'A+',
    create: () => ({ kind: 'prefix', params: { text: '' } }),
  },
  {
    id: 'suffix',
    name: '添加后缀',
    category: '文本处理',
    example: '原名称_归档',
    symbol: '+Z',
    create: () => ({ kind: 'suffix', params: { text: '' } }),
  },
  {
    id: 'spaces',
    name: '替换空格',
    category: '文本处理',
    example: '空格 → 下划线 / 指定分隔符',
    symbol: '_',
    create: () => ({ kind: 'spaces', params: { separator: '_' } }),
  },
  {
    id: 'trim',
    name: '清除首尾空格',
    category: '清理与规范',
    example: '保留名称内部空格',
    symbol: 'Aa',
    create: () => ({ kind: 'trim', params: {} }),
  },
  {
    id: 'clean',
    name: '清理副本',
    category: '清理与规范',
    example: '末尾副本 / copy / 括号序号',
    symbol: '−',
    create: () => ({ kind: 'expression', params: expressionDefaults('clean') }),
  },
  {
    id: 'strip',
    name: '去除特殊字符',
    category: '清理与规范',
    example: '清理 []、【】、!、@ 等符号',
    symbol: '✦',
    create: () => ({
      kind: 'expression',
      params: {
        ...expressionDefaults('clean'),
        characters: '[]【】!！@#$%^&',
        copyMarkers: false,
        separators: '',
      },
    }),
  },
  {
    id: 'lower',
    name: '统一小写',
    category: '清理与规范',
    example: 'PROJECT → project',
    symbol: 'aa',
    create: () => ({ kind: 'case', params: { mode: 'lower' } }),
  },
  {
    id: 'upper',
    name: '统一大写',
    category: '清理与规范',
    example: 'project → PROJECT',
    symbol: 'AA',
    create: () => ({ kind: 'case', params: { mode: 'upper' } }),
  },
  {
    id: 'number',
    name: '连续编号',
    category: '编号与归档',
    example: '原名称_001 / 001_原名称',
    symbol: '01',
    create: () => ({
      kind: 'number',
      params: { start: 1, digits: 3, separator: '_', position: 'suffix' },
    }),
  },
  {
    id: 'remove-number',
    name: '移除起始编号',
    category: '编号与归档',
    example: '001_项目 → 项目',
    symbol: '−1',
    create: () => ({ kind: 'removeNumber', params: {} }),
  },
  {
    id: 'date',
    name: '添加日期',
    category: '编号与归档',
    example: '指定日期 + 原名称，可选位置',
    symbol: '日',
    create: () => ({
      kind: 'date',
      params: { date: localDate(), separator: '_', position: 'prefix' },
    }),
  },
  {
    id: 'extension',
    name: '扩展名小写',
    category: '编号与归档',
    example: 'photo.JPG → photo.jpg',
    symbol: '.x',
    create: () => ({ kind: 'extensionLower', params: {} }),
  },
];
export function ruleTitle(rule: Rule) {
  if (rule.kind === 'expression')
    return expressionCatalog.find((d) => d.op === rule.params.op)?.name ?? '表达式';
  if (rule.kind === 'aiNames') return 'AI 逐文件命名';
  if (rule.kind === 'cleanCopies') return '清理副本（旧版）';
  if (rule.kind === 'stripSpecial') return '去特殊字符（旧版）';
  if (rule.kind === 'case') return rule.params.mode === 'upper' ? '统一大写' : '统一小写';
  return ruleCatalog.find((p) => p.create().kind === rule.kind)?.name ?? rule.kind;
}
export function describeRule(rule: Rule): string {
  switch (rule.kind) {
    case 'expression': {
      const p = rule.params;
      return String(
        p.op === 'template'
          ? p.text
          : p.op === 'extract'
            ? p.pattern
            : p.op === 'guard'
              ? '条件匹配 → 分支处理'
              : p.op === 'sequence'
                ? `${p.start} 起 · 步长 ${p.step} · ${p.group}`
                : (expressionCatalog.find((d) => d.op === p.op)?.example ?? p.op),
      );
    }
    case 'prefix':
      return rule.params.text || '待填写前缀';
    case 'suffix':
      return rule.params.text || '待填写后缀';
    case 'replace':
      return rule.params.find
        ? `${rule.params.find} → ${rule.params.replacement || '删除'}`
        : '待填写查找内容';
    case 'spaces':
      return `空格 → ${rule.params.separator || '删除'}`;
    case 'number':
      return `${rule.params.position === 'prefix' ? '前置' : '后置'} · ${String(rule.params.start).padStart(rule.params.digits, '0')}`;
    case 'date':
      return `${rule.params.date} · ${rule.params.position === 'prefix' ? '前置' : '后置'}`;
    case 'aiNames':
      return `${Object.keys(rule.params.names).length} 项建议 · 仅匹配对应文件`;
    default:
      return ruleTitle(rule);
  }
}
export function makeStep(rule: Rule, source: 'manual' | 'ai' = 'manual'): RuleStep {
  return { id: crypto.randomUUID(), enabled: true, rule: structuredClone(rule), source };
}
export function catalogStep(id: string) {
  const entry = ruleCatalog.find((p) => p.id === id);
  if (!entry) throw new Error('未知规则');
  return makeStep(entry.create());
}
function applyParts(
  parts: [string, string],
  index: number,
  fileId: string,
  rule: Rule,
): [string, string] {
  let [stem, ext] = parts;
  switch (rule.kind) {
    case 'trim':
      stem = stem.trim();
      break;
    case 'replace':
      if (rule.params.find) stem = stem.split(rule.params.find).join(rule.params.replacement);
      break;
    case 'prefix':
      stem = rule.params.text + stem;
      break;
    case 'suffix':
      stem += rule.params.text;
      break;
    case 'spaces':
      stem = stem.replace(/\s+/g, () => rule.params.separator);
      break;
    case 'cleanCopies':
      stem = stem
        .replace(/(?:[_ -]*副本|[_ -]+copy)(?:\s*[（(]\d+[）)])?$/i, '')
        .replace(/\s*[（(]\d+[）)]$/, '');
      break;
    case 'stripSpecial':
      stem = stem.replace(/[\[\]【】!！@#$%^&]+/g, '');
      break;
    case 'removeNumber':
      stem = stem.replace(/^\d+[_ .-]+/, '');
      break;
    case 'case':
      stem = rule.params.mode === 'lower' ? stem.toLowerCase() : stem.toUpperCase();
      break;
    case 'extensionLower':
      ext = ext.toLowerCase();
      break;
    case 'number': {
      const value = String(rule.params.start + index).padStart(rule.params.digits, '0');
      stem =
        rule.params.position === 'prefix'
          ? value + rule.params.separator + stem
          : stem + rule.params.separator + value;
      break;
    }
    case 'date':
      stem =
        rule.params.position === 'prefix'
          ? rule.params.date + rule.params.separator + stem
          : stem + rule.params.separator + rule.params.date;
      break;
    case 'aiNames':
      return Object.prototype.hasOwnProperty.call(rule.params.names, fileId)
        ? splitName(rule.params.names[fileId])
        : parts;
  }
  return [stem, ext];
}
export function applyPipeline(files: FileEntry[], steps: RuleStep[]): Change[] {
  return files.map((file, index) => {
    const parts = steps.reduce(
      (parts, step) => (step.enabled ? applyParts(parts, index, file.id, step.rule) : parts),
      splitName(file.name),
    );
    return { id: file.id, name: parts.join('') };
  });
}
export function tracePipeline(file: FileEntry, index: number, steps: RuleStep[]) {
  let parts = splitName(file.name);
  return steps.map((step) => {
    const before = parts.join('');
    if (step.enabled) parts = applyParts(parts, index, file.id, step.rule);
    return { id: step.id, before, after: parts.join('') };
  });
}
export function moveStep(steps: RuleStep[], id: string, target: string): RuleStep[] {
  const from = steps.findIndex((s) => s.id === id),
    to = steps.findIndex((s) => s.id === target);
  if (from < 0 || to < 0 || from === to) return steps;
  const result = [...steps],
    item = result.splice(from, 1)[0];
  result.splice(to, 0, item);
  return result;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}
function text(value: unknown, max = 1024): value is string {
  return typeof value === 'string' && value.length <= max;
}
export function validDate(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, month, day] = m.slice(1).map(Number),
    leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return (
    y >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  );
}
export function parseRule(value: unknown, depth = 0): Rule | null {
  if (depth > 4) return null;
  if (!object(value) || !exactKeys(value, ['kind', 'params']) || !object(value.params)) return null;
  const p = value.params;
  switch (value.kind) {
    case 'expression': {
      const p = parseExpression(value.params, depth, parseRule);
      return p ? { kind: 'expression', params: p } : null;
    }
    case 'trim':
    case 'cleanCopies':
    case 'stripSpecial':
    case 'removeNumber':
    case 'extensionLower':
      if (exactKeys(p, [])) return { kind: value.kind, params: {} };
      break;
    case 'prefix':
    case 'suffix':
      if (exactKeys(p, ['text']) && text(p.text))
        return { kind: value.kind, params: { text: p.text } };
      break;
    case 'replace':
      if (exactKeys(p, ['find', 'replacement']) && text(p.find) && text(p.replacement))
        return { kind: 'replace', params: { find: p.find, replacement: p.replacement } };
      break;
    case 'spaces':
      if (exactKeys(p, ['separator']) && text(p.separator, 16))
        return { kind: 'spaces', params: { separator: p.separator } };
      break;
    case 'case':
      if (exactKeys(p, ['mode']) && (p.mode === 'upper' || p.mode === 'lower'))
        return { kind: 'case', params: { mode: p.mode } };
      break;
    case 'number':
      if (
        exactKeys(p, ['start', 'digits', 'separator', 'position']) &&
        typeof p.start === 'number' &&
        Number.isInteger(p.start) &&
        p.start >= 0 &&
        p.start <= 999999 &&
        typeof p.digits === 'number' &&
        Number.isInteger(p.digits) &&
        p.digits >= 1 &&
        p.digits <= 6 &&
        text(p.separator, 16) &&
        (p.position === 'prefix' || p.position === 'suffix')
      )
        return {
          kind: 'number',
          params: {
            start: p.start,
            digits: p.digits,
            separator: p.separator,
            position: p.position,
          },
        };
      break;
    case 'date':
      if (
        exactKeys(p, ['date', 'separator', 'position']) &&
        typeof p.date === 'string' &&
        validDate(p.date) &&
        text(p.separator, 16) &&
        (p.position === 'prefix' || p.position === 'suffix')
      )
        return {
          kind: 'date',
          params: { date: p.date, separator: p.separator, position: p.position },
        };
      break;
  }
  return null;
}
export function ruleError(rule: Rule): string | null {
  const fragment = (s: string) =>
    /[<>:"/\\|?*\x00-\x1f\x7f]/.test(s) ? '名称参数包含非法字符' : null;
  switch (rule.kind) {
    case 'expression':
      return expressionProblem(rule.params, parseRule);
    case 'replace':
      return !rule.params.find ? '请填写查找内容' : fragment(rule.params.replacement);
    case 'prefix':
    case 'suffix':
      return !rule.params.text ? '请填写名称文字' : fragment(rule.params.text);
    case 'spaces':
    case 'number':
      return fragment(rule.params.separator);
    case 'date':
      return !validDate(rule.params.date) ? '请选择有效日期' : fragment(rule.params.separator);
    default:
      return null;
  }
}
export function parseRuleDraft(value: unknown, entries: FileEntry[] = []): RuleDraft {
  if (
    !object(value) ||
    !Object.hasOwn(value, 'rules') ||
    !Object.hasOwn(value, 'explanation') ||
    Object.keys(value).some(
      (k) => !['rules', 'explanation', 'suggestions', 'options'].includes(k),
    ) ||
    !Array.isArray(value.rules) ||
    value.rules.length > 32 ||
    !text(value.explanation, 4000)
  )
    throw new Error('AI 规则草案格式无效');
  const rules = value.rules.map((v) => {
    const rule = parseRule(v);
    if (!rule || ruleError(rule) || containsFileNames(rule))
      throw new Error('AI 返回了不支持的规则或无效参数');
    return rule;
  });
  const suggestions: Suggestion[] = [];
  if (value.suggestions !== undefined) {
    if (!Array.isArray(value.suggestions) || value.suggestions.length > 200)
      throw new Error('逐文件方案格式无效');
    const seen = new Set();
    for (const s of value.suggestions) {
      if (
        !object(s) ||
        !exactKeys(s, ['id', 'name', 'reason']) ||
        !text(s.id, 128) ||
        !text(s.name, 240) ||
        !text(s.reason, 4000) ||
        seen.has(s.id) ||
        invalidName(s.name)
      )
        throw new Error('逐文件方案含非法名称或重复标识');
      const file = entries.find((f) => f.id === s.id);
      if (!file || splitName(file.name)[1].toLowerCase() !== splitName(s.name)[1].toLowerCase())
        throw new Error('逐文件方案含未知文件或修改了扩展名');
      seen.add(s.id);
      suggestions.push({ id: s.id, name: s.name, reason: s.reason });
    }
  }
  const options = value.options === undefined ? undefined : parseScheme(value.options);
  if (options === null) throw new Error('AI 返回了无效方案选项');
  if (!rules.length && !suggestions.length && !options) throw new Error('AI 未生成可用方案');
  return {
    rules,
    explanation: value.explanation,
    ...(suggestions.length ? { suggestions } : {}),
    ...(options ? { options } : {}),
  };
}
export function parseSavedSteps(value: unknown): RuleStep[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  const output: RuleStep[] = [];
  for (const item of value) {
    if (!object(item) || typeof item.enabled !== 'boolean') return null;
    const rule = parseRule(item.rule);
    if (!rule || containsFileNames(rule)) return null;
    output.push({ ...makeStep(rule), enabled: item.enabled });
  }
  return output;
}
export function legacySteps(r: Rules): RuleStep[] {
  const rules: Rule[] = [];
  if (r.trim) rules.push({ kind: 'trim', params: {} });
  if (r.replaceEnabled !== false) {
    if (r.find) rules.push({ kind: 'replace', params: { find: r.find, replacement: r.replace } });
    if (r.cleanCopies) rules.push({ kind: 'cleanCopies', params: {} });
  }
  if (r.spacesToUnderscore) rules.push({ kind: 'spaces', params: { separator: '_' } });
  if (r.stripSpecial) rules.push({ kind: 'stripSpecial', params: {} });
  if (r.removeLeadingNumber) rules.push({ kind: 'removeNumber', params: {} });
  if (r.letterCase !== 'keep') rules.push({ kind: 'case', params: { mode: r.letterCase } });
  if (r.affixEnabled !== false) {
    if (r.prefix) rules.push({ kind: 'prefix', params: { text: r.prefix } });
    if (r.suffix) rules.push({ kind: 'suffix', params: { text: r.suffix } });
  }
  if (r.numbering)
    rules.push({
      kind: 'number',
      params: { start: r.start, digits: r.digits, separator: '_', position: 'suffix' },
    });
  if (r.extensionLower) rules.push({ kind: 'extensionLower', params: {} });
  return rules.map((rule) => makeStep(rule));
}
