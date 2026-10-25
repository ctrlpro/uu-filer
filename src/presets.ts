import { defaultRules, type Rules } from './domain';
export interface Preset {
  name: string;
  rules: Rules;
}
export interface BuiltinPreset {
  id: string;
  name: string;
  example: string;
  symbol: string;
  category: string;
  rules: (date: string) => Partial<Rules>;
}
export function localDate(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
export const builtins: BuiltinPreset[] = [
  {
    id: 'clean',
    name: '清理副本',
    example: '副本 / copy / 括号序号',
    symbol: 'Aa',
    category: '清理与规范',
    rules: () => ({ cleanCopies: true }),
  },
  {
    id: 'trim',
    name: '去除首尾空格',
    example: '保留名称内部空格',
    symbol: '↔',
    category: '清理与规范',
    rules: () => ({ trim: true }),
  },
  {
    id: 'spaces',
    name: '空格转下划线',
    example: 'project name → project_name',
    symbol: '_',
    category: '清理与规范',
    rules: () => ({ spacesToUnderscore: true }),
  },
  {
    id: 'strip',
    name: '去除特殊字符',
    example: '清理 []、【】、!、@ 等符号',
    symbol: '✦',
    category: '清理与规范',
    rules: () => ({ stripSpecial: true }),
  },
  {
    id: 'lower',
    name: '统一小写',
    example: 'PROJECT → project',
    symbol: 'aa',
    category: '清理与规范',
    rules: () => ({ letterCase: 'lower' }),
  },
  {
    id: 'upper',
    name: '统一大写',
    example: 'project → PROJECT',
    symbol: 'AA',
    category: '清理与规范',
    rules: () => ({ letterCase: 'upper' }),
  },
  {
    id: 'number',
    name: '连续编号',
    example: '原名称_001.ext',
    symbol: '01',
    category: '编号与归档',
    rules: () => ({ numbering: true }),
  },
  {
    id: 'remove-number',
    name: '移除起始编号',
    example: '001_项目 → 项目',
    symbol: '−1',
    category: '编号与归档',
    rules: () => ({ removeLeadingNumber: true }),
  },
  {
    id: 'date',
    name: '日期前缀',
    example: '指定日期_原名称（可编辑）',
    symbol: '日',
    category: '编号与归档',
    rules: (date) => ({ prefix: `${date}_` }),
  },
  {
    id: 'prefix',
    name: '添加项目前缀',
    example: '项目_原名称',
    symbol: 'A+',
    category: '编号与归档',
    rules: () => ({ prefix: '项目_' }),
  },
  {
    id: 'suffix',
    name: '添加归档后缀',
    example: '原名称_归档',
    symbol: '+Z',
    category: '编号与归档',
    rules: () => ({ suffix: '_归档' }),
  },
  {
    id: 'extension',
    name: '扩展名小写',
    example: 'photo.JPG → photo.jpg',
    symbol: '.x',
    category: '编号与归档',
    rules: () => ({ extensionLower: true }),
  },
];
export function builtinRules(id: string, date = localDate()): Rules {
  const preset = builtins.find((p) => p.id === id);
  if (!preset) throw new Error('未知内置规则');
  return { ...defaultRules, ...preset.rules(date) };
}
export function readPresets(value: string | null): Preset[] {
  try {
    const list: unknown = JSON.parse(value ?? '[]');
    if (!Array.isArray(list)) return [];
    return list
      .filter((p): p is Preset => {
        if (
          !p ||
          typeof p !== 'object' ||
          typeof p.name !== 'string' ||
          !p.name.trim() ||
          !p.rules ||
          typeof p.rules !== 'object'
        )
          return false;
        const r = p.rules;
        return (
          ['find', 'replace', 'prefix', 'suffix'].every((k) => typeof r[k] === 'string') &&
          ['trim', 'numbering'].every((k) => typeof r[k] === 'boolean') &&
          ['keep', 'lower', 'upper'].includes(r.letterCase) &&
          Number.isInteger(r.start) &&
          r.start >= 0 &&
          r.start <= 999999 &&
          Number.isInteger(r.digits) &&
          r.digits >= 1 &&
          r.digits <= 6 &&
          [
            'replaceEnabled',
            'affixEnabled',
            'cleanCopies',
            'spacesToUnderscore',
            'stripSpecial',
            'removeLeadingNumber',
            'extensionLower',
          ].every((k) => r[k] === undefined || typeof r[k] === 'boolean')
        );
      })
      .map((p) => ({ name: p.name, rules: { ...defaultRules, ...p.rules } }));
  } catch {
    return [];
  }
}
