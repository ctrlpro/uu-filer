export interface SchemeOptions {
  sort: 'input' | 'natural' | 'name' | 'modified' | 'size';
  descending: boolean;
  extensionMode: 'last' | 'compound';
}
export const defaultScheme: SchemeOptions = {
  sort: 'input',
  descending: false,
  extensionMode: 'compound',
};
export const legacyScheme: SchemeOptions = {
  sort: 'input',
  descending: false,
  extensionMode: 'last',
};
export function parseScheme(value: unknown): SchemeOptions | null {
  const p = value as SchemeOptions | null;
  return p &&
    Object.keys(p).length === 3 &&
    ['input', 'natural', 'name', 'modified', 'size'].includes(p.sort) &&
    typeof p.descending === 'boolean' &&
    ['last', 'compound'].includes(p.extensionMode)
    ? p
    : null;
}
