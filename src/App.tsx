import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  ArrowDownAZ,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  Cloud,
  Copy,
  File,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  History,
  Info,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import {
  applyRules,
  defaultRules,
  policyLabels,
  previewBrowser,
  sampleFiles,
  sizeLabel,
  type Change,
  type FileEntry,
  type Operation,
  type PlanItem,
  type Policy,
  type Rules,
} from './domain';

const desktop = isTauri();
interface Suggestion {
  id: string;
  name: string;
  reason: string;
}
interface Prepared {
  token: string;
  route: string;
  endpoint: string;
  model: string;
  payload: {
    messages: {
      role: string;
      content: string | { type: string; text?: string; image_url?: { url: string } }[];
    }[];
  };
  skipped: { name: string; reason: string }[];
  count: number;
}
interface HistoryItem {
  id: string;
  batch: string;
  source: string;
  target: string;
  operation: string;
  state: string;
  created: number;
}
interface Preset {
  name: string;
  rules: Rules;
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      className={`modal ${wide ? 'wide' : ''}`}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <div className="modal-title">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function FileIcon({ extension }: { extension: string }) {
  return ['jpg', 'jpeg', 'png', 'webp'].includes(extension) ? (
    <FileImage size={20} />
  ) : ['pdf', 'txt', 'md', 'csv'].includes(extension) ? (
    <FileText size={20} />
  ) : (
    <File size={20} />
  );
}
export default function App() {
  const [files, setFiles] = useState<FileEntry[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [query, setQuery] = useState(''),
    [type, setType] = useState('all');
  const [tab, setTab] = useState<'rules' | 'ai'>('rules'),
    [rules, setRules] = useState<Rules>(defaultRules),
    [edits, setEdits] = useState<Record<string, string>>({}),
    [reasons, setReasons] = useState<Record<string, string>>({});
  const [operation, setOperation] = useState<Operation>('rename'),
    [destination, setDestination] = useState(''),
    [plan, setPlan] = useState<PlanItem[]>([]),
    [planReady, setPlanReady] = useState(false);
  const [busy, setBusy] = useState(''),
    [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null),
    [dialog, setDialog] = useState<'settings' | 'history' | 'execute' | null>(null);
  const [route, setRoute] = useState<'local' | 'cloud'>('local'),
    [model, setModel] = useState(''),
    [models, setModels] = useState<string[]>([]),
    [instruction, setInstruction] = useState(
      '根据文件内容提炼简洁、准确的中文名称；有可靠日期时加上日期，保留扩展名，不要猜测缺失信息。',
    ),
    [content, setContent] = useState(true);
  const [endpoint, setEndpoint] = useState('https://api.openai.com/v1'),
    [cloudModel, setCloudModel] = useState('gpt-4o-mini'),
    [key, setKey] = useState(''),
    [prepared, setPrepared] = useState<Prepared | null>(null);
  const [records, setRecords] = useState<HistoryItem[]>([]),
    [undoBatch, setUndoBatch] = useState<string | null>(null),
    [recursive, setRecursive] = useState(true),
    [dragging, setDragging] = useState(false);
  const [presets, setPresets] = useState<Preset[]>(() => {
      try {
        const parsed = JSON.parse(localStorage.getItem('uu-presets') ?? '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }),
    [presetName, setPresetName] = useState('');
  const browserInput = useRef<HTMLInputElement>(null),
    busyRef = useRef(false);
  const tell = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(label);
      try {
        await action();
      } catch (e) {
        tell(String(e), true);
      } finally {
        busyRef.current = false;
        setBusy('');
      }
    },
    [tell],
  );
  const addPaths = useCallback(
    async (paths: string[]) => {
      await run('正在扫描文件…', async () => {
        const list = await invoke<FileEntry[]>('add_files', { paths, recursive });
        setFiles(list.sort((a, b) => a.path.localeCompare(b.path)));
        setSelected(new Set(list.map((f) => f.id)));
        tell(`已添加 ${list.length} 个文件，未读取正文或上传数据`);
      });
    },
    [recursive, run, tell],
  );
  useEffect(() => {
    if (!desktop) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === 'enter') setDragging(true);
        if (e.payload.type === 'leave') setDragging(false);
        if (e.payload.type === 'drop') {
          setDragging(false);
          void addPaths(e.payload.paths);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addPaths]);
  useEffect(() => {
    if (desktop)
      invoke<{ endpoint: string; model: string }>('get_settings')
        .then((s) => {
          setEndpoint(s.endpoint);
          setCloudModel(s.model);
        })
        .catch((e) => tell(String(e), true));
  }, [tell]);
  const visible = useMemo(
    () =>
      files.filter(
        (f) =>
          (type === 'all' || f.extension === type) &&
          f.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [files, type, query],
  );
  const chosen = useMemo(() => files.filter((f) => selected.has(f.id)), [files, selected]);
  const changes = useMemo<Change[]>(() => {
    const base =
      tab === 'rules' ? applyRules(chosen, rules) : chosen.map((f) => ({ id: f.id, name: f.name }));
    return base.map((c) => ({ ...c, name: edits[c.id] ?? c.name }));
  }, [chosen, rules, tab, edits]);
  useEffect(() => {
    let cancelled = false;
    setPlanReady(false);
    const timer = setTimeout(() => {
      const promise = desktop
        ? invoke<PlanItem[]>('preview', { changes, operation, destination: destination || null })
        : Promise.resolve(previewBrowser(chosen, changes));
      promise
        .then((result) => {
          if (!cancelled) {
            setPlan(result);
            setPlanReady(true);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setPlan([]);
            tell(String(e), true);
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [changes, chosen, operation, destination, tell]);
  const byId = useMemo(() => new Map(plan.map((p) => [p.id, p])), [plan]);
  const changed = plan.filter((p) => p.changed).length,
    conflicts = plan.filter((p) => p.error).length;
  const updateRules = (patch: Partial<Rules>) => {
    setRules((r) => ({ ...r, ...patch }));
    setEdits({});
  };
  const toggle = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  async function choose(directory = false) {
    if (!desktop) {
      browserInput.current?.click();
      return;
    }
    const result = await open({
      multiple: !directory,
      directory,
      title: directory ? '添加文件夹' : '添加文件',
    });
    if (result) await addPaths(Array.isArray(result) ? result : [result]);
  }
  async function chooseDestination() {
    if (!desktop) {
      tell('浏览器演示不能操作磁盘，请运行桌面应用', true);
      return;
    }
    const result = await open({ directory: true, title: '选择目标目录' });
    if (typeof result === 'string') setDestination(result);
  }
  function loadSample() {
    const sample = sampleFiles();
    setFiles(sample);
    setSelected(new Set(sample.map((f) => f.id)));
    setEdits({});
    setRules({ ...defaultRules, find: '_副本' });
    tell('示例工作区仅用于预览；不会修改真实文件');
  }
  async function policy(value: Policy) {
    if (!chosen.length) return;
    tell('');
    if (desktop)
      await run('更新隐私权限…', async () => {
        setFiles(await invoke('set_policy', { ids: chosen.map((f) => f.id), policy: value }));
      });
    else setFiles((old) => old.map((f) => (selected.has(f.id) ? { ...f, policy: value } : f)));
  }
  async function directoryPolicy(value: Policy) {
    if (!desktop) {
      tell('目录保护需要桌面应用', true);
      return;
    }
    const path = await open({ directory: true, title: '选择要保护的目录（适用于所有子目录）' });
    if (typeof path === 'string')
      await run('设置目录保护…', async () => {
        setFiles(await invoke('set_directory_policy', { path, policy: value }));
        tell('目录策略已保存；父目录的限制优先');
      });
  }
  async function prepareAi() {
    if (!desktop) {
      tell('浏览器仅演示界面和重命名规则。AI 与文件操作需要桌面应用', true);
      return;
    }
    await run('检查权限并准备内容…', async () => {
      const result = await invoke<Prepared>('prepare_ai', {
        ids: chosen.map((f) => f.id),
        options: {
          route,
          model: route === 'local' ? model : cloudModel,
          endpoint,
          instruction,
          content,
        },
      });
      setPrepared(result);
    });
  }
  async function generate() {
    if (!prepared) return;
    const current = prepared;
    setPrepared(null);
    await run(
      current.route === 'local' ? '本地模型正在分析…' : '已授权的云端模型正在分析…',
      async () => {
        const results = await invoke<Suggestion[]>('generate_ai', {
          token: current.token,
          cloudConsent: current.route === 'cloud',
        });
        setEdits((old) => ({ ...old, ...Object.fromEntries(results.map((s) => [s.id, s.name])) }));
        setReasons(Object.fromEntries(results.map((s) => [s.id, s.reason])));
        tell(
          `收到 ${results.length} 条建议；${current.count - results.length} 个文件未生成建议。请核对后执行。`,
        );
      },
    );
  }
  async function discard() {
    if (!prepared) return;
    const token = prepared.token;
    setPrepared(null);
    try {
      await invoke('discard_ai', { token });
    } catch (e) {
      tell(String(e), true);
    }
  }
  async function execute() {
    setDialog(null);
    if (!desktop) return;
    await run('正在执行并记录操作…', async () => {
      const result = await invoke<{ batch: string; completed: number; error: string | null }>(
        'execute',
        { changes, operation, destination: destination || null },
      );
      setFiles(await invoke('list_files'));
      setSelected(new Set());
      setEdits({});
      tell(
        result.error
          ? `已完成 ${result.completed} 项后停止：${result.error}。请在操作记录中检查并恢复。`
          : `已完成 ${result.completed} 项操作，可在操作记录中撤销。`,
        !!result.error,
      );
    });
  }
  async function showHistory() {
    setDialog('history');
    if (desktop) await run('读取操作记录…', async () => setRecords(await invoke('history')));
  }
  async function undo() {
    if (!undoBatch) return;
    const batch = undoBatch;
    setUndoBatch(null);
    await run('正在检查并恢复文件…', async () => {
      const n = await invoke<number>('undo', { batch });
      setRecords(await invoke('history'));
      setFiles([]);
      setSelected(new Set());
      tell(`已恢复 ${n} 项。请重新添加文件以获取最新状态。`);
    });
  }
  const historyGroups = Object.values(
    records.reduce<Record<string, HistoryItem[]>>((all, r) => {
      (all[r.batch] ??= []).push(r);
      return all;
    }, {}),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="UU Filer 首页">
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          <span>
            uu<span className="brand-light">filer</span>
            <small>让文件井然有序</small>
          </span>
        </a>
        <div className="nav-label">工作空间</div>
        <button className="nav-item active" onClick={() => setDialog(null)}>
          <FolderOpen size={18} />
          文件工作台
          <span className="nav-dot" />
        </button>
        <button className="nav-item" onClick={() => void showHistory()}>
          <History size={18} />
          操作记录
        </button>
        <div className="sidebar-guide">
          <div className="guide-icon">
            <ShieldCheck size={23} />
          </div>
          <strong>你的文件，由你掌控</strong>
          <p>默认仅在本地处理。发送到云端前，始终需要你的授权。</p>
          <span>
            <span className="status-dot" />
            本地优先 · 隐私保护
          </span>
        </div>
        <button className="nav-item settings-nav" onClick={() => setDialog('settings')}>
          <Settings2 size={18} />
          偏好与 AI 设置
        </button>
        <div className="sidebar-footer">
          UU FILER <span>v0.1.0</span>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <span>/</span> <strong>文件工作台</strong>
          </div>
          <div className="topbar-right">
            <span className="privacy-badge">
              <ShieldCheck size={14} />
              本地优先
            </span>
            <span className="avatar">U</span>
          </div>
        </header>
        <fieldset className="main-fieldset" disabled={!!busy}>
          <div className="page-content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">A LITTLE ORDER, A LOT MORE CLARITY</div>
                <h1>
                  给文件，一个好名字<span>。</span>
                </h1>
                <p>批量整理，智能命名。把时间留给更重要的事。</p>
              </div>
              <button className="button primary" onClick={() => void choose()}>
                <Plus size={17} />
                添加文件
              </button>
            </div>
            {!desktop && (
              <div className="browser-banner">
                <Info size={16} />
                <span>浏览器演示模式：可预览规则，真实文件操作与 AI 在桌面应用中运行。</span>
                <button onClick={loadSample}>
                  载入示例 <ArrowRight size={13} />
                </button>
              </div>
            )}
            {notice?.text && (
              <div
                className={`notice ${notice.error ? 'error' : ''}`}
                role={notice.error ? 'alert' : 'status'}
              >
                <span>{notice.error ? <Info size={16} /> : <Check size={16} />}</span>
                <p>{notice.text}</p>
                <button aria-label="关闭提示" onClick={() => setNotice(null)}>
                  <X size={15} />
                </button>
              </div>
            )}
            <div className="stat-row">
              <div>
                <span className="stat-icon lavender">
                  <Folder size={18} />
                </span>
                <span>
                  <strong>{files.length}</strong>
                  <small>工作区文件</small>
                </span>
              </div>
              <div>
                <span className="stat-icon mint">
                  <CheckCheck size={18} />
                </span>
                <span>
                  <strong>{chosen.length}</strong>
                  <small>已选择文件</small>
                </span>
              </div>
              <div>
                <span className="stat-icon peach">
                  <ArrowDownAZ size={18} />
                </span>
                <span>
                  <strong>{changed}</strong>
                  <small>待执行更改</small>
                </span>
              </div>
              <div className="stat-privacy">
                <ShieldCheck size={18} />
                <span>{files.filter((f) => f.policy !== 'cloud').length} 个文件受本地策略保护</span>
              </div>
            </div>
            <div className="work-grid">
              <section className={`file-panel ${dragging ? 'dragging' : ''}`} aria-label="文件列表">
                <div className="panel-heading">
                  <h2>
                    文件列表 <span>{files.length}</span>
                  </h2>
                  <div className="heading-actions">
                    <button className="text-button" onClick={() => void choose(true)}>
                      <FolderOpen size={15} />
                      添加文件夹
                    </button>
                    <button
                      className="icon-button"
                      title="从工作区移除所选文件（不删除原文件）"
                      aria-label="移除所选文件"
                      disabled={!chosen.length}
                      onClick={() =>
                        void run('移除工作区条目…', async () => {
                          if (desktop)
                            await invoke('remove_files', { ids: chosen.map((f) => f.id) });
                          setFiles((old) => old.filter((f) => !selected.has(f.id)));
                          setSelected(new Set());
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="file-toolbar">
                  <label className="search-box">
                    <Search size={16} />
                    <input
                      aria-label="搜索文件"
                      placeholder="搜索文件名…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="筛选文件类型"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    <option value="all">所有类型</option>
                    {[...new Set(files.map((f) => f.extension))]
                      .filter(Boolean)
                      .sort()
                      .map((t) => (
                        <option key={t} value={t}>
                          {t.toUpperCase()}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="selection-bar">
                  <label>
                    <input
                      type="checkbox"
                      aria-label="选择所有可见文件"
                      checked={visible.length > 0 && visible.every((f) => selected.has(f.id))}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelected((old) => {
                          const next = new Set(old);
                          visible.forEach((f) => (checked ? next.add(f.id) : next.delete(f.id)));
                          return next;
                        });
                      }}
                    />
                    选择可见文件
                  </label>
                  <span>已选 {chosen.length}</span>
                  <select
                    aria-label="所选文件隐私策略"
                    value=""
                    disabled={!chosen.length}
                    onChange={(e) => void policy(e.target.value as Policy)}
                  >
                    <option value="" disabled>
                      设置 AI 权限
                    </option>
                    <option value="deny">禁止 AI 读取</option>
                    <option value="local">仅允许本地 AI</option>
                    <option value="cloud">允许云端 AI</option>
                  </select>
                </div>
                {files.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-illustration">
                      <div className="illustration-back" />
                      <div className="illustration-file">
                        <FileText size={38} />
                      </div>
                      <span>
                        <Plus size={18} />
                      </span>
                    </div>
                    <h3>从一组文件开始</h3>
                    <p>
                      拖入文件或文件夹，预览每一处变化。
                      <br />
                      原始文件在你确认前保持不变。
                    </p>
                    <button className="button secondary" onClick={() => void choose()}>
                      <Upload size={16} />
                      选择文件
                    </button>
                    <small>支持文档、图片、音频和视频的规则重命名</small>
                  </div>
                ) : (
                  <div className="file-table-wrap">
                    <table className="file-table">
                      <thead>
                        <tr>
                          <th className="check-col" />
                          <th>原始文件</th>
                          <th className="arrow-col" />
                          <th>新名称 / 预览</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((file) => {
                          const p = byId.get(file.id);
                          return (
                            <tr
                              key={file.id}
                              className={`${selected.has(file.id) ? 'selected' : ''} ${p?.error ? 'row-error' : ''}`}
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={`选择 ${file.name}`}
                                  checked={selected.has(file.id)}
                                  onChange={() => toggle(file.id)}
                                />
                              </td>
                              <td>
                                <div className="file-cell">
                                  <span
                                    className={`file-icon ${['jpg', 'png', 'webp', 'jpeg'].includes(file.extension) ? 'image' : ''}`}
                                  >
                                    <FileIcon extension={file.extension} />
                                  </span>
                                  <div>
                                    <span className="file-name" title={file.path}>
                                      {file.name}
                                    </span>
                                    <small>
                                      {sizeLabel(file.size)}
                                      <span className={`policy-tag ${file.policy}`}>
                                        {file.policy === 'deny' ? (
                                          <ShieldOff size={10} />
                                        ) : file.policy === 'cloud' ? (
                                          <Cloud size={10} />
                                        ) : (
                                          <LockKeyhole size={10} />
                                        )}{' '}
                                        {policyLabels[file.policy]}
                                      </span>
                                    </small>
                                  </div>
                                </div>
                              </td>
                              <td className="arrow-col">
                                <ArrowRight size={15} />
                              </td>
                              <td>
                                {selected.has(file.id) ? (
                                  <>
                                    <input
                                      className={`name-input ${p?.changed ? 'changed' : ''}`}
                                      aria-label={`${file.name} 的新名称`}
                                      value={
                                        edits[file.id] ??
                                        changes.find((c) => c.id === file.id)?.name ??
                                        file.name
                                      }
                                      onChange={(e) =>
                                        setEdits((old) => ({ ...old, [file.id]: e.target.value }))
                                      }
                                    />
                                    {p?.error ? (
                                      <small className="validation-error">{p.error}</small>
                                    ) : reasons[file.id] ? (
                                      <small className="ai-reason" title={reasons[file.id]}>
                                        <Sparkles size={10} />
                                        {reasons[file.id]}
                                      </small>
                                    ) : (
                                      <small className="result-label">
                                        {p?.changed ? '等待执行' : '名称未更改'}
                                      </small>
                                    )}
                                  </>
                                ) : (
                                  <span className="unselected-label">未选择</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {visible.length === 0 && (
                      <div className="no-results">没有匹配的文件，试试其他搜索条件。</div>
                    )}
                  </div>
                )}
                <div className="file-panel-footer">
                  <span>
                    <LockKeyhole size={12} />
                    未确认前不修改文件
                  </span>
                  <label>
                    <input
                      type="checkbox"
                      checked={recursive}
                      onChange={(e) => setRecursive(e.target.checked)}
                    />
                    添加文件夹时包含子目录
                  </label>
                </div>
              </section>
              <aside className="action-panel">
                <div className="mode-tabs">
                  <button
                    className={tab === 'rules' ? 'active' : ''}
                    onClick={() => {
                      setTab('rules');
                      setEdits({});
                      setReasons({});
                    }}
                  >
                    <Settings2 size={16} />
                    规则重命名
                  </button>
                  <button
                    className={tab === 'ai' ? 'active' : ''}
                    onClick={() => {
                      setTab('ai');
                      setEdits({});
                    }}
                  >
                    <Sparkles size={16} />
                    AI 智能命名<span>AI</span>
                  </button>
                </div>
                {tab === 'rules' ? (
                  <div className="action-body">
                    <div className="section-caption">
                      <span className="step-number">1</span>
                      <h3>设置命名规则</h3>
                      <span className="caption-extra">实时预览</span>
                    </div>
                    <div className="field">
                      <label htmlFor="find">查找与替换</label>
                      <input
                        id="find"
                        placeholder="要查找的文字，例如：_副本"
                        value={rules.find}
                        onChange={(e) => updateRules({ find: e.target.value })}
                      />
                      <input
                        aria-label="替换为"
                        placeholder="替换为（留空则删除）"
                        value={rules.replace}
                        onChange={(e) => updateRules({ replace: e.target.value })}
                      />
                    </div>
                    <div className="field-row">
                      <label>
                        添加前缀
                        <input
                          placeholder="例如：项目_"
                          value={rules.prefix}
                          onChange={(e) => updateRules({ prefix: e.target.value })}
                        />
                      </label>
                      <label>
                        添加后缀
                        <input
                          placeholder="例如：_终版"
                          value={rules.suffix}
                          onChange={(e) => updateRules({ suffix: e.target.value })}
                        />
                      </label>
                    </div>
                    <div className="field">
                      <label htmlFor="letter-case">字母大小写</label>
                      <select
                        id="letter-case"
                        value={rules.letterCase}
                        onChange={(e) =>
                          updateRules({ letterCase: e.target.value as Rules['letterCase'] })
                        }
                      >
                        <option value="keep">保持原样</option>
                        <option value="lower">全部小写</option>
                        <option value="upper">全部大写</option>
                      </select>
                    </div>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={rules.trim}
                        onChange={(e) => updateRules({ trim: e.target.checked })}
                      />
                      清除名称首尾空格
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={rules.numbering}
                        onChange={(e) => updateRules({ numbering: e.target.checked })}
                      />
                      追加顺序编号
                    </label>
                    {rules.numbering && (
                      <div className="field-row">
                        <label>
                          起始数字
                          <input
                            type="number"
                            min="0"
                            max="999999"
                            value={rules.start}
                            onChange={(e) =>
                              updateRules({
                                start: Math.max(0, Math.min(999999, Number(e.target.value))),
                              })
                            }
                          />
                        </label>
                        <label>
                          编号位数
                          <select
                            value={rules.digits}
                            onChange={(e) => updateRules({ digits: Number(e.target.value) })}
                          >
                            <option value="2">2 位 · 01</option>
                            <option value="3">3 位 · 001</option>
                            <option value="4">4 位 · 0001</option>
                          </select>
                        </label>
                      </div>
                    )}
                    <div className="hint">
                      <Info size={14} />
                      <span>规则仅修改名称，保留原有扩展名。</span>
                    </div>
                    <details className="preset-details">
                      <summary>
                        常用方案
                        <ChevronDown size={14} />
                      </summary>
                      {presets.length > 0 && (
                        <select
                          aria-label="加载命名方案"
                          value=""
                          onChange={(e) => {
                            const preset = presets.find((p) => p.name === e.target.value);
                            if (preset) {
                              setRules(preset.rules);
                              setEdits({});
                              tell(`已加载方案：${preset.name}`);
                            }
                          }}
                        >
                          <option value="">选择已保存方案</option>
                          {presets.map((p) => (
                            <option key={p.name}>{p.name}</option>
                          ))}
                        </select>
                      )}
                      <div className="preset-save">
                        <input
                          aria-label="方案名称"
                          placeholder="方案名称"
                          maxLength={40}
                          value={presetName}
                          onChange={(e) => setPresetName(e.target.value)}
                        />
                        <button
                          className="button secondary small"
                          disabled={!presetName.trim()}
                          onClick={() => {
                            const next = [
                              ...presets.filter((p) => p.name !== presetName.trim()),
                              { name: presetName.trim(), rules },
                            ];
                            try {
                              localStorage.setItem('uu-presets', JSON.stringify(next));
                              setPresets(next);
                              setPresetName('');
                              tell('命名方案已保存到此设备');
                            } catch {
                              tell('无法保存方案：本地存储不可用', true);
                            }
                          }}
                        >
                          保存
                        </button>
                      </div>
                    </details>
                  </div>
                ) : (
                  <div className="action-body">
                    <div className="section-caption">
                      <span className="step-number">
                        <Sparkles size={12} />
                      </span>
                      <h3>用一句话，整理文件</h3>
                    </div>
                    <label className="field">
                      处理方式
                      <select
                        value={route}
                        onChange={(e) => setRoute(e.target.value as 'local' | 'cloud')}
                      >
                        <option value="local">本地 Ollama · 文件不发往云端</option>
                        <option value="cloud">云端 AI · 需要发送授权</option>
                      </select>
                    </label>
                    {route === 'local' ? (
                      <div className="field">
                        <label htmlFor="model">本地模型</label>
                        <div className="model-row">
                          <select
                            id="model"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                          >
                            <option value="">选择已下载模型</option>
                            {models.map((m) => (
                              <option key={m}>{m}</option>
                            ))}
                          </select>
                          <button
                            className="button secondary small"
                            disabled={!desktop}
                            onClick={() =>
                              void run('启动独立 Ollama 实例…', async () => {
                                const list = await invoke<string[]>('local_models');
                                setModels(list);
                                if (list.length) setModel(list[0]);
                                tell(
                                  list.length
                                    ? `检测到 ${list.length} 个本地模型；独立实例已禁用云端功能`
                                    : '没有本地模型，请先使用 Ollama 下载模型',
                                );
                              })
                            }
                          >
                            检测
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="cloud-provider">
                        <Cloud size={16} />
                        <span>
                          {cloudModel}
                          <small>{endpoint}</small>
                        </span>
                        <button onClick={() => setDialog('settings')}>设置</button>
                      </div>
                    )}
                    <label className="field">
                      命名要求
                      <textarea
                        rows={5}
                        value={instruction}
                        maxLength={8000}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="例如：根据合同内容，以日期_公司_主题命名"
                      />
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={content}
                        onChange={(e) => setContent(e.target.checked)}
                      />
                      理解文件内容
                    </label>
                    <p className="field-note">
                      支持文字 PDF、文本与 JPG / PNG / WebP；图片需要视觉模型。关闭后仅发送文件名。
                    </p>
                    <div className={`privacy-callout ${route === 'cloud' ? 'cloud' : ''}`}>
                      <ShieldCheck size={18} />
                      <div>
                        <strong>
                          {route === 'local' ? '在本机，安心处理' : '先查看内容，再授权发送'}
                        </strong>
                        <p>
                          {route === 'local'
                            ? '使用应用启动的独立 Ollama 实例。禁止 AI 的文件会被跳过。'
                            : '仅处理明确允许云端的文件。生成前可查看完整发送内容。'}
                        </p>
                      </div>
                    </div>
                    <button
                      className="button ai-button"
                      disabled={!chosen.length || !desktop || (route === 'local' && !model)}
                      onClick={() => void prepareAi()}
                    >
                      <Sparkles size={16} />
                      生成命名建议<span>{chosen.length} 个文件</span>
                    </button>
                  </div>
                )}
                <div className="operation-section">
                  <div className="section-caption">
                    <span className="step-number">2</span>
                    <h3>选择执行操作</h3>
                  </div>
                  <div className="operation-options">
                    {(
                      [
                        ['rename', '重命名', ArrowDownAZ],
                        ['copy', '复制', Copy],
                        ['move', '移动', FolderOpen],
                      ] as const
                    ).map(([value, label, Icon]) => (
                      <button
                        key={value}
                        className={operation === value ? 'active' : ''}
                        onClick={() => setOperation(value)}
                      >
                        <Icon size={16} />
                        {label}
                      </button>
                    ))}
                  </div>
                  {operation !== 'rename' && (
                    <button className="destination-button" onClick={() => void chooseDestination()}>
                      <Folder size={15} />
                      <span>{destination || '选择目标目录'}</span>
                    </button>
                  )}
                </div>
              </aside>
            </div>
            <div className="bottom-bar">
              <div>
                <span className={`ready-dot ${conflicts ? 'warning' : ''}`} />
                <strong>
                  {conflicts
                    ? `${conflicts} 项冲突需要处理`
                    : changed
                      ? `${changed} 项更改已准备好`
                      : '准备好，让文件井然有序'}
                </strong>
                <small>
                  {conflicts ? '请修改名称后再执行' : '所有更改均需确认，可在操作记录中撤销'}
                </small>
              </div>
              <button
                className="button primary execute-button"
                disabled={!desktop || !planReady || !changed || !!conflicts || !!busy}
                onClick={() => setDialog('execute')}
              >
                <Check size={17} />
                确认并执行
                <ArrowRight size={16} />
              </button>
            </div>
            <footer className="page-footer">
              <span>少一点重复，多一点从容。</span>
              <span>LOCAL FIRST. ALWAYS YOURS.</span>
            </footer>
          </div>
        </fieldset>
        {busy && (
          <div className="busy-banner" role="status">
            <LoaderCircle className="spin" size={17} />
            {busy}
            <small>请等待当前任务完成</small>
          </div>
        )}
      </main>
      <input
        ref={browserInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []).map((f, i) => ({
            id: `browser-${Date.now()}-${i}`,
            name: f.name,
            path: f.name,
            extension: f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '',
            size: f.size,
            modified: f.lastModified,
            policy: 'local' as Policy,
          }));
          setFiles((old) => [...old, ...list]);
          setSelected((old) => new Set([...old, ...list.map((f) => f.id)]));
          e.target.value = '';
        }}
      />
      {dialog === 'settings' && (
        <Modal
          title="偏好与 AI 设置"
          onClose={() => {
            setKey('');
            setDialog(null);
          }}
        >
          <p className="modal-intro">
            云端 AI 为可选功能。API Key 仅保存在 Windows / macOS 系统凭据库中。
          </p>
          <label className="field">
            服务地址（包含 /v1，不包含 /chat/completions）
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label className="field">
            模型名称
            <input value={cloudModel} onChange={(e) => setCloudModel(e.target.value)} />
          </label>
          <label className="field">
            API Key
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="留空则保留已有凭据"
            />
          </label>
          <div className="hint">
            <LockKeyhole size={15} />
            <span>保存 Key 不代表同意上传文件；每次云端任务都需要单独授权。</span>
          </div>
          <div className="directory-policy">
            <h3>敏感目录保护</h3>
            <p>目录规则覆盖所有子目录；较严格的限制优先。</p>
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => void directoryPolicy('deny')}
            >
              <ShieldOff size={15} />
              选择目录 · 禁止 AI
            </button>
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => void directoryPolicy('local')}
            >
              <LockKeyhole size={15} />
              选择目录 · 仅本地 AI
            </button>
          </div>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => {
                setKey('');
                setDialog(null);
              }}
            >
              关闭
            </button>
            <button
              className="button primary"
              disabled={!desktop || !!busy}
              onClick={() =>
                void run('保存设置…', async () => {
                  await invoke('save_settings', { endpoint, model: cloudModel });
                  if (key.trim()) await invoke('save_key', { endpoint, key });
                  setKey('');
                  setDialog(null);
                  tell('设置已保存；API Key 不写入普通配置文件');
                })
              }
            >
              保存设置
            </button>
          </div>
        </Modal>
      )}
      {prepared && (
        <Modal
          wide
          title={prepared.route === 'cloud' ? '确认发送到云端的内容' : '确认本地 AI 任务'}
          onClose={() => void discard()}
        >
          <div className={`consent-summary ${prepared.route}`}>
            <ShieldCheck size={22} />
            <div>
              <strong>
                {prepared.route === 'cloud'
                  ? '以下内容将发送至指定云端服务'
                  : '仅发送至应用管理的本地 Ollama 实例'}
              </strong>
              <p>
                {prepared.endpoint} · {prepared.model} · {prepared.count} 个文件
              </p>
            </div>
          </div>
          <p className="modal-intro">本预览有效期 5 分钟。文件或权限发生变化时，任务会被拒绝。</p>
          {prepared.payload.messages.map((message, i) => (
            <div className="payload-block" key={i}>
              <span>{message.role === 'system' ? '系统命名约束' : '命名要求与文件数据'}</span>
              {typeof message.content === 'string' ? (
                <pre>{message.content}</pre>
              ) : (
                message.content.map((part, j) =>
                  part.type === 'image_url' ? (
                    <img
                      key={j}
                      src={part.image_url!.url}
                      alt="将发送的图片内容（已缩小并移除原始 EXIF）"
                    />
                  ) : (
                    <pre key={j}>{part.text}</pre>
                  ),
                )
              )}
            </div>
          ))}
          {prepared.skipped.length > 0 && (
            <div className="skipped-list">
              <strong>跳过 {prepared.skipped.length} 个文件</strong>
              {prepared.skipped.map((s, i) => (
                <p key={i}>
                  {s.name}：{s.reason}
                </p>
              ))}
            </div>
          )}
          <div className="modal-actions">
            <button className="button secondary" onClick={() => void discard()}>
              取消并清除待发送内容
            </button>
            <button className="button primary" onClick={() => void generate()}>
              {prepared.route === 'cloud' ? '同意发送以上内容' : '开始本地分析'}
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'execute' && (
        <Modal title="确认文件操作" onClose={() => setDialog(null)}>
          <div className="confirm-icon">
            <CheckCheck size={28} />
          </div>
          <p className="confirm-text">
            即将{operation === 'rename' ? '重命名' : operation === 'copy' ? '复制' : '移动'}{' '}
            <strong>{changed}</strong> 个文件。
          </p>
          {destination && operation !== 'rename' && (
            <p className="path-display">目标目录：{destination}</p>
          )}
          <p className="modal-intro">
            执行时会再次检查源文件和目标冲突。不会覆盖已有文件；操作完成后可在记录中撤销。
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDialog(null)}>
              返回检查
            </button>
            <button className="button primary" onClick={() => void execute()}>
              确认执行
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'history' && (
        <Modal
          wide
          title="操作记录与恢复"
          onClose={() => {
            setDialog(null);
            setUndoBatch(null);
          }}
        >
          <p className="modal-intro">
            记录保存在本机，最多显示最近 2,000
            项。中断任务可尝试恢复；文件被外部修改时会停止，避免覆盖。
          </p>
          {historyGroups.length === 0 ? (
            <div className="history-empty">
              <History size={32} />
              <p>还没有文件操作记录</p>
            </div>
          ) : (
            historyGroups.map((group) => (
              <div className="history-group" key={group[0].batch}>
                <div>
                  <strong>
                    {new Date(group[0].created * 1000).toLocaleString()} · {group.length} 项
                  </strong>
                  <button
                    className="button secondary small"
                    disabled={!!busy || group.every((r) => r.state === 'undone')}
                    onClick={() => setUndoBatch(group[0].batch)}
                  >
                    <Undo2 size={14} />
                    恢复 / 撤销
                  </button>
                </div>
                {group.map((r) => (
                  <p key={r.id}>
                    <span title={r.source}>
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
          {undoBatch && (
            <div className="undo-confirm">
              <p>确认恢复这批文件？会先校验内容和原位置，遇到冲突时停止。</p>
              <button className="button secondary" onClick={() => setUndoBatch(null)}>
                取消
              </button>
              <button className="button primary" disabled={!!busy} onClick={() => void undo()}>
                确认恢复
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
