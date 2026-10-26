import { describe, it, expect } from 'vitest';
import { expressionDefaults, validCondition } from './expressions';
import { parseRule, parseRuleDraft, makeStep } from './pipeline';
import { readPresets } from './presets';
import { defaultScheme, legacyScheme } from './engine';
import { sampleFiles } from './domain';
const rule = (op: string, updates: Record<string, unknown> = {}) => ({
  kind: 'expression',
  params: { ...expressionDefaults(op), ...updates },
});
describe('shared expression grammar and versioned schemes', () => {
  it('accepts generated patterns, captures and templates rather than fixed preset text', () => {
    const draft = parseRuleDraft({
      rules: [
        rule('extract', { pattern: '^(?P<客户>.+)_(?P<号>.+)$' }),
        rule('template', { text: '{号}_{客户}' }),
      ],
      explanation: '提取重组',
    });
    expect(draft.rules).toHaveLength(2);
    expect(parseRule(rule('sequence', { group: 'field', field: '客户', step: 2 }))).not.toBeNull();
  });
  it('rejects unknown operations, unknown keys and invalid numeric limits', () => {
    for (const r of [
      rule('replace', { command: 'bad' }),
      { kind: 'expression', params: { op: 'shell', command: 'bad' } },
      rule('sequence', { step: 1.5 }),
      rule('edit', { position: -1 }),
      rule('extension', { action: 'execute' }),
    ])
      expect(parseRule(r)).toBeNull();
  });
  it('validates nested branch rules and bounds condition nesting', () => {
    expect(
      parseRule(rule('guard', { rules: [{ kind: 'shell', params: { command: 'bad' } }] })),
    ).toBeNull();
    let condition: unknown = {
      kind: 'test',
      field: 'name',
      operator: 'exists',
      value: '',
      negate: false,
    };
    for (let i = 0; i < 6; i++) condition = { kind: 'not', condition };
    expect(validCondition(condition)).toBe(false);
    expect(
      validCondition({ kind: 'test', field: 'path', operator: 'exists', value: '', negate: false }),
    ).toBe(false);
  });
  it('accepts semantic mappings only for the authorized reference IDs and preserved extensions', () => {
    const f = sampleFiles()[0];
    expect(
      parseRuleDraft(
        {
          rules: [],
          suggestions: [{ id: f.id, name: '采购合同归档.pdf', reason: '来自名称' }],
          explanation: '整理',
        },
        [f],
      ).suggestions,
    ).toHaveLength(1);
    for (const s of [
      { id: 'unknown', name: 'a.pdf', reason: '' },
      { id: f.id, name: 'a.exe', reason: '' },
      { id: f.id, name: '../a.pdf', reason: '' },
    ])
      expect(() => parseRuleDraft({ rules: [], suggestions: [s], explanation: '' }, [f])).toThrow();
  });
  it('rejects nested file maps and duplicate mapping keys from saved reusable schemes', () => {
    expect(
      parseRule(
        rule('map', {
          pairs: [
            { from: 'a', to: 'b' },
            { from: 'a', to: 'c' },
          ],
        }),
      ),
    ).toBeNull();
    const nested = rule('guard', {
      rules: [{ kind: 'aiNames', params: { names: { id: 'private.pdf' }, reasons: {} } }],
    });
    expect(
      readPresets(
        JSON.stringify([{ name: 'unsafe', steps: [{ id: '1', enabled: true, rule: nested }] }]),
      ),
    ).toEqual([]);
  });
  it('migrates older pipelines to last-dot semantics and saves new sorting options', () => {
    const steps = [makeStep({ kind: 'trim', params: {} })];
    expect(readPresets(JSON.stringify([{ name: 'old', steps }]))[0].options).toEqual(legacyScheme);
    const options = { ...defaultScheme, sort: 'natural' };
    expect(parseRuleDraft({ rules: [], explanation: '按自然顺序编号', options }).options).toEqual(
      options,
    );
    expect(() =>
      parseRuleDraft({ rules: [], explanation: '', options: { ...options, execute: true } }),
    ).toThrow();
    expect(
      readPresets(JSON.stringify([{ name: 'new', version: 3, steps, options }]))[0].options,
    ).toEqual(options);
    expect(readPresets(JSON.stringify([{ name: 'future', version: 99, steps, options }]))).toEqual(
      [],
    );
    expect(
      readPresets(
        JSON.stringify([{ name: 'bad', version: 3, steps, options: { ...options, shell: 'bad' } }]),
      ),
    ).toEqual([]);
  });
});
