import type { Rule } from '../pipeline';
import { ruleCatalog, ruleTitle } from '../pipeline';
import { expressionCatalog, type Expression, type Condition } from '../expressions';
const defaultCondition = (): Condition => ({
  kind: 'test',
  field: 'name',
  operator: 'contains',
  value: '',
  negate: false,
});
export function ConditionEditor({
  value,
  onChange,
  depth = 0,
}: {
  value: Condition;
  onChange: (v: Condition) => void;
  depth?: number;
}) {
  return (
    <div className="condition-editor">
      <select
        aria-label="条件组合方式"
        value={value.kind}
        onChange={(e) =>
          onChange(
            e.target.value === 'test'
              ? defaultCondition()
              : e.target.value === 'not'
                ? { kind: 'not', condition: defaultCondition() }
                : { kind: e.target.value as 'all' | 'any', conditions: [defaultCondition()] },
          )
        }
      >
        <option value="test">单个条件</option>
        <option value="all" disabled={depth >= 4}>
          全部满足（且）
        </option>
        <option value="any" disabled={depth >= 4}>
          任一满足（或）
        </option>
        <option value="not" disabled={depth >= 4}>
          取反
        </option>
      </select>
      {value.kind === 'test' ? (
        <>
          <label className="field">
            判断字段
            <input
              list="condition-fields"
              value={value.field}
              onChange={(e) => onChange({ ...value, field: e.target.value })}
            />
          </label>
          <datalist id="condition-fields">
            <option value="name">当前名称</option>
            <option value="original">原始名称</option>
            <option value="extension">扩展名（含点）</option>
            <option value="parent">父目录</option>
            <option value="field:客户">提取字段：客户</option>
          </datalist>
          <select
            aria-label="条件比较方式"
            value={value.operator}
            onChange={(e) => onChange({ ...value, operator: e.target.value })}
          >
            {[
              ['contains', '包含'],
              ['starts', '开头是'],
              ['ends', '结尾是'],
              ['equals', '等于'],
              ['regex', '正则匹配'],
              ['exists', '字段存在且非空'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {value.operator !== 'exists' && (
            <label className="field">
              比较值
              <input
                value={value.value}
                maxLength={4096}
                onChange={(e) => onChange({ ...value, value: e.target.value })}
              />
            </label>
          )}
          <label className="inline-check">
            <input
              type="checkbox"
              checked={value.negate}
              onChange={(e) => onChange({ ...value, negate: e.target.checked })}
            />
            不满足此条件时应用
          </label>
        </>
      ) : value.kind === 'not' ? (
        <ConditionEditor
          value={value.condition}
          onChange={(c) => onChange({ ...value, condition: c })}
          depth={depth + 1}
        />
      ) : (
        <>
          {value.conditions.map((c, i) => (
            <div className="condition-child" key={i}>
              <ConditionEditor
                value={c}
                onChange={(c) =>
                  onChange({
                    ...value,
                    conditions: value.conditions.map((v, n) => (n === i ? c : v)),
                  })
                }
                depth={depth + 1}
              />
              <button
                disabled={value.conditions.length === 1}
                onClick={() =>
                  onChange({ ...value, conditions: value.conditions.filter((_, n) => n !== i) })
                }
              >
                移除此条件
              </button>
            </div>
          ))}
          <button
            disabled={value.conditions.length >= 8}
            onClick={() =>
              onChange({ ...value, conditions: [...value.conditions, defaultCondition()] })
            }
          >
            添加条件
          </button>
        </>
      )}
    </div>
  );
}
function NestedRules({
  rules,
  onChange,
  depth,
}: {
  rules: Rule[];
  onChange: (r: Rule[]) => void;
  depth: number;
}) {
  return (
    <div className="nested-rules">
      {rules.map((rule, i) => (
        <details key={i} className="nested-rule">
          <summary>
            {i + 1}. {ruleTitle(rule)}
          </summary>
          {rule.kind === 'expression' ? (
            <ExpressionEditor
              value={rule.params}
              onChange={(p) =>
                onChange(rules.map((r, n) => (n === i ? { kind: 'expression', params: p } : r)))
              }
              depth={depth + 1}
            />
          ) : (
            <LegacyFields
              rule={rule}
              onChange={(next) => onChange(rules.map((r, n) => (n === i ? next : r)))}
            />
          )}
          <div className="nested-actions">
            <button
              disabled={i === 0}
              onClick={() => {
                const next = [...rules];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange(next);
              }}
            >
              上移
            </button>
            <button
              disabled={i === rules.length - 1}
              onClick={() => {
                const next = [...rules];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                onChange(next);
              }}
            >
              下移
            </button>
            <button onClick={() => onChange(rules.filter((_, n) => n !== i))}>删除步骤</button>
          </div>
        </details>
      ))}
      <select
        aria-label="添加分支规则"
        value=""
        disabled={rules.length >= 16}
        onChange={(e) => {
          const d = ruleCatalog.find((d) => d.id === e.target.value);
          if (d) onChange([...rules, d.create()]);
        }}
      >
        <option value="">＋ 添加分支规则</option>
        {ruleCatalog
          .filter(
            (d) =>
              (d.id.startsWith('expr-') ||
                [
                  'prefix',
                  'suffix',
                  'spaces',
                  'trim',
                  'lower',
                  'upper',
                  'extension',
                  'remove-number',
                ].includes(d.id)) &&
              !(depth >= 4 && d.id === 'expr-guard'),
          )
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
      </select>
    </div>
  );
}
export function LegacyFields({
  rule,
  onChange,
}: {
  rule: Exclude<Rule, { kind: 'expression' }>;
  onChange: (r: Rule) => void;
}) {
  const labels: Record<string, string> = {
    text: '名称文字',
    find: '查找文字',
    replacement: '替换为',
    separator: '分隔符',
    start: '起始数字',
    digits: '编号位数',
    date: '指定日期',
    position: '位置',
    mode: '大小写',
  };
  return (
    <>
      {Object.entries(rule.params).map(([key, value]) => {
        if (key === 'separator' && 'position' in rule.params && rule.params.position === 'replace')
          return null;
        if (typeof value !== 'string' && typeof value !== 'number') return null;
        const update = (v: string | number) =>
          onChange({ ...rule, params: { ...rule.params, [key]: v } } as Rule);
        return (
          <label className="field" key={key}>
            {labels[key] ?? key}
            {key === 'position' || key === 'mode' ? (
              <select value={value} onChange={(e) => update(e.target.value)}>
                {(key === 'position'
                  ? [
                      ['prefix', '前置'],
                      ['suffix', '后置'],
                      ['replace', '完整替换名称'],
                    ]
                  : [
                      ['lower', '小写'],
                      ['upper', '大写'],
                    ]
                ).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={typeof value === 'number' ? 'number' : key === 'date' ? 'date' : 'text'}
                value={value}
                onChange={(e) =>
                  update(typeof value === 'number' ? Number(e.target.value) : e.target.value)
                }
              />
            )}
          </label>
        );
      })}
      {Object.keys(rule.params).length === 0 && <p className="form-note">无需参数。</p>}
    </>
  );
}
export function ExpressionEditor({
  value,
  onChange,
  depth = 0,
}: {
  value: Expression;
  onChange: (v: Expression) => void;
  depth?: number;
}) {
  const def = expressionCatalog.find((d) => d.op === value.op);
  if (!def) return <p className="validation-error">未知规则</p>;
  return (
    <div className="expression-fields">
      {def.fields.map((f) => {
        const current = value[f.key];
        const change = (v: unknown) => onChange({ ...value, [f.key]: v });
        if (
          value.op === 'edit' &&
          ((f.key === 'marker' && !['before', 'after'].includes(String(value.anchor))) ||
            (f.key === 'text' && value.action !== 'insert') ||
            (f.key === 'length' && value.action === 'insert'))
        )
          return null;
        if (value.op === 'sequence' && f.key === 'field' && value.group !== 'field') return null;
        if (value.op === 'sequence' && f.key === 'separator' && value.position === 'replace')
          return null;
        if (
          value.op === 'dateFormat' &&
          f.key === 'separator' &&
          !['prefix', 'suffix'].includes(String(value.mode))
        )
          return null;
        if (value.op === 'extension' && f.key === 'text' && value.action !== 'set') return null;
        if (
          value.op === 'dateFormat' &&
          ((f.key === 'input' && ['today', 'modified'].includes(String(value.source))) ||
            (f.key === 'field' && value.source !== 'field' && value.mode !== 'field'))
        )
          return null;
        if (f.type === 'bool')
          return (
            <label className="inline-check" key={f.key}>
              <input
                type="checkbox"
                checked={current as boolean}
                onChange={(e) => change(e.target.checked)}
              />
              {f.label}
            </label>
          );
        if (f.type === 'condition')
          return (
            <section key={f.key}>
              <h4>{f.label}</h4>
              <ConditionEditor value={current as Condition} onChange={change} />
            </section>
          );
        if (f.type === 'rules')
          return (
            <section key={f.key}>
              <h4>{f.label}</h4>
              <NestedRules rules={current as Rule[]} onChange={change} depth={depth} />
            </section>
          );
        if (f.type === 'pairs') {
          const pairs = current as { from: string; to: string }[];
          return (
            <div className="mapping-editor" key={f.key}>
              <h4>{f.label}</h4>
              {pairs.map((p, i) => (
                <div className="mapping-row" key={i}>
                  <input
                    aria-label={`映射${i + 1}原文字`}
                    value={p.from}
                    onChange={(e) =>
                      change(pairs.map((p, n) => (n === i ? { ...p, from: e.target.value } : p)))
                    }
                  />
                  <span>→</span>
                  <input
                    aria-label={`映射${i + 1}新文字`}
                    value={p.to}
                    onChange={(e) =>
                      change(pairs.map((p, n) => (n === i ? { ...p, to: e.target.value } : p)))
                    }
                  />
                  <button
                    aria-label={`删除映射${i + 1}`}
                    onClick={() => change(pairs.filter((_, n) => n !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                disabled={pairs.length >= 256}
                onClick={() => change([...pairs, { from: '', to: '' }])}
              >
                添加映射
              </button>
              <small>{f.help}</small>
            </div>
          );
        }
        return (
          <label className="field" key={f.key}>
            {f.label}
            {f.type === 'enum' ? (
              <select
                aria-label={f.label}
                value={current as string}
                onChange={(e) => change(e.target.value)}
              >
                {f.options?.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label={f.label}
                type={f.type === 'number' ? 'number' : 'text'}
                min={f.min}
                max={f.max}
                maxLength={4096}
                value={current as string | number}
                spellCheck={false}
                onChange={(e) =>
                  change(f.type === 'number' ? Number(e.target.value) : e.target.value)
                }
              />
            )}
            {f.help && <small>{f.help}</small>}
          </label>
        );
      })}
    </div>
  );
}
