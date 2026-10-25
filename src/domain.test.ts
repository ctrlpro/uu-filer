import { describe, it, expect } from 'vitest';
import {
  applyRules,
  defaultRules,
  invalidName,
  previewBrowser,
  sampleFiles,
  splitName,
} from './domain';
describe('rename rules', () => {
  it('keeps extensions and replaces literally, including special characters', () => {
    const files = sampleFiles();
    files[0].name = '合同[副本].PDF';
    expect(applyRules(files, { ...defaultRules, find: '[副本]', prefix: '2026_' })[0].name).toBe(
      '2026_合同.PDF',
    );
  });
  it('numbers deterministically using selected order', () => {
    expect(
      applyRules(sampleFiles().slice(0, 2), {
        ...defaultRules,
        numbering: true,
        start: 9,
        digits: 3,
      }).map((c) => c.name),
    ).toEqual(['采购合同_副本_009.pdf', '项目计划_副本_010.txt']);
  });
  it('does not treat dotfiles as extensions', () => {
    expect(splitName('.env')).toEqual(['.env', '']);
    expect(splitName('archive.tar.gz')).toEqual(['archive.tar', '.gz']);
  });
  it('rejects directory traversal, reserved and invalid names', () => {
    for (const name of ['../secret.txt', 'NUL.txt', 'COM1', 'a:b', 'name.', ' '])
      expect(invalidName(name)).not.toBeNull();
    expect(invalidName('合同_2026.pdf')).toBeNull();
  });
  it('marks every duplicate target', () => {
    const files = sampleFiles().slice(0, 2);
    expect(
      previewBrowser(
        files,
        files.map((f) => ({ id: f.id, name: 'SAME.txt' })),
      ).every((p) => !!p.error),
    ).toBe(true);
  });
});
