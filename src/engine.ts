import { applyPipeline, tracePipeline, type RuleStep } from './pipeline';
import type { Change, FileEntry } from './domain';
import type { SchemeOptions } from './scheme';
export { defaultScheme, legacyScheme, parseScheme, type SchemeOptions } from './scheme';
export interface EngineOptions extends SchemeOptions {
  referenceDate: string;
  timezoneOffset: number;
  traceId?: string | null;
  timezoneOffsets?: Record<string, number>;
}
export interface Example {
  id: string;
  expected: string;
}
export interface StepTrace {
  id: string;
  before: string;
  after: string;
  fields: Record<string, string>;
  error: string | null;
}
export interface Detail {
  id: string;
  name: string;
  status: string;
  unmatched?: boolean;
  error: string | null;
  trace: StepTrace[];
}
export interface EngineReport {
  changes: Change[];
  details: Detail[];
  examples: { id: string; expected: string; actual: string | null; passed: boolean }[];
}
export function orderFiles(
  files: FileEntry[],
  scheme: SchemeOptions,
  nativeOrder: string[] = [],
): FileEntry[] {
  const natural = (a: string, b: string) => {
    const aa = a.match(/[0-9]+|[^0-9]+/g) ?? [],
      bb = b.match(/[0-9]+|[^0-9]+/g) ?? [];
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
      const [a, b] = [aa[i], bb[i]];
      let c = 0;
      if (/^[0-9]/.test(a) && /^[0-9]/.test(b)) {
        const na = a.replace(/^0+/, ''),
          nb = b.replace(/^0+/, '');
        c = na.length - nb.length || (na < nb ? -1 : na > nb ? 1 : 0) || a.length - b.length;
      } else c = a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
      if (c) return c;
    }
    return aa.length - bb.length;
  };
  const positions = new Map(files.map((f, i) => [f.id, i]));
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = [...files].sort((a, b) => {
    const c =
      scheme.sort === 'natural'
        ? natural(a.name, b.name)
        : scheme.sort === 'name'
          ? compare(a.name.toLowerCase(), b.name.toLowerCase())
          : scheme.sort === 'modified'
            ? a.modified - b.modified
            : scheme.sort === 'size'
              ? a.size - b.size
              : positions.get(a.id)! - positions.get(b.id)!;
    return (scheme.descending ? -c : c) || compare(a.path, b.path) || compare(a.id, b.id);
  });
  // Native nanosecond timestamps retain precision beyond JS numbers. Respect the native order of targets.
  const targets = new Set(nativeOrder),
    byId = new Map(files.map((f) => [f.id, f]));
  let index = 0;
  return sorted.map((f) => (targets.has(f.id) ? (byId.get(nativeOrder[index++]) ?? f) : f));
}
// Browser mode deliberately evaluates only the existing basic demo rules. Advanced rules use Rust.
export function evaluateDemo(
  files: FileEntry[],
  steps: RuleStep[],
  edits: Record<string, string>,
  examples: Example[],
  traceId?: string | null,
): EngineReport {
  const advanced = steps.some((s) => s.enabled && s.rule.kind === 'expression');
  const changes = applyPipeline(files, steps).map((c) => ({ ...c, name: edits[c.id] ?? c.name }));
  return {
    changes,
    details: changes.map((c, i) => ({
      id: c.id,
      name: c.name,
      status: advanced ? 'error' : c.name === files[i].name ? 'unchanged' : 'changed',
      error: advanced ? '此规则需要桌面规则引擎；浏览器仅演示基础规则' : null,
      trace:
        files[i].id === (traceId ?? files[0]?.id)
          ? tracePipeline(files[i], i, steps).map((t) => ({
              ...t,
              fields: {},
              error: advanced ? '需要桌面规则引擎' : null,
            }))
          : [],
    })),
    examples: examples.map((e) => {
      const c = changes.find((c) => c.id === e.id);
      return { ...e, actual: c?.name ?? null, passed: !advanced && c?.name === e.expected };
    }),
  };
}
