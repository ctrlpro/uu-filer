import schema from '../src-tauri/rule-schema.json';
import type { Rule } from './pipeline';
export type Condition =
  | { kind: 'test'; field: string; operator: string; value: string; negate: boolean }
  | { kind: 'all' | 'any'; conditions: Condition[] }
  | { kind: 'not'; condition: Condition };
export interface Expression {
  op: string;
  [key: string]: unknown;
}
export interface FieldDefinition {
  key: string;
  label: string;
  type: string;
  default: unknown;
  min?: number;
  max?: number;
  options?: string[][];
  help?: string;
}
export interface ExpressionDefinition {
  op: string;
  name: string;
  category: string;
  example: string;
  fields: FieldDefinition[];
}
export const expressionCatalog = schema as ExpressionDefinition[];
export function expressionDefaults(op: string): Expression {
  const def = expressionCatalog.find((d) => d.op === op);
  if (!def) throw new Error('未知表达式');
  return { op, ...Object.fromEntries(def.fields.map((f) => [f.key, structuredClone(f.default)])) };
}
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
export function validCondition(v: unknown, depth = 0): v is Condition {
  if (!object(v) || depth > 4) return false;
  if (v.kind === 'test')
    return (
      exact(v, ['kind', 'field', 'operator', 'value', 'negate']) &&
      typeof v.field === 'string' &&
      (/^(name|original|extension|parent)$/.test(v.field) || /^field:.{1,128}$/.test(v.field)) &&
      ['contains', 'starts', 'ends', 'equals', 'regex', 'exists'].includes(String(v.operator)) &&
      typeof v.value === 'string' &&
      v.value.length <= 4096 &&
      typeof v.negate === 'boolean'
    );
  if (v.kind === 'all' || v.kind === 'any')
    return (
      exact(v, ['kind', 'conditions']) &&
      Array.isArray(v.conditions) &&
      v.conditions.length >= 1 &&
      v.conditions.length <= 8 &&
      v.conditions.every((c) => validCondition(c, depth + 1))
    );
  return (
    v.kind === 'not' && exact(v, ['kind', 'condition']) && validCondition(v.condition, depth + 1)
  );
}
export function parseExpression(
  v: unknown,
  depth: number,
  parseChild: (v: unknown, depth: number) => Rule | null,
): Expression | null {
  if (!object(v) || depth > 4) return null;
  const def = expressionCatalog.find((d) => d.op === v.op);
  if (!def || !exact(v, ['op', ...def.fields.map((f) => f.key)])) return null;
  for (const f of def.fields) {
    const value = v[f.key];
    if (f.type === 'text' && (typeof value !== 'string' || value.length > 4096)) return null;
    if (f.type === 'bool' && typeof value !== 'boolean') return null;
    if (
      f.type === 'number' &&
      (typeof value !== 'number' || !Number.isInteger(value) || value < f.min! || value > f.max!)
    )
      return null;
    if (f.type === 'enum' && !f.options?.some((o) => o[0] === value)) return null;
    if (f.type === 'condition' && !validCondition(value)) return null;
    if (f.type === 'pairs') {
      if (!Array.isArray(value) || !value.length || value.length > 256) return null;
      const keys = new Set();
      for (const pair of value) {
        if (
          !object(pair) ||
          !exact(pair, ['from', 'to']) ||
          typeof pair.from !== 'string' ||
          !pair.from ||
          pair.from.length > 4096 ||
          typeof pair.to !== 'string' ||
          pair.to.length > 4096 ||
          keys.has(pair.from)
        )
          return null;
        keys.add(pair.from);
      }
    }
    if (
      f.type === 'rules' &&
      (!Array.isArray(value) || value.length > 16 || !value.every((r) => parseChild(r, depth + 1)))
    )
      return null;
  }
  return v as Expression;
}
export function expressionProblem(
  p: Expression,
  parseChild: (v: unknown, depth: number) => Rule | null,
): string | null {
  if (!parseExpression(p, 0, parseChild)) return '表达式参数不完整或超出范围';
  if (['replace', 'extract'].includes(p.op) && !p.pattern) return '请填写表达式';
  if (p.op === 'split' && !p.separator) return '字段分隔符不能为空';
  if (p.op === 'edit' && ['before', 'after'].includes(String(p.anchor)) && !p.marker)
    return '请填写定位文字';
  if (p.op === 'sequence' && p.group === 'field' && !p.field) return '请填写分组字段';
  return null; // Regex compilation and template semantics are authoritative in the Rust engine.
}
export function containsFileNames(rule: Rule): boolean {
  if (rule.kind === 'aiNames') return true;
  return (
    rule.kind === 'expression' &&
    rule.params.op === 'guard' &&
    [...(rule.params.rules as Rule[]), ...(rule.params.otherwise as Rule[])].some(containsFileNames)
  );
}
