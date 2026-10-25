import { useMemo, useState } from 'react';
import { History, LockKeyhole, ShieldCheck, ShieldOff, Undo2 } from 'lucide-react';
import type { Workspace } from '../useWorkspace';
import type { AppearanceController } from '../useAppearance';
import { AppearanceControls } from './AppearanceControls';
import { Modal } from './Modal';
import { describeRule, ruleTitle } from '../pipeline';
export type SettingsTab = 'appearance' | 'ai' | 'privacy';
export function WorkspaceDialogs({
  w,
  a,
  settingsTab,
}: {
  w: Workspace;
  a: AppearanceController;
  settingsTab: SettingsTab;
}) {
  const sourceNames = useMemo(() => new Map(w.files.map((f) => [f.id, f.name])), [w.files]);
  return (
    <>
      {w.aiDraft && <AiRuleDraftDialog w={w} />}
      {w.dialog === 'settings' && <SettingsDialog w={w} a={a} initialTab={settingsTab} />}
      {w.dialog === 'save' && (
        <Modal title="保存命名方案" onClose={w.closeDialog}>
          <div className="modal-body">
            <label className="field">
              方案名称
              <input
                autoFocus
                maxLength={40}
                value={w.presetName}
                onChange={(e) => w.setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') w.savePreset();
                }}
                placeholder="例如：工作文档归档"
              />
            </label>
            {w.presets.some((p) => p.name === w.presetName.trim()) && (
              <p className="form-note">保存将更新同名方案。</p>
            )}
            {w.presetProblem && <p className="validation-error">{w.presetProblem}</p>}
            {w.steps.some((s) => s.rule.kind === 'aiNames') && (
              <p className="form-note">逐文件 AI 建议不会保存在通用方案中。</p>
            )}
          </div>
          <div className="modal-actions">
            <button onClick={w.closeDialog}>取消</button>
            <button
              className="primary"
              disabled={!w.presetName.trim() || !!w.presetProblem}
              onClick={w.savePreset}
            >
              保存
            </button>
          </div>
        </Modal>
      )}
      {w.prepared && (
        <Modal
          wide
          title={w.prepared.route === 'cloud' ? '确认云端发送' : '确认本地任务'}
          onClose={() => void w.discard()}
        >
          <div className="modal-body">
            <div className={`consent-summary ${w.prepared.route}`}>
              <ShieldCheck size={19} />
              <div>
                <strong>
                  {w.prepared.route === 'cloud'
                    ? '发送到指定云端服务'
                    : '仅发送到独立本地 Ollama 实例'}
                </strong>
                <p>
                  {w.prepared.endpoint} · {w.prepared.model} · {w.prepared.count} 个文件
                </p>
              </div>
            </div>
            <p className="form-note">
              {w.prepared.task === 'rules'
                ? '仅参考下列文件名，不读取正文。'
                : '参考下列文件名及选定内容。'}
              授权 5 分钟有效，文件或权限变化会取消任务。
            </p>
            {w.prepared.payload.messages.map((message, i) => (
              <div className="payload-block" key={i}>
                <span>{message.role === 'system' ? '系统约束' : '命名要求与文件数据'}</span>
                {typeof message.content === 'string' ? (
                  <pre>{message.content}</pre>
                ) : (
                  message.content.map((part, j) =>
                    part.type === 'image_url' ? (
                      <img
                        key={j}
                        src={part.image_url!.url}
                        alt="实际发送的图片内容（已缩小并移除原始 EXIF）"
                      />
                    ) : (
                      <pre key={j}>{part.text}</pre>
                    ),
                  )
                )}
              </div>
            ))}
            {w.prepared.skipped.length > 0 && (
              <div className="skipped-list">
                <strong>跳过 {w.prepared.skipped.length} 个文件</strong>
                {w.prepared.skipped.map((s, i) => (
                  <p key={i}>
                    {s.name}：{s.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className="modal-actions">
            <button onClick={() => void w.discard()}>取消并清除内容</button>
            <button className="primary" disabled={!!w.busy} onClick={() => void w.generate()}>
              {w.prepared.route === 'cloud' ? '同意发送以上内容' : '开始本地分析'}
            </button>
          </div>
        </Modal>
      )}
      {w.dialog === 'execute' && w.executionDraft && (
        <Modal title="确认文件操作" onClose={w.closeDialog}>
          <div className="modal-body">
            <div className="confirm-summary">
              <strong>
                {{ rename: '重命名', copy: '复制', move: '移动' }[w.executionDraft.operation]}{' '}
                {w.executionDraft.count} 个文件
              </strong>
              <span>不覆盖已有文件 · 支持撤销</span>
            </div>
            {w.executionDraft.operation !== 'rename' && (
              <p className="path-display">目标目录：{w.executionDraft.destination}</p>
            )}
            <div className="confirmation-list">
              {w.executionDraft.changes
                .filter(
                  (c) =>
                    w.executionDraft!.operation !== 'rename' || c.name !== sourceNames.get(c.id),
                )
                .map((c) => (
                  <div key={c.id}>
                    <span>{sourceNames.get(c.id)}</span>
                    <span>→</span>
                    <strong>{c.name}</strong>
                  </div>
                ))}
            </div>
          </div>
          <div className="modal-actions">
            <button onClick={w.closeDialog}>返回</button>
            <button className="primary" disabled={!!w.busy} onClick={() => void w.execute()}>
              确认执行
            </button>
          </div>
        </Modal>
      )}
      {w.dialog === 'history' && (
        <Modal wide title="操作记录与恢复" onClose={w.closeDialog}>
          <div className="modal-body">
            <p className="form-note">
              显示最近 2,000 项；撤销覆盖完整批次。内容变化或原位置冲突时停止恢复。
            </p>
            {w.historyGroups.length === 0 ? (
              <div className="history-empty">
                <History size={27} />
                暂无操作记录
              </div>
            ) : (
              w.historyGroups.map((group) => (
                <div className="history-group" key={group[0].batch}>
                  <div>
                    <strong>
                      {new Date(group[0].created * 1000).toLocaleString()} · {group.length} 项
                    </strong>
                    <button
                      disabled={!!w.busy || group.every((r) => r.state === 'undone')}
                      onClick={() => w.setUndoBatch(group[0].batch)}
                    >
                      <Undo2 size={13} />
                      恢复 / 撤销
                    </button>
                  </div>
                  {group.map((r) => (
                    <p key={r.id}>
                      <span title={`${r.source}\n→ ${r.target}`}>
                        {r.source.split(/[\\/]/).pop()} → {r.target.split(/[\\/]/).pop()}
                      </span>
                      <small>
                        {(
                          {
                            complete: '已完成',
                            undone: '已撤销',
                            planned: '待执行 / 已中断',
                            staged: '已暂存 / 已中断',
                            copied: '已复制 / 待检查',
                          } as Record<string, string>
                        )[r.state] ?? r.state}
                      </small>
                    </p>
                  ))}
                </div>
              ))
            )}
            {w.undoBatch && (
              <div className="undo-confirm">
                <p>恢复此批文件？会先检查内容和原位置。</p>
                <button onClick={() => w.setUndoBatch(null)}>取消</button>
                <button className="primary" disabled={!!w.busy} onClick={() => void w.undo()}>
                  确认恢复
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
      {w.dialog === 'shortcuts' && (
        <Modal title="快捷键" onClose={w.closeDialog}>
          <div className="modal-body">
            {[
              ['添加文件', 'Ctrl / ⌘ + O'],
              ['选择可见文件', 'Ctrl / ⌘ + A'],
              ['搜索', 'Ctrl / ⌘ + F'],
              ['执行操作', 'Ctrl / ⌘ + Enter'],
              ['关闭浮层', 'Esc'],
            ].map(([label, key]) => (
              <div className="shortcut-row" key={label}>
                {label}
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
function SettingsDialog({
  w,
  a,
  initialTab,
}: {
  w: Workspace;
  a: AppearanceController;
  initialTab: SettingsTab;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return (
    <Modal title="设置" onClose={w.closeDialog}>
      <div className="modal-body">
        <div className="settings-tabs" role="tablist" aria-label="设置分类">
          {(
            [
              ['appearance', '外观'],
              ['ai', 'AI 服务'],
              ['privacy', '隐私'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'subtle' : ''}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'appearance' && <AppearanceControls a={a} />}
        <fieldset className="control-fieldset" disabled={!!w.busy}>
          {tab === 'ai' && (
            <>
              <label className="field">
                服务地址
                <input
                  value={w.endpoint}
                  onChange={(e) => w.setEndpoint(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <p className="form-note">包含 /v1，不包含 /chat/completions</p>
              <label className="field">
                模型名称
                <input value={w.cloudModel} onChange={(e) => w.setCloudModel(e.target.value)} />
              </label>
              <label className="field">
                API Key
                <input
                  type="password"
                  autoComplete="off"
                  value={w.key}
                  onChange={(e) => w.setKey(e.target.value)}
                  placeholder="留空保留已有凭据"
                />
              </label>
              <p className="form-note">
                <LockKeyhole size={12} />
                仅保存在 Windows / macOS 系统凭据库。
              </p>
            </>
          )}
          {tab === 'privacy' && (
            <>
              <div className="section-row">
                <h3>目录保护</h3>
                <span>包含子目录 · 严格策略优先</span>
              </div>
              <div className="directory-policy">
                <button disabled={!w.desktop} onClick={() => void w.directoryPolicy('deny')}>
                  <ShieldOff size={14} />
                  选择目录 · 禁止 AI
                </button>
                <button disabled={!w.desktop} onClick={() => void w.directoryPolicy('local')}>
                  <LockKeyhole size={14} />
                  选择目录 · 仅本地 AI
                </button>
              </div>
              <p className="form-note">文件默认仅本地 AI。允许云端的文件仍需逐次确认发送。</p>
            </>
          )}
        </fieldset>
      </div>
      <div className="modal-actions">
        <button onClick={w.closeDialog}>关闭</button>
        {tab === 'ai' && (
          <button
            className="primary"
            disabled={!w.desktop || !!w.busy}
            onClick={() => void w.saveSettings()}
          >
            保存设置
          </button>
        )}
      </div>
    </Modal>
  );
}

function AiRuleDraftDialog({ w }: { w: Workspace }) {
  const [mode, setMode] = useState<'append' | 'replace'>('append'),
    [confirmed, setConfirmed] = useState(false);
  const draft = w.aiDraft!;
  const projected = (mode === 'append' ? w.steps.length : 0) + draft.rules.length;
  return (
    <Modal title="AI 规则草案" wide onClose={() => w.setAiDraft(null)}>
      <div className="modal-body">
        <p className="form-note">{draft.explanation}</p>
        <ol className="ai-draft-list">
          {draft.rules.map((rule, i) => (
            <li key={i}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <div>
                <strong>{ruleTitle(rule)}</strong>
                <small>{describeRule(rule)}</small>
              </div>
            </li>
          ))}
        </ol>
        <div className="adoption-options" role="group" aria-label="应用 AI 草案的方式">
          <label>
            <input
              type="radio"
              name="adopt"
              checked={mode === 'append'}
              onChange={() => {
                setMode('append');
                setConfirmed(false);
              }}
            />
            追加到现有 {w.steps.length} 条规则之后
          </label>
          <label>
            <input
              type="radio"
              name="adopt"
              checked={mode === 'replace'}
              onChange={() => {
                setMode('replace');
                setConfirmed(false);
              }}
            />
            替换整组规则
          </label>
        </div>
        {mode === 'replace' && w.steps.length > 0 && (
          <label className="replace-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            确认替换当前 {w.steps.length} 条规则
          </label>
        )}
        {projected > 64 && (
          <p className="validation-error">规则总数超过 64 条，请选择替换或先移除部分规则。</p>
        )}
        <p className="form-note ai-safety-note">
          加入后可编辑、排序和查看文件预览；此处不会执行文件操作。
        </p>
      </div>
      <div className="modal-actions">
        <button onClick={() => w.setAiDraft(null)}>放弃草案</button>
        <button
          className="primary"
          disabled={projected > 64 || (mode === 'replace' && w.steps.length > 0 && !confirmed)}
          onClick={() => w.adoptAiDraft(mode)}
        >
          加入应用区并预览
        </button>
      </div>
    </Modal>
  );
}
