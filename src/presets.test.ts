import { describe, it, expect } from 'vitest';
import { applyRules, defaultRules, sampleFiles } from './domain';
import { builtinRules, builtins, readPresets } from './presets';
describe('built-in and saved rename rules', () => {
  it('provides twelve working rules and deterministic date prefixes', () => {
    expect(new Set(builtins.map((p) => p.id)).size).toBe(12);
    expect(applyRules(sampleFiles(), builtinRules('date', '2026-10-25'))[0].name).toBe(
      '2026-10-25_采购合同_副本.pdf',
    );
    expect(applyRules(sampleFiles(), builtinRules('clean'))[0].name).toBe('采购合同.pdf');
    expect(
      applyRules(sampleFiles().slice(0, 2), builtinRules('number')).map((c) => c.name),
    ).toEqual(['采购合同_副本_001.pdf', '项目计划_副本_002.txt']);
  });
  it('cleans real suffix markers without altering ordinary words or extension casing', () => {
    const entries = sampleFiles().slice(0, 1);
    for (const [source, result] of [
      ['项目 - copy (2).PDF', '项目.PDF'],
      ['合同（1）.pdf', '合同.pdf'],
      ['副本管理指南.pdf', '副本管理指南.pdf'],
      ['photocopy.pdf', 'photocopy.pdf'],
    ]) {
      entries[0].name = source;
      expect(applyRules(entries, builtinRules('clean'))[0].name).toBe(result);
    }
  });
  it('makes extension changes explicit and allows each rule to be disabled', () => {
    const files = sampleFiles().slice(0, 1);
    files[0].name = ' Photo Copy.JPG';
    expect(applyRules(files, builtinRules('extension'))[0].name).toBe('Photo Copy.jpg');
    expect(
      applyRules(files, {
        ...defaultRules,
        find: 'Photo',
        replace: 'Other',
        prefix: 'PREFIX_',
        replaceEnabled: false,
        affixEnabled: false,
      })[0].name,
    ).toBe('Photo Copy.JPG');
  });
  it('normalizes whitespace, strips decorations and removes delimited numbering', () => {
    const file = sampleFiles().slice(0, 1);
    file[0].name = 'My  File.txt';
    expect(applyRules(file, builtinRules('spaces'))[0].name).toBe('My_File.txt');
    file[0].name = '【项目】!.txt';
    expect(applyRules(file, builtinRules('strip'))[0].name).toBe('项目.txt');
    file[0].name = '001_项目.txt';
    expect(applyRules(file, builtinRules('remove-number'))[0].name).toBe('项目.txt');
    file[0].name = '2026年度计划.txt';
    expect(applyRules(file, builtinRules('remove-number'))[0].name).toBe('2026年度计划.txt');
  });
  it('migrates old user presets and rejects malformed local storage', () => {
    expect(
      readPresets(
        JSON.stringify([
          {
            name: '旧方案',
            rules: {
              find: 'x',
              replace: '',
              prefix: 'a',
              suffix: '',
              numbering: false,
              start: 1,
              digits: 3,
              trim: true,
              letterCase: 'keep',
            },
          },
        ]),
      )[0].steps.length,
    ).toBeGreaterThan(0);
    expect(readPresets('[{"name":"bad","rules":{"start":-1}}]')).toEqual([]);
    expect(readPresets('null')).toEqual([]);
    expect(readPresets('invalid')).toEqual([]);
  });
});
