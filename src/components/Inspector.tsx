import { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Folder,
  GripVertical,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { Workspace } from '../useWorkspace';
import { describeRule, ruleCatalog, ruleError, ruleTitle, localDate } from '../pipeline';
import { RuleEditor } from './RuleEditor';
import { AiAssistant } from './AiAssistant';
export function Inspector({
  w,
  openSettings,
}: {
  w: Workspace;
  openSettings: (tab: 'appearance' | 'ai' | 'privacy') => void;
}) {
  const [query, setQuery] = useState(''),
    [dragging, setDragging] = useState<string | null>(null);
  const draggingId = useRef<string | null>(null);
  const matches = ruleCatalog.filter((p) =>
    (p.name + p.example).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <aside className="inspector pipeline-inspector" aria-label="操作面板">
      <div className="panel-title">
        <h2>
          <Settings2 size={14} />
          规则应用区<span className="badge-num">{w.steps.length}</span>
        </h2>
        <button
          className="icon-button"
          aria-label="清空应用区"
          title="清空应用区，不修改文件"
          disabled={!!w.busy || !w.steps.length}
          onClick={w.resetRules}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <section className="applied-section" aria-label="已应用规则">
        <fieldset className="control-fieldset" disabled={!!w.busy}>
          <ol className="applied-list" aria-label="规则执行顺序">
            {w.steps.map((step, index) => (
              <li
                key={step.id}
                data-rule-id={step.id}
                className={`applied-rule ${w.selectedStep?.id === step.id ? 'active' : ''} ${step.enabled ? '' : 'disabled'} ${dragging === step.id ? 'dragging-rule' : ''}`}
              >
                <button
                  className="step-grip"
                  aria-label={`拖动第${index + 1}条规则排序`}
                  title="拖动排序，或使用上下按钮"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    draggingId.current = step.id;
                    setDragging(step.id);
                  }}
                  onPointerUp={(e) => {
                    const target = document
                      .elementFromPoint(e.clientX, e.clientY)
                      ?.closest<HTMLElement>('[data-rule-id]')?.dataset.ruleId;
                    if (draggingId.current && target) w.reorderStep(draggingId.current, target);
                    draggingId.current = null;
                    setDragging(null);
                  }}
                  onLostPointerCapture={() => {
                    draggingId.current = null;
                    setDragging(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      w.shiftStep(step.id, e.key === 'ArrowUp' ? -1 : 1);
                    }
                  }}
                >
                  <GripVertical size={13} />
                </button>
                <input
                  type="checkbox"
                  aria-label={`启用第${index + 1}条${ruleTitle(step.rule)}`}
                  checked={step.enabled}
                  onChange={() => w.toggleStep(step.id)}
                />
                <button
                  className="step-select"
                  aria-label={`编辑第${index + 1}条${ruleTitle(step.rule)}`}
                  aria-pressed={w.selectedStep?.id === step.id}
                  onClick={() => w.selectStep(step.id)}
                >
                  <span>
                    <i>{String(index + 1).padStart(2, '0')}</i>
                    {ruleTitle(step.rule)}
                    {step.source === 'ai' && <small>AI</small>}
                  </span>
                  <small
                    className={step.enabled && ruleError(step.rule) ? 'step-error' : ''}
                    title={describeRule(step.rule)}
                  >
                    {describeRule(step.rule)}
                  </small>
                </button>
                <div className="step-actions">
                  <button
                    className="icon-button"
                    aria-label={`上移第${index + 1}条规则`}
                    disabled={index === 0}
                    onClick={() => w.shiftStep(step.id, -1)}
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`下移第${index + 1}条规则`}
                    disabled={index === w.steps.length - 1}
                    onClick={() => w.shiftStep(step.id, 1)}
                  >
                    <ArrowDown size={12} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`复制第${index + 1}条规则`}
                    onClick={() => w.duplicateStep(step.id)}
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`删除第${index + 1}条规则`}
                    onClick={() => w.deleteStep(step.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {!w.steps.length && <p className="empty-pipeline">从下方规则库添加，可叠加并排序</p>}
          <div className="pipeline-presets">
            <select
              aria-label="加载命名方案"
              value=""
              onChange={(e) => w.loadPreset(e.target.value)}
            >
              <option value="">追加我的方案</option>
              {w.presets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button disabled={!w.steps.length} onClick={() => w.setDialog('save')}>
              <Save size={13} />
              保存
            </button>
          </div>
          <details className="scheme-options">
            <summary>
              方案选项 ·{' '}
              {w.scheme.sort === 'input'
                ? '导入顺序'
                : w.scheme.sort === 'natural'
                  ? '自然排序'
                  : '自定义排序'}{' '}
              · {w.scheme.extensionMode === 'compound' ? '复合扩展名' : '末段扩展名'}
            </summary>
            <div className="row-fields">
              <label className="field">
                编号与列表排序
                <select
                  aria-label="编号与列表排序"
                  value={w.scheme.sort}
                  onChange={(e) =>
                    w.setScheme({ ...w.scheme, sort: e.target.value as typeof w.scheme.sort })
                  }
                >
                  <option value="input">导入顺序</option>
                  <option value="natural">名称自然排序</option>
                  <option value="name">名称文字排序</option>
                  <option value="modified">修改时间排序</option>
                  <option value="size">文件大小排序</option>
                </select>
              </label>
              <button
                aria-label="切换排序方向"
                aria-pressed={w.scheme.descending}
                onClick={() => w.setScheme({ ...w.scheme, descending: !w.scheme.descending })}
              >
                {w.scheme.descending ? '降序' : '升序'}
              </button>
            </div>
            <label className="field">
              扩展名识别方式
              <select
                aria-label="扩展名识别方式"
                value={w.scheme.extensionMode}
                onChange={(e) =>
                  w.setScheme({
                    ...w.scheme,
                    extensionMode: e.target.value as typeof w.scheme.extensionMode,
                  })
                }
              >
                <option value="compound">常见复合扩展名（.tar.gz 等）</option>
                <option value="last">最后一个点之后（旧方案）</option>
              </select>
            </label>
            <div className="section-row">
              <span>日期基准 {w.referenceDate}</span>
              <button onClick={() => w.setReferenceDate(localDate())}>更新为今天</button>
            </div>
          </details>
        </fieldset>
      </section>
      <div className="mode-tabs" role="tablist" aria-label="规则工作台">
        {(
          [
            ['rules', '参数编辑'],
            ['presets', '规则库'],
            ['ai', 'AI 助手'],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            role="tab"
            id={`tab-${tab}`}
            aria-controls={`pane-${tab}`}
            aria-selected={w.tab === tab}
            className={w.tab === tab ? 'active' : ''}
            onClick={() => w.setTab(tab)}
          >
            {tab === 'ai' && <Sparkles size={13} />} {label}
            {tab === 'presets' && <span className="badge-num">{ruleCatalog.length}</span>}
          </button>
        ))}
      </div>
      <div className="panel-body">
        <fieldset className="control-fieldset" disabled={!!w.busy}>
          {w.tab === 'rules' && (
            <div role="tabpanel" id="pane-rules" aria-labelledby="tab-rules">
              <section className="inline-library" aria-label="快捷规则库">
                <div className="section-row">
                  <h3>规则库</h3>
                  <button className="text-button" onClick={() => w.setTab('presets')}>
                    搜索全部规则
                  </button>
                </div>
                <div className="rule-library-chips">
                  {ruleCatalog.map((p) => (
                    <button
                      key={p.id}
                      aria-label={`添加规则：${p.name}`}
                      title={p.example}
                      onClick={() => w.addRule(p.id)}
                    >
                      <Plus size={10} />
                      {p.name}
                    </button>
                  ))}
                </div>
              </section>
              <RuleEditor w={w} />
            </div>
          )}
          {w.tab === 'presets' && (
            <div role="tabpanel" id="pane-presets" aria-labelledby="tab-presets">
              <input
                className="preset-search"
                aria-label="搜索规则库"
                placeholder="搜索规则…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {[...new Set(ruleCatalog.map((p) => p.category))].map((category) => {
                const list = matches.filter((p) => p.category === category);
                return (
                  !!list.length && (
                    <section key={category}>
                      <div className="preset-category">{category}</div>
                      <div className="preset-list">
                        {list.map((p) => (
                          <button
                            key={p.id}
                            className="preset-item"
                            aria-label={`添加规则：${p.name}`}
                            onClick={() => w.addRule(p.id)}
                          >
                            <span className="preset-symbol">{p.symbol}</span>
                            <span>
                              {p.name}
                              <small>{p.example}</small>
                            </span>
                            <Plus size={13} />
                          </button>
                        ))}
                      </div>
                    </section>
                  )
                );
              })}
              {!matches.length && <p className="empty-message">没有匹配规则</p>}
            </div>
          )}
          {w.tab === 'ai' && <AiAssistant w={w} openSettings={() => openSettings('ai')} />}
        </fieldset>
      </div>
      <div className="panel-bottom">
        <fieldset className="control-fieldset" disabled={!!w.busy}>
          <div className="operation-row">
            <span>执行操作</span>
            <div className="segmented" role="group" aria-label="文件操作">
              {(
                [
                  ['rename', '重命名'],
                  ['copy', '复制'],
                  ['move', '移动'],
                ] as const
              ).map(([op, label]) => (
                <button
                  key={op}
                  aria-pressed={w.operation === op}
                  className={w.operation === op ? 'active' : ''}
                  onClick={() => w.setOperation(op)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {w.operation !== 'rename' && (
            <button
              className="destination"
              title={w.destination || undefined}
              onClick={() => void w.chooseDestination()}
            >
              <Folder size={14} />
              <span>{w.destination || '选择目标目录'}</span>
            </button>
          )}
        </fieldset>
      </div>
    </aside>
  );
}
