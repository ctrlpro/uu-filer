import { describe, it, expect } from 'vitest';
import { applyRules, defaultRules, sampleFiles, type FileEntry } from './domain';
import {
  applyPipeline,
  catalogStep,
  legacySteps,
  makeStep,
  moveStep,
  parseRuleDraft,
  parseSavedSteps,
  ruleError,
  tracePipeline,
  type Rule,
} from './pipeline';
import { readPresets } from './presets';
function input(name = '产品 图 01.JPG'): FileEntry[] {
  return [
    { ...sampleFiles()[0], id: 'one', name, extension: name.split('.').pop()!.toLowerCase() },
  ];
}
describe('ordered reusable rule pipeline', () => {
  it('composes prefix and whitespace rules in order, preserving the extension', () => {
    const prefix = makeStep({ kind: 'prefix', params: { text: '项目 A_' } }),
      spaces = catalogStep('spaces');
    expect(applyPipeline(input(), [prefix, spaces])[0].name).toBe('项目_A_产品_图_01.JPG');
    expect(applyPipeline(input(), [spaces, prefix])[0].name).toBe('项目 A_产品_图_01.JPG');
    const trace = tracePipeline(input()[0], 0, [prefix, spaces]);
    expect(trace[0].after).toBe('项目 A_产品 图 01.JPG');
    expect(trace[1].before).toBe(trace[0].after);
  });
  it('keeps the original extension boundary across rules, even when prefixes contain dots', () => {
    const prefix = makeStep({ kind: 'prefix', params: { text: '项目 v1.0 ' } }),
      spaces = catalogStep('spaces'),
      lower = catalogStep('lower');
    expect(applyPipeline(input('README'), [prefix, spaces, lower])[0].name).toBe(
      '项目_v1.0_readme',
    );
    const suffix = makeStep({ kind: 'suffix', params: { text: '.FINAL COPY' } });
    expect(applyPipeline(input('README'), [suffix, lower, spaces])[0].name).toBe(
      'readme.final_copy',
    );
    expect(applyPipeline(input('.ENV'), [prefix, lower, spaces])[0].name).toBe('项目_v1.0_.env');
    expect(applyPipeline(input('Report.PDF'), [prefix, lower, spaces])[0].name).toBe(
      '项目_v1.0_report.PDF',
    );
  });
  it('allows duplicate rule kinds with independent parameters and preserves their order on move', () => {
    const first = makeStep({ kind: 'replace', params: { find: '副本', replacement: '终版' } }),
      second = makeStep({ kind: 'replace', params: { find: '终版', replacement: '归档' } });
    expect(applyPipeline(input('合同副本.pdf'), [first, second])[0].name).toBe('合同归档.pdf');
    expect(
      applyPipeline(input('合同副本.pdf'), moveStep([first, second], second.id, first.id))[0].name,
    ).toBe('合同终版.pdf');
    expect(
      applyPipeline(input('合同副本.pdf'), [first, { ...second, enabled: false }])[0].name,
    ).toBe('合同终版.pdf');
  });
  it('treats replacement separators literally and never interprets shell, regex or JS', () => {
    const step = makeStep({ kind: 'spaces', params: { separator: '$&' } });
    expect(applyPipeline(input('my file.txt'), [step])[0].name).toBe('my$&file.txt');
    const replace = makeStep({ kind: 'replace', params: { find: '[x]', replacement: '$()' } });
    expect(applyPipeline(input('[x].txt'), [replace])[0].name).toBe('$().txt');
  });
  it('can prepend numbers and combines AI base names with subsequent rules', () => {
    const names = makeStep(
      {
        kind: 'aiNames',
        params: { names: { one: '会议 纪要.txt' }, reasons: { one: '来自标题' } },
      },
      'ai',
    );
    const prefix = makeStep({ kind: 'prefix', params: { text: '项目_' } }),
      spaces = catalogStep('spaces');
    expect(applyPipeline(input('recording.txt'), [names, prefix, spaces])[0].name).toBe(
      '项目_会议_纪要.txt',
    );
    const numbering = makeStep({
      kind: 'number',
      params: { start: 10, digits: 3, separator: '_', position: 'prefix' },
    });
    expect(applyPipeline(input('合同.txt'), [numbering])[0].name).toBe('010_合同.txt');
  });
  it('migrates legacy custom schemes without changing their behavior', () => {
    const rules = {
      ...defaultRules,
      find: '副本',
      replace: '',
      prefix: '项目_',
      numbering: true,
      spacesToUnderscore: true,
    };
    expect(applyPipeline(sampleFiles(), legacySteps(rules))).toEqual(
      applyRules(sampleFiles(), rules),
    );
    const migrated = readPresets(JSON.stringify([{ name: '旧版', rules }]));
    expect(migrated).toHaveLength(1);
    expect(applyPipeline(sampleFiles(), migrated[0].steps)).toEqual(
      applyRules(sampleFiles(), rules),
    );
  });
  it('persists order and enable flags with fresh unique IDs, excluding file-specific AI results', () => {
    const steps = [catalogStep('spaces'), { ...catalogStep('trim'), enabled: false }];
    const restored = parseSavedSteps(JSON.parse(JSON.stringify(steps)))!;
    expect(restored.map((s) => s.rule.kind)).toEqual(['spaces', 'trim']);
    expect(restored[1].enabled).toBe(false);
    expect(restored[0].id).not.toBe(steps[0].id);
    expect(
      parseSavedSteps([
        {
          ...makeStep({ kind: 'aiNames', params: { names: { one: 'private.txt' }, reasons: {} } }),
        },
      ]),
    ).toBeNull();
  });
  it('blocks incomplete or unsafe parameters before file execution', () => {
    expect(ruleError(catalogStep('prefix').rule)).not.toBeNull();
    expect(ruleError(catalogStep('replace').rule)).not.toBeNull();
    expect(
      ruleError({
        kind: 'date',
        params: { date: '2025-02-29', separator: '_', position: 'prefix' },
      }),
    ).not.toBeNull();
    expect(ruleError({ kind: 'prefix', params: { text: '../' } })).not.toBeNull();
  });
});
describe('untrusted AI rule drafts', () => {
  it('accepts only explicit whitelisted transformations', () => {
    const rules: Rule[] = [
      { kind: 'prefix', params: { text: '项目 A_' } },
      { kind: 'spaces', params: { separator: '_' } },
    ];
    expect(parseRuleDraft({ rules, explanation: '先加前缀，再替换空格' }).rules).toEqual(rules);
  });
  it('rejects operations, unknown fields, file maps, invalid dates and malformed parameters as a whole', () => {
    for (const rule of [
      { kind: 'shell', params: { command: 'rm -rf /' } },
      { kind: 'prefix', params: { text: 'safe', execute: true } },
      { kind: 'prefix', params: { text: '../' } },
      { kind: 'aiNames', params: { names: { one: 'bad.txt' }, reasons: {} } },
      { kind: 'number', params: { start: -1, digits: 3, separator: '_', position: 'suffix' } },
      { kind: 'date', params: { date: '2025-02-29', separator: '_', position: 'prefix' } },
    ])
      expect(() =>
        parseRuleDraft({ rules: [{ kind: 'trim', params: {} }, rule], explanation: '' }),
      ).toThrow();
    expect(() =>
      parseRuleDraft({ rules: [{ kind: 'trim', params: {} }], explanation: '', execute: true }),
    ).toThrow();
  });
});
