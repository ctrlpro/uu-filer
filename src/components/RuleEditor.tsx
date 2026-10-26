import type { Workspace } from '../useWorkspace';
import { ruleError, ruleTitle, type Rule } from '../pipeline';
import { ExpressionEditor } from './ExpressionEditor';
export function RuleEditor({ w }: { w: Workspace }) {
  const step = w.selectedStep;
  const file = w.chosen.find((f) => f.id === w.activeFile) ?? w.chosen[0];
  const trace = file && step ? w.details.get(file.id)?.trace.find((t) => t.id === step.id) : null;
  if (!step) return <div className="rule-editor-empty">从规则库添加规则</div>;
  const rule = step.rule,
    error = ruleError(rule);
  const update = (next: Rule) => w.editStep(step.id, next);
  return (
    <section className="rule-editor" aria-label="规则参数编辑区">
      <div className="section-row">
        <h3>{ruleTitle(rule)}</h3>
        <span>
          {step.enabled ? '已启用' : '已停用'}
          {step.source === 'ai' ? ' · AI 生成' : ''}
        </span>
      </div>
      {rule.kind === 'expression' && (
        <ExpressionEditor
          key={step.id}
          value={rule.params}
          onChange={(params) => update({ kind: 'expression', params })}
        />
      )}
      {(rule.kind === 'prefix' || rule.kind === 'suffix') && (
        <label className="field">
          {rule.kind === 'prefix' ? '前缀文字' : '后缀文字'}
          <input
            aria-label={rule.kind === 'prefix' ? '前缀文字' : '后缀文字'}
            maxLength={1024}
            placeholder={rule.kind === 'prefix' ? '例如：项目 A_' : '例如：_归档'}
            value={rule.params.text}
            onChange={(e) => update({ ...rule, params: { text: e.target.value } })}
          />
        </label>
      )}
      {rule.kind === 'replace' && (
        <>
          <label className="field">
            查找文字
            <input
              maxLength={1024}
              value={rule.params.find}
              onChange={(e) =>
                update({ ...rule, params: { ...rule.params, find: e.target.value } })
              }
            />
          </label>
          <label className="field">
            替换为
            <input
              maxLength={1024}
              placeholder="留空删除"
              value={rule.params.replacement}
              onChange={(e) =>
                update({ ...rule, params: { ...rule.params, replacement: e.target.value } })
              }
            />
          </label>
          <p className="form-note">按文字替换，不执行正则或代码。</p>
        </>
      )}
      {rule.kind === 'spaces' && (
        <label className="field">
          空格替换为
          <input
            maxLength={16}
            aria-label="空格替换为"
            placeholder="留空删除空格"
            value={rule.params.separator}
            onChange={(e) => update({ ...rule, params: { separator: e.target.value } })}
          />
        </label>
      )}
      {rule.kind === 'number' && (
        <>
          <div className="row-fields">
            <label className="field">
              起始数字
              <input
                type="number"
                min={0}
                max={999999}
                value={rule.params.start}
                onChange={(e) =>
                  update({
                    ...rule,
                    params: {
                      ...rule.params,
                      start: Math.max(0, Math.min(999999, Math.trunc(Number(e.target.value) || 0))),
                    },
                  })
                }
              />
            </label>
            <label className="field">
              编号位数
              <select
                value={rule.params.digits}
                onChange={(e) =>
                  update({ ...rule, params: { ...rule.params, digits: Number(e.target.value) } })
                }
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} 位
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row-fields">
            <label className="field">
              编号位置
              <select
                value={rule.params.position}
                onChange={(e) =>
                  update({
                    ...rule,
                    params: { ...rule.params, position: e.target.value as 'prefix' | 'suffix' },
                  })
                }
              >
                <option value="prefix">前置</option>
                <option value="suffix">后置</option>
              </select>
            </label>
            <label className="field">
              分隔符
              <input
                maxLength={16}
                value={rule.params.separator}
                onChange={(e) =>
                  update({ ...rule, params: { ...rule.params, separator: e.target.value } })
                }
              />
            </label>
          </div>
        </>
      )}
      {rule.kind === 'date' && (
        <>
          <label className="field">
            指定日期
            <input
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={rule.params.date}
              onChange={(e) =>
                update({ ...rule, params: { ...rule.params, date: e.target.value } })
              }
            />
          </label>
          <div className="row-fields">
            <label className="field">
              日期位置
              <select
                value={rule.params.position}
                onChange={(e) =>
                  update({
                    ...rule,
                    params: { ...rule.params, position: e.target.value as 'prefix' | 'suffix' },
                  })
                }
              >
                <option value="prefix">前置</option>
                <option value="suffix">后置</option>
              </select>
            </label>
            <label className="field">
              分隔符
              <input
                maxLength={16}
                value={rule.params.separator}
                onChange={(e) =>
                  update({ ...rule, params: { ...rule.params, separator: e.target.value } })
                }
              />
            </label>
          </div>
        </>
      )}
      {rule.kind === 'case' && (
        <label className="field">
          字母大小写
          <select
            value={rule.params.mode}
            onChange={(e) =>
              update({ ...rule, params: { mode: e.target.value as 'lower' | 'upper' } })
            }
          >
            <option value="lower">全部小写</option>
            <option value="upper">全部大写</option>
          </select>
        </label>
      )}
      {['trim', 'cleanCopies', 'stripSpecial', 'removeNumber', 'extensionLower'].includes(
        rule.kind,
      ) && <p className="form-note">无需参数，按列表顺序应用。</p>}
      {rule.kind === 'aiNames' && (
        <>
          <p className="form-note">逐文件基础名称；后续规则继续叠加，不随通用方案保存。</p>
          {file && Object.hasOwn(rule.params.names, file.id) ? (
            <>
              <label className="field">
                此文件的 AI 基础名称
                <input
                  value={rule.params.names[file.id]}
                  onChange={(e) =>
                    update({
                      ...rule,
                      params: {
                        ...rule.params,
                        names: { ...rule.params.names, [file.id]: e.target.value },
                      },
                    })
                  }
                />
              </label>
              <p className="form-note">{rule.params.reasons[file.id]}</p>
            </>
          ) : (
            <p className="form-note">当前文件没有匹配的 AI 建议，保留输入名称。</p>
          )}
        </>
      )}
      {error && (
        <p className="validation-error" role="alert">
          {error}
        </p>
      )}
      {!error && w.evaluationError && (
        <p className="validation-error" role="alert">
          {w.evaluationError}
        </p>
      )}
      {file && trace && (
        <div className="step-preview">
          <div className="section-row">
            <h3>此步预览</h3>
            <span title={file.name}>{file.name}</span>
          </div>
          <label>
            输入<span data-testid="step-before">{trace.before}</span>
          </label>
          <label>
            输出<span data-testid="step-after">{trace.after}</span>
          </label>
          {Object.keys(trace.fields).length > 0 && (
            <dl className="capture-fields">
              {Object.entries(trace.fields)
                .filter(([key]) => key !== '0')
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value || '（空）'}</dd>
                  </div>
                ))}
            </dl>
          )}
          {trace.error && <p className="validation-error">{trace.error}</p>}
          {w.edits[file.id] !== undefined && <small>文件表格中有手动覆盖的最终名称。</small>}
        </div>
      )}
    </section>
  );
}
