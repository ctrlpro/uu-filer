import { useState, type ReactNode } from 'react';
import {
  ArrowRight,
  ChevronDown,
  Folder,
  LockKeyhole,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { Workspace } from '../useWorkspace';
import { builtins } from '../presets';
function RuleBlock({
  number,
  title,
  enabled,
  onToggle,
  children,
}: {
  number: string;
  title: string;
  enabled: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <section className={`rule-block ${children ? '' : 'compact'}`}>
      <div className="rule-head">
        <span className="counter">{number}</span>
        <h3>{title}</h3>
        <input type="checkbox" aria-label={`启用${title}`} checked={enabled} onChange={onToggle} />
      </div>
      {children && <div className="rule-controls">{children}</div>}
    </section>
  );
}
export function Inspector({
  w,
  openSettings,
}: {
  w: Workspace;
  openSettings: (tab: 'appearance' | 'ai' | 'privacy') => void;
}) {
  const [presetQuery, setPresetQuery] = useState('');
  const r = w.rules;
  const selectedFile = w.files.find((f) => f.id === w.activeFile) ?? w.chosen[0];
  const eligible = w.chosen.filter((f) =>
    w.route === 'cloud' ? f.policy === 'cloud' : f.policy !== 'deny',
  ).length;
  return (
    <aside className="inspector" aria-label="操作面板">
      <div className="panel-title">
        <h2>
          <Settings2 size={14} />
          批量操作
        </h2>
        <button
          className="icon-button"
          aria-label="重置规则"
          disabled={!!w.busy}
          onClick={w.resetRules}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <div className="mode-tabs" role="tablist" aria-label="命名方式">
        {(
          [
            ['rules', '规则'],
            ['ai', 'AI 命名'],
            ['presets', '内置规则'],
          ] as const
        ).map(([tab, label]) => (
          <button
            role="tab"
            aria-selected={w.tab === tab}
            aria-controls={`pane-${tab}`}
            id={`tab-${tab}`}
            key={tab}
            className={w.tab === tab ? 'active' : ''}
            onClick={() => w.setTab(tab)}
          >
            {tab === 'ai' && <Sparkles size={13} />} {label}
            {tab === 'presets' && <span className="badge-num">12</span>}
          </button>
        ))}
      </div>
      <div className="panel-body">
        <fieldset className="control-fieldset" disabled={!!w.busy}>
          {w.tab === 'rules' && (
            <div role="tabpanel" id="pane-rules" aria-labelledby="tab-rules">
              <div className="section-row">
                <h3>常用规则</h3>
                <button
                  className="icon-button"
                  aria-label="查看全部内置规则"
                  onClick={() => w.setTab('presets')}
                >
                  <ArrowRight size={13} />
                </button>
              </div>
              <div className="quick-presets">
                {['clean', 'number', 'date', 'spaces'].map((id) => {
                  const p = builtins.find((p) => p.id === id)!;
                  return (
                    <button
                      key={id}
                      aria-pressed={w.activePreset === id}
                      className={w.activePreset === id ? 'active' : ''}
                      onClick={() => w.applyPreset(id)}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
              <RuleBlock
                number="01"
                title="查找替换"
                enabled={r.replaceEnabled !== false}
                onToggle={() => w.updateRules({ replaceEnabled: r.replaceEnabled === false })}
              >
                <label>
                  查找
                  <input
                    aria-label="查找文字"
                    placeholder="要查找的文字"
                    value={r.find}
                    onChange={(e) => w.updateRules({ find: e.target.value, replaceEnabled: true })}
                  />
                </label>
                <label>
                  替换为
                  <input
                    placeholder="留空删除"
                    aria-label="替换为"
                    value={r.replace}
                    onChange={(e) =>
                      w.updateRules({ replace: e.target.value, replaceEnabled: true })
                    }
                  />
                </label>
                <label className="full inline-check">
                  <input
                    type="checkbox"
                    checked={!!r.cleanCopies}
                    onChange={(e) =>
                      w.updateRules({ cleanCopies: e.target.checked, replaceEnabled: true })
                    }
                  />
                  清理副本、copy、括号序号
                </label>
              </RuleBlock>
              <RuleBlock
                number="02"
                title="前缀 / 后缀"
                enabled={r.affixEnabled !== false}
                onToggle={() => w.updateRules({ affixEnabled: r.affixEnabled === false })}
              >
                <label>
                  前缀
                  <input
                    placeholder="例如：项目_"
                    value={r.prefix}
                    onChange={(e) => w.updateRules({ prefix: e.target.value, affixEnabled: true })}
                  />
                </label>
                <label>
                  后缀
                  <input
                    placeholder="例如：_归档"
                    value={r.suffix}
                    onChange={(e) => w.updateRules({ suffix: e.target.value, affixEnabled: true })}
                  />
                </label>
              </RuleBlock>
              <RuleBlock
                number="03"
                title="顺序编号"
                enabled={r.numbering}
                onToggle={() => w.updateRules({ numbering: !r.numbering })}
              >
                <label>
                  起始数字
                  <input
                    type="number"
                    min={0}
                    max={999999}
                    value={r.start}
                    onChange={(e) =>
                      w.updateRules({
                        start: Math.max(0, Math.min(999999, Number(e.target.value) || 0)),
                        numbering: true,
                      })
                    }
                  />
                </label>
                <label>
                  编号格式
                  <select
                    value={r.digits}
                    onChange={(e) =>
                      w.updateRules({ digits: Number(e.target.value), numbering: true })
                    }
                  >
                    <option value={2}>01 · 两位</option>
                    <option value={3}>001 · 三位</option>
                    <option value={4}>0001 · 四位</option>
                  </select>
                </label>
              </RuleBlock>
              <RuleBlock
                number="04"
                title="清除首尾空格"
                enabled={r.trim}
                onToggle={() => w.updateRules({ trim: !r.trim })}
              />
              <label className="field case-field">
                字母大小写
                <select
                  value={r.letterCase}
                  onChange={(e) =>
                    w.updateRules({ letterCase: e.target.value as typeof r.letterCase })
                  }
                >
                  <option value="keep">保持原样</option>
                  <option value="lower">全部小写</option>
                  <option value="upper">全部大写</option>
                </select>
              </label>
              <details
                className="advanced-rules"
                key={String(
                  !!(
                    r.spacesToUnderscore ||
                    r.stripSpecial ||
                    r.removeLeadingNumber ||
                    r.extensionLower
                  ),
                )}
                open={
                  !!(
                    r.spacesToUnderscore ||
                    r.stripSpecial ||
                    r.removeLeadingNumber ||
                    r.extensionLower
                  )
                }
              >
                <summary>
                  更多规则
                  <ChevronDown size={12} />
                </summary>
                {(
                  [
                    ['spacesToUnderscore', '空格转下划线'],
                    ['stripSpecial', '去除特殊字符'],
                    ['removeLeadingNumber', '移除起始编号'],
                    ['extensionLower', '扩展名小写'],
                  ] as const
                ).map(([key, label]) => (
                  <label className="inline-check" key={key}>
                    <input
                      type="checkbox"
                      checked={!!r[key]}
                      onChange={(e) => w.updateRules({ [key]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </details>
              <div className="presets-footer">
                <select
                  aria-label="加载命名方案"
                  value=""
                  onChange={(e) => w.loadPreset(e.target.value)}
                >
                  <option value="">我的命名方案</option>
                  {w.presets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button onClick={() => w.setDialog('save')}>
                  <Save size={13} />
                  保存
                </button>
              </div>
            </div>
          )}
          {w.tab === 'presets' && (
            <div role="tabpanel" id="pane-presets" aria-labelledby="tab-presets">
              <input
                className="preset-search"
                aria-label="搜索内置规则"
                placeholder="搜索内置规则…"
                value={presetQuery}
                onChange={(e) => setPresetQuery(e.target.value)}
              />
              {['清理与规范', '编号与归档'].map((category) => {
                const list = builtins.filter(
                  (p) => p.category === category && (p.name + p.example).includes(presetQuery),
                );
                return (
                  list.length > 0 && (
                    <section key={category}>
                      <div className="preset-category">{category}</div>
                      <div className="preset-list">
                        {list.map((p) => (
                          <button
                            key={p.id}
                            className={`preset-item ${w.activePreset === p.id ? 'active' : ''}`}
                            aria-label={p.name}
                            aria-pressed={w.activePreset === p.id}
                            onClick={() => w.applyPreset(p.id)}
                          >
                            <span className="preset-symbol">{p.symbol}</span>
                            <span>
                              {p.name}
                              <small>{p.example}</small>
                            </span>
                            <ArrowRight size={13} />
                          </button>
                        ))}
                      </div>
                    </section>
                  )
                );
              })}
              {!builtins.some((p) => (p.name + p.example).includes(presetQuery)) && (
                <p className="empty-message">没有匹配规则</p>
              )}
            </div>
          )}
          {w.tab === 'ai' && (
            <div role="tabpanel" id="pane-ai" aria-labelledby="tab-ai">
              <label className="field">
                处理方式
                <select
                  value={w.route}
                  onChange={(e) => w.setRoute(e.target.value as 'local' | 'cloud')}
                >
                  <option value="local">本地 Ollama</option>
                  <option value="cloud">云端 API</option>
                </select>
              </label>
              {w.route === 'local' ? (
                <label className="field">
                  本地模型
                  <div className="model-row">
                    <select value={w.model} onChange={(e) => w.setModel(e.target.value)}>
                      <option value="">选择已下载模型</option>
                      {w.models.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                    <button disabled={!w.desktop} onClick={() => void w.detectModels()}>
                      检测
                    </button>
                  </div>
                </label>
              ) : (
                <div className="cloud-provider">
                  <span>
                    <CloudIcon />
                    {w.cloudModel}
                    <small title={w.endpoint}>{w.endpoint}</small>
                  </span>
                  <button className="text-button" onClick={() => openSettings('ai')}>
                    设置
                  </button>
                </div>
              )}
              <label className="field">
                命名要求
                <textarea
                  rows={5}
                  maxLength={8000}
                  value={w.instruction}
                  onChange={(e) => w.setInstruction(e.target.value)}
                />
              </label>
              <div className="quick-presets">
                {[
                  ['合同', '按合同内容，以“日期_公司_主题”命名；缺失信息不猜测，保留扩展名。'],
                  ['票据', '按票据内容，以“日期_商户_金额”命名；缺失信息不猜测，保留扩展名。'],
                  ['照片', '根据画面提炼简洁主题；仅使用可确认的日期，保留扩展名。'],
                  [
                    '会议',
                    '依据现有文本或支持的文件内容提炼会议主题；缺失信息不猜测，保留扩展名。',
                  ],
                ].map(([label, prompt]) => (
                  <button key={label} onClick={() => w.setInstruction(prompt)}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={w.content}
                  onChange={(e) => w.setContent(e.target.checked)}
                />
                理解文件内容
              </label>
              <details className="supported-formats">
                <summary>支持格式与限制</summary>
                <p>
                  文本、文字 PDF、JPG / PNG / WebP。图片需要视觉模型，每批最多 20 个文件。Office
                  正文、OCR 和音视频转写尚未支持。
                </p>
              </details>
              <div className={`ai-permissions ${w.route === 'cloud' ? 'cloud' : ''}`}>
                <span>
                  <ShieldCheck size={13} />
                  {w.route === 'local' ? '仅本地处理' : '逐次授权云端发送'}
                </span>
                <span>
                  {eligible} 可处理 · {w.chosen.length - eligible} 跳过
                </span>
              </div>
              <button
                className="primary ai-action"
                disabled={
                  !w.desktop ||
                  !w.chosen.length ||
                  w.chosen.length > 20 ||
                  (w.route === 'local' && !w.model)
                }
                onClick={() => void w.prepareAi()}
              >
                <Sparkles size={14} />
                查看内容并生成
              </button>
              <div className="ai-result">
                <div className="section-row">
                  <h3>命名依据</h3>
                  <span>选中文件查看</span>
                </div>
                <strong>{selectedFile?.name ?? '未选择文件'}</strong>
                <p>{selectedFile ? (w.reasons[selectedFile.id] ?? '未生成建议') : '—'}</p>
              </div>
            </div>
          )}
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
function CloudIcon() {
  return <LockKeyhole size={13} />;
}
