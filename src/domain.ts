export type Policy = 'deny' | 'local' | 'cloud';
export type Operation = 'rename' | 'copy' | 'move';
export interface FileEntry {
  id: string;
  path: string;
  name: string;
  extension: string;
  size: number;
  modified: number;
  policy: Policy;
}
export interface Change {
  id: string;
  name: string;
}
export interface PlanItem extends Change {
  source: string;
  target: string;
  error: string | null;
  changed: boolean;
}
export interface Rules {
  find: string;
  replace: string;
  prefix: string;
  suffix: string;
  numbering: boolean;
  start: number;
  digits: number;
  trim: boolean;
  letterCase: 'keep' | 'lower' | 'upper';
  replaceEnabled?: boolean;
  affixEnabled?: boolean;
  cleanCopies?: boolean;
  spacesToUnderscore?: boolean;
  stripSpecial?: boolean;
  removeLeadingNumber?: boolean;
  extensionLower?: boolean;
}
export const defaultRules: Rules = {
  find: '',
  replace: '',
  prefix: '',
  suffix: '',
  numbering: false,
  start: 1,
  digits: 3,
  trim: true,
  letterCase: 'keep',
  replaceEnabled: true,
  affixEnabled: true,
  cleanCopies: false,
  spacesToUnderscore: false,
  stripSpecial: false,
  removeLeadingNumber: false,
  extensionLower: false,
};
export const policyLabels: Record<Policy, string> = {
  deny: '禁止 AI',
  local: '仅本地 AI',
  cloud: '允许云端',
};
export function splitName(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
}
export function applyRules(files: FileEntry[], rules: Rules): Change[] {
  return files.map((file, index) => {
    let [stem, ext] = splitName(file.name);
    if (rules.trim) stem = stem.trim();
    if (rules.replaceEnabled !== false) {
      if (rules.find) stem = stem.split(rules.find).join(rules.replace);
      if (rules.cleanCopies)
        stem = stem
          .replace(/(?:[_ -]*副本|[_ -]+copy)(?:\s*[（(]\d+[）)])?$/i, '')
          .replace(/\s*[（(]\d+[）)]$/, '');
    }
    if (rules.spacesToUnderscore) stem = stem.replace(/\s+/g, '_');
    if (rules.stripSpecial) stem = stem.replace(/[\[\]【】!！@#$%^&]+/g, '');
    if (rules.removeLeadingNumber) stem = stem.replace(/^\d+[_ .-]+/, '');
    if (rules.letterCase === 'lower') stem = stem.toLowerCase();
    if (rules.letterCase === 'upper') stem = stem.toUpperCase();
    if (rules.affixEnabled !== false) stem = rules.prefix + stem + rules.suffix;
    if (rules.numbering) stem += `_${String(rules.start + index).padStart(rules.digits, '0')}`;
    if (rules.extensionLower) ext = ext.toLowerCase();
    return { id: file.id, name: stem + ext };
  });
}
export function invalidName(name: string): string | null {
  if (
    !name.trim() ||
    name === '.' ||
    name === '..' ||
    /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) ||
    /[. ]$/.test(name)
  )
    return '名称包含非法字符或路径';
  if (new TextEncoder().encode(name).length > 240 || name.length > 240) return '文件名过长';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) return 'Windows 保留名称';
  return null;
}
export function previewBrowser(files: FileEntry[], changes: Change[]): PlanItem[] {
  const names = new Map(files.map((f) => [f.id, f]));
  const counts = new Map<string, number>();
  changes.forEach((c) =>
    counts.set(c.name.toLowerCase(), (counts.get(c.name.toLowerCase()) ?? 0) + 1),
  );
  return changes.map((c) => ({
    ...c,
    source: names.get(c.id)!.name,
    target: c.name,
    changed: c.name !== names.get(c.id)!.name,
    error:
      invalidName(c.name) ?? ((counts.get(c.name.toLowerCase()) ?? 0) > 1 ? '目标名称重复' : null),
  }));
}
export function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
export function sampleFiles(): FileEntry[] {
  return [
    ['采购合同_副本.pdf', 142_000],
    ['项目计划_副本.txt', 3200],
    ['会议纪要_副本.md', 6400],
    ['产品照片_副本.jpg', 2_400_000],
    ['费用清单_副本.csv', 4800],
    ['设计说明_副本.pdf', 86_000],
  ].map(([name, size], i) => ({
    id: `sample-${i}`,
    path: `示例文件/${name}`,
    name: String(name),
    extension: String(name).split('.').pop()!,
    size: Number(size),
    modified: 0,
    policy: 'local',
  }));
}
