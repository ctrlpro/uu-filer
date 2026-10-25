import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  applyRules,
  defaultRules,
  previewBrowser,
  sampleFiles,
  type Change,
  type FileEntry,
  type Operation,
  type PlanItem,
  type Policy,
  type Rules,
} from './domain';
import { builtinRules, readPresets, type Preset } from './presets';
import type { Prepared, Suggestion, HistoryItem } from './types';

const desktop = isTauri();
interface ExecutionDraft {
  changes: Change[];
  operation: Operation;
  destination: string | null;
  count: number;
}
export function useWorkspace() {
  const [files, setFiles] = useState<FileEntry[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState(''),
    [type, setType] = useState('all'),
    [onlyChanged, setOnlyChanged] = useState(false);
  const [tab, setTab] = useState<'rules' | 'ai' | 'presets'>('rules'),
    [rules, setRules] = useState<Rules>(defaultRules),
    [activePreset, setActivePreset] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({}),
    [reasons, setReasons] = useState<Record<string, string>>({}),
    [aiNames, setAiNames] = useState(false),
    [activeFile, setActiveFile] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation>('rename'),
    [destination, setDestination] = useState('');
  const [preview, setPreview] = useState<{ signature: string; items: PlanItem[] } | null>(null);
  const [busy, setBusy] = useState(''),
    [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [dialog, setDialog] = useState<
      'settings' | 'history' | 'execute' | 'save' | 'shortcuts' | null
    >(null),
    [executionDraft, setExecutionDraft] = useState<ExecutionDraft | null>(null);
  const [route, setRoute] = useState<'local' | 'cloud'>('local'),
    [model, setModel] = useState(''),
    [models, setModels] = useState<string[]>([]);
  const [instruction, setInstruction] = useState(
      '根据内容提炼简洁的中文名称；有可靠日期时加上日期，不猜测缺失信息，保留扩展名。',
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
        return readPresets(localStorage.getItem('uu-presets'));
      } catch {
        return [];
      }
    }),
    [presetName, setPresetName] = useState('');
  const browserInput = useRef<HTMLInputElement>(null),
    browserFolder = useRef<HTMLInputElement>(null),
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
    async (paths: string[]) =>
      run('扫描文件…', async () => {
        const list = await invoke<FileEntry[]>('add_files', { paths, recursive });
        setFiles(list.sort((a, b) => a.path.localeCompare(b.path)));
        setSelected(new Set(list.map((f) => f.id)));
        tell(`已添加 ${list.length} 个文件`);
      }),
    [recursive, run, tell],
  );
  useEffect(() => {
    if (!desktop) return;
    let unlisten: (() => void) | undefined,
      disposed = false;
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
      })
      .catch((e) => tell(String(e), true));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addPaths, tell]);
  useEffect(() => {
    if (desktop)
      invoke<{ endpoint: string; model: string }>('get_settings')
        .then((s) => {
          setEndpoint(s.endpoint);
          setCloudModel(s.model);
        })
        .catch((e) => tell(String(e), true));
  }, [tell]);
  const chosen = useMemo(() => files.filter((f) => selected.has(f.id)), [files, selected]);
  const changes = useMemo<Change[]>(() => {
    const base = aiNames
      ? chosen.map((f) => ({ id: f.id, name: f.name }))
      : applyRules(chosen, rules);
    return base.map((c) => ({ ...c, name: edits[c.id] ?? c.name }));
  }, [chosen, rules, aiNames, edits]);
  const signature = useMemo(
    () => JSON.stringify([changes, operation, destination]),
    [changes, operation, destination],
  );
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!changes.length || (operation !== 'rename' && !destination)) {
        setPreview({ signature, items: [] });
        return;
      }
      const promise = desktop
        ? invoke<PlanItem[]>('preview', { changes, operation, destination: destination || null })
        : Promise.resolve(previewBrowser(chosen, changes));
      promise
        .then((items) => {
          if (!cancelled) setPreview({ signature, items });
        })
        .catch((e) => {
          if (!cancelled) {
            setPreview(null);
            tell(String(e), true);
          }
        });
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [changes, chosen, operation, destination, signature, tell]);
  const plan = preview?.signature === signature ? preview.items : [],
    planReady = preview?.signature === signature;
  const byId = useMemo(() => new Map(plan.map((p) => [p.id, p])), [plan]);
  const changeMap = useMemo(() => new Map(changes.map((c) => [c.id, c.name])), [changes]);
  const changed = plan.filter((p) => p.changed).length,
    conflicts = plan.filter((p) => p.error).length;
  const canExecute =
    desktop &&
    planReady &&
    !busy &&
    chosen.length > 0 &&
    conflicts === 0 &&
    changed > 0 &&
    (operation === 'rename' || !!destination);
  const visible = useMemo(
    () =>
      files.filter(
        (f) =>
          (type === 'all' || f.extension === type) &&
          f.name.toLowerCase().includes(query.toLowerCase()) &&
          (!onlyChanged || (changeMap.has(f.id) && changeMap.get(f.id) !== f.name)),
      ),
    [files, type, query, onlyChanged, changeMap],
  );
  const updateRules = (patch: Partial<Rules>) => {
    setRules((r) => ({ ...r, ...patch }));
    setEdits({});
    setReasons({});
    setAiNames(false);
    setActivePreset('');
  };
  function applyPreset(id: string) {
    setRules(builtinRules(id));
    setActivePreset(id);
    setAiNames(false);
    setEdits({});
    setReasons({});
  }
  function resetRules() {
    setRules({ ...defaultRules });
    setActivePreset('');
    setAiNames(false);
    setEdits({});
    setReasons({});
  }
  function loadPreset(name: string) {
    const p = presets.find((p) => p.name === name);
    if (p) {
      setRules({ ...defaultRules, ...p.rules });
      setAiNames(false);
      setEdits({});
      setReasons({});
      setActivePreset('');
      tell(`已加载：${p.name}`);
    }
  }
  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const next = [...presets.filter((p) => p.name !== name), { name, rules: { ...rules } }];
    try {
      localStorage.setItem('uu-presets', JSON.stringify(next));
      setPresets(next);
      setPresetName('');
      setDialog(null);
      tell('方案已保存');
    } catch {
      tell('本地存储不可用，方案未保存', true);
    }
  }
  const toggle = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  function selectVisible(checked: boolean) {
    setSelected((old) => {
      const next = new Set(old);
      visible.forEach((f) => (checked ? next.add(f.id) : next.delete(f.id)));
      return next;
    });
  }
  function invertVisible() {
    setSelected((old) => {
      const next = new Set(old);
      visible.forEach((f) => (next.has(f.id) ? next.delete(f.id) : next.add(f.id)));
      return next;
    });
  }
  async function choose(directory = false) {
    if (!desktop) {
      (directory ? browserFolder : browserInput).current?.click();
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
      tell('文件操作需要桌面应用', true);
      return;
    }
    const result = await open({ directory: true, title: '选择目标目录' });
    if (typeof result === 'string') setDestination(result);
  }
  function addBrowserFiles(list: FileList | null) {
    if (!list) return;
    const items = Array.from(list)
      .filter(
        (f) => recursive || !f.webkitRelativePath || f.webkitRelativePath.split('/').length <= 2,
      )
      .map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        path: f.webkitRelativePath || f.name,
        extension: f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '',
        size: f.size,
        modified: f.lastModified,
        policy: 'local' as Policy,
      }));
    setFiles((old) => [...old, ...items]);
    setSelected((old) => new Set([...old, ...items.map((f) => f.id)]));
  }
  function loadSample() {
    const sample = sampleFiles();
    setFiles(sample);
    setSelected(new Set(sample.map((f) => f.id)));
    setEdits({});
    setReasons({});
    setAiNames(false);
    setRules(builtinRules('clean'));
    setActivePreset('clean');
    tell('示例数据 · 不修改真实文件');
  }
  async function removeSelected() {
    await run('移除条目…', async () => {
      if (desktop) await invoke('remove_files', { ids: chosen.map((f) => f.id) });
      setFiles((old) => old.filter((f) => !selected.has(f.id)));
      setSelected(new Set());
    });
  }
  async function policy(value: Policy) {
    if (!chosen.length) return;
    if (desktop)
      await run('更新权限…', async () =>
        setFiles(await invoke('set_policy', { ids: chosen.map((f) => f.id), policy: value })),
      );
    else setFiles((old) => old.map((f) => (selected.has(f.id) ? { ...f, policy: value } : f)));
  }
  async function directoryPolicy(value: Policy) {
    if (!desktop) {
      tell('目录保护需要桌面应用', true);
      return;
    }
    const path = await open({ directory: true, title: '选择保护目录（包含子目录）' });
    if (typeof path === 'string')
      await run('保存目录策略…', async () => {
        setFiles(await invoke('set_directory_policy', { path, policy: value }));
        tell('目录策略已保存；严格策略优先');
      });
  }
  async function detectModels() {
    await run('检测本地模型…', async () => {
      const list = await invoke<string[]>('local_models');
      setModels(list);
      if (list.length) setModel(list[0]);
      tell(
        list.length
          ? `${list.length} 个本地模型 · 云端功能已禁用`
          : '没有本地模型，请先用 Ollama 下载模型',
      );
    });
  }
  async function prepareAi() {
    if (!desktop || !chosen.length) return;
    await run('检查权限并准备内容…', async () =>
      setPrepared(
        await invoke('prepare_ai', {
          ids: chosen.map((f) => f.id),
          options: {
            route,
            model: route === 'local' ? model : cloudModel,
            endpoint,
            instruction,
            content,
          },
        }),
      ),
    );
  }
  async function generate() {
    if (!prepared) return;
    const current = prepared;
    setPrepared(null);
    await run(current.route === 'local' ? '本地分析…' : '云端分析…', async () => {
      const results = await invoke<Suggestion[]>('generate_ai', {
        token: current.token,
        cloudConsent: current.route === 'cloud',
      });
      setAiNames(true);
      setEdits(Object.fromEntries(results.map((s) => [s.id, s.name])));
      setReasons(Object.fromEntries(results.map((s) => [s.id, s.reason])));
      tell(`${results.length} 条建议 · ${current.count - results.length} 项未生成建议`);
    });
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
  function openExecute() {
    if (!canExecute) return;
    setExecutionDraft({
      changes: changes.map((c) => ({ ...c })),
      operation,
      destination: destination || null,
      count: changed,
    });
    setDialog('execute');
  }
  async function execute() {
    if (!executionDraft || !desktop) return;
    const current = executionDraft;
    setDialog(null);
    setExecutionDraft(null);
    await run('执行文件操作…', async () => {
      const { count: _count, ...args } = current;
      const result = await invoke<{ completed: number; error: string | null }>('execute', args);
      setFiles(await invoke('list_files'));
      setSelected(new Set());
      setEdits({});
      tell(
        result.error
          ? `已完成 ${result.completed} 项后停止：${result.error}。请在记录中恢复。`
          : `已完成 ${result.completed} 项 · 可撤销`,
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
    await run('检查并恢复文件…', async () => {
      const n = await invoke<number>('undo', { batch });
      setRecords(await invoke('history'));
      setFiles([]);
      setSelected(new Set());
      tell(`已恢复 ${n} 项 · 请重新添加文件`);
    });
  }
  function closeDialog() {
    setKey('');
    setDialog(null);
    setUndoBatch(null);
    setExecutionDraft(null);
  }
  async function saveSettings() {
    await run('保存设置…', async () => {
      await invoke('save_settings', { endpoint, model: cloudModel });
      if (key.trim()) await invoke('save_key', { endpoint, key });
      closeDialog();
      tell('设置已保存');
    });
  }
  const historyGroups = Object.values(
    records.reduce<Record<string, HistoryItem[]>>((all, r) => {
      (all[r.batch] ??= []).push(r);
      return all;
    }, {}),
  );
  return {
    desktop,
    files,
    selected,
    chosen,
    visible,
    query,
    setQuery,
    type,
    setType,
    onlyChanged,
    setOnlyChanged,
    tab,
    setTab,
    rules,
    updateRules,
    activePreset,
    applyPreset,
    resetRules,
    edits,
    setEdits,
    reasons,
    activeFile,
    setActiveFile,
    operation,
    setOperation,
    destination,
    plan,
    planReady,
    byId,
    changeMap,
    changed,
    conflicts,
    canExecute,
    busy,
    notice,
    setNotice,
    dialog,
    setDialog,
    executionDraft,
    route,
    setRoute,
    model,
    setModel,
    models,
    instruction,
    setInstruction,
    content,
    setContent,
    endpoint,
    setEndpoint,
    cloudModel,
    setCloudModel,
    key,
    setKey,
    prepared,
    undoBatch,
    setUndoBatch,
    recursive,
    setRecursive,
    dragging,
    presets,
    presetName,
    setPresetName,
    browserInput,
    browserFolder,
    tell,
    run,
    toggle,
    selectVisible,
    invertVisible,
    choose,
    chooseDestination,
    addBrowserFiles,
    loadSample,
    removeSelected,
    policy,
    directoryPolicy,
    detectModels,
    prepareAi,
    generate,
    discard,
    openExecute,
    execute,
    showHistory,
    undo,
    closeDialog,
    saveSettings,
    historyGroups,
    loadPreset,
    savePreset,
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
