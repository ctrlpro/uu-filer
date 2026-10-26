import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  previewBrowser,
  sampleFiles,
  type Change,
  type FileEntry,
  type Operation,
  type PlanItem,
  type Policy,
  policyLabels,
} from './domain';
import { readPresets, type Preset } from './presets';
import {
  localDate,
  catalogStep,
  makeStep,
  moveStep,
  parseRuleDraft,
  parseRule,
  ruleError,
  type Rule,
  type RuleStep,
  type RuleDraft,
} from './pipeline';
import type { Prepared, Suggestion, HistoryItem } from './types';
import type { FeedbackNotice, NoticeKind } from './components/Feedback';
import { containsFileNames } from './expressions';
import {
  defaultScheme,
  legacyScheme,
  evaluateDemo,
  orderFiles,
  type EngineReport,
  type EngineOptions,
  type SchemeOptions,
  type Example,
} from './engine';

const desktop = isTauri();
interface ExecutionDraft {
  changes: Change[];
  operation: Operation;
  destination: string | null;
  count: number;
}
export function draftSteps(
  draft: RuleDraft,
  existing: RuleStep[],
  mode: 'append' | 'replace',
): RuleStep[] {
  const names = draft.suggestions?.length
    ? [
        makeStep(
          {
            kind: 'aiNames',
            params: {
              names: Object.fromEntries(draft.suggestions.map((s) => [s.id, s.name])),
              reasons: Object.fromEntries(draft.suggestions.map((s) => [s.id, s.reason])),
            },
          },
          'ai',
        ),
      ]
    : [];
  return [
    ...names,
    ...(mode === 'append' ? existing : []),
    ...draft.rules.map((r) => makeStep(r, 'ai')),
  ];
}
export function useWorkspace() {
  const [files, setFiles] = useState<FileEntry[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState(''),
    [type, setType] = useState('all'),
    [onlyChanged, setOnlyChanged] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'problems' | 'unmatched'>('all');
  const [scheme, setScheme] = useState<SchemeOptions>(defaultScheme);
  const [referenceDate, setReferenceDate] = useState(localDate);
  const [evaluated, setEvaluated] = useState<{ signature: string; report: EngineReport } | null>(
    null,
  );
  const [evaluationError, setEvaluationError] = useState('');
  const [examples, setExamples] = useState<Example[]>([]),
    [draftExamples, setDraftExamples] = useState<Example[]>([]);
  const [includeRules, setIncludeRules] = useState(false);
  const [validationExamples, setValidationExamples] = useState<Example[]>([]);
  const [tab, setTab] = useState<'rules' | 'ai' | 'presets'>('rules'),
    [steps, setSteps] = useState<RuleStep[]>([]),
    [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({}),
    [activeFile, setActiveFile] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation>('rename'),
    [destination, setDestination] = useState('');
  const [preview, setPreview] = useState<{ signature: string; items: PlanItem[] } | null>(null);
  const [busy, setBusy] = useState(''),
    [notice, setNotice] = useState<FeedbackNotice | null>(null);
  const [dialog, setDialog] = useState<
      'settings' | 'history' | 'execute' | 'save' | 'shortcuts' | null
    >(null),
    [executionDraft, setExecutionDraft] = useState<ExecutionDraft | null>(null);
  const [route, setRoute] = useState<'local' | 'cloud'>('local'),
    [model, setModel] = useState(''),
    [models, setModels] = useState<string[]>([]);
  const [instruction, setInstruction] = useState(
      '参考列表中的文件名，清理末尾副本，再把空格替换为下划线，保留扩展名。',
    ),
    [content, setContent] = useState(false);
  const [aiTask, setAiTask] = useState<'rules' | 'names'>('rules'),
    [contextScope, setContextScope] = useState<'selected' | 'visible' | 'all'>('selected'),
    [aiDraft, setAiDraft] = useState<RuleDraft | null>(null);
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
  const preparedExamples = useRef<Example[]>([]);
  const noticeSequence = useRef(0);
  const tell = useCallback(
    (text: string, kind: NoticeKind | boolean = 'success') =>
      setNotice({
        id: ++noticeSequence.current,
        text,
        kind: typeof kind === 'boolean' ? (kind ? 'error' : 'success') : kind,
      }),
    [],
  );
  const dismissNotice = useCallback(
    (id: number) => setNotice((current) => (current?.id === id ? null : current)),
    [],
  );
  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setNotice(null);
      setBusy(label);
      try {
        await action();
      } catch (e) {
        tell(`${label.replace(/[.…]+$/u, '')}失败：${String(e)}`, true);
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
  const reasons = useMemo(
    () =>
      Object.assign(
        {},
        ...steps
          .filter((s) => s.enabled && s.rule.kind === 'aiNames')
          .map((s) => (s.rule.kind === 'aiNames' ? s.rule.params.reasons : {})),
      ) as Record<string, string>,
    [steps],
  );
  const parameterErrors = steps
    .filter((s) => s.enabled)
    .flatMap((s) => {
      const error = ruleError(s.rule);
      return error ? [error] : [];
    });
  const basePresetProblem = useMemo(() => {
    const reusable = steps.filter((s) => !containsFileNames(s.rule));
    if (!reusable.length) return '请先添加通用规则；逐文件 AI 建议不能保存为通用方案';
    if (reusable.some((s) => !parseRule(s.rule))) return '存在无效规则参数，完善后才能保存';
    if (reusable.some((s) => s.enabled && ruleError(s.rule))) return '请先完善已启用的规则参数';
    return null;
  }, [steps]);
  const selectedStep = steps.find((s) => s.id === selectedStepId) ?? steps.at(-1) ?? null;
  const engineOptions = useMemo<EngineOptions>(
    () => ({
      ...scheme,
      referenceDate,
      timezoneOffset: new Date().getTimezoneOffset(),
      timezoneOffsets: Object.fromEntries(
        chosen.map((f) => [f.id, new Date(f.modified / 1_000_000).getTimezoneOffset()]),
      ),
      traceId: activeFile,
    }),
    [scheme, referenceDate, activeFile, chosen],
  );
  const inspectRules = useCallback(
    async (
      rules: RuleStep[],
      constraints: Example[],
      overrides: Record<string, string> = {},
      draftOptions?: SchemeOptions,
    ): Promise<EngineReport> => {
      const report = desktop
        ? await invoke<EngineReport>('evaluate_pipeline', {
            ids: chosen.map((f) => f.id),
            steps: rules,
            options: { ...engineOptions, ...draftOptions },
            edits: overrides,
            examples: constraints,
          })
        : evaluateDemo(chosen, rules, overrides, constraints, activeFile);
      if (report.changes.length) {
        const items = desktop
          ? await invoke<PlanItem[]>('preview', {
              changes: report.changes,
              operation: destination ? operation : 'rename',
              destination: destination || null,
            })
          : previewBrowser(chosen, report.changes);
        const errors = new Map(items.filter((i) => i.error).map((i) => [i.id, i.error]));
        for (const d of report.details) {
          if (errors.get(d.id)) {
            d.error = d.error ?? errors.get(d.id)!;
            d.status = 'error';
          }
        }
        for (const e of report.examples)
          if (report.details.find((d) => d.id === e.id)?.error) e.passed = false;
      }
      return report;
    },
    [chosen, engineOptions, activeFile, operation, destination],
  );
  const evaluationSignature = useMemo(
    () =>
      JSON.stringify([
        chosen,
        steps,
        { ...engineOptions, traceId: undefined },
        edits,
        validationExamples,
      ]),
    [chosen, steps, engineOptions, edits, validationExamples],
  );
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      inspectRules(
        steps,
        validationExamples.filter((e) => selected.has(e.id)),
        edits,
      )
        .then((report) => {
          if (!cancelled) {
            setEvaluated({ signature: evaluationSignature, report });
            setEvaluationError('');
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setEvaluated(null);
            setEvaluationError(String(e));
          }
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [evaluationSignature, inspectRules, steps, edits, validationExamples, selected]);
  const engineReport = evaluated?.signature === evaluationSignature ? evaluated.report : null;
  const details = useMemo(
    () => new Map(engineReport?.details.map((d) => [d.id, d]) ?? []),
    [engineReport],
  );
  const pipelineErrors = [
    ...parameterErrors,
    ...(evaluationError ? [evaluationError] : []),
    ...(engineReport?.examples.some((e) => !e.passed) ? ['方案未满足目标示例'] : []),
  ];
  const presetProblem = basePresetProblem || evaluationError || null;
  const changes = engineReport?.changes ?? [];
  const signature = useMemo(
    () => JSON.stringify([evaluationSignature, changes, operation, destination]),
    [evaluationSignature, changes, operation, destination],
  );
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!engineReport || !changes.length || (operation !== 'rename' && !destination)) {
        setPreview({ signature, items: [] });
        return;
      }
      const promise = desktop
        ? invoke<PlanItem[]>('preview', { changes, operation, destination: destination || null })
        : Promise.resolve(previewBrowser(chosen, changes));
      promise
        .then((items) => {
          if (!cancelled)
            setPreview({
              signature,
              items: items.map((i) => ({ ...i, error: details.get(i.id)?.error ?? i.error })),
            });
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
  }, [engineReport, details, chosen, operation, destination, signature, tell]);
  const plan = preview?.signature === signature ? preview.items : [],
    planReady = !!engineReport && preview?.signature === signature;
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
    pipelineErrors.length === 0 &&
    changed > 0 &&
    (operation === 'rename' || !!destination);
  const visible = useMemo(
    () =>
      orderFiles(
        files,
        scheme,
        engineReport?.details.map((d) => d.id),
      ).filter(
        (f) =>
          (type === 'all' || f.extension === type) &&
          f.name.toLowerCase().includes(query.toLowerCase()) &&
          (statusFilter === 'all' ||
            (statusFilter === 'problems'
              ? !!details.get(f.id)?.error
              : details.get(f.id)?.unmatched || details.get(f.id)?.status === 'unmatched')) &&
          (!onlyChanged || (changeMap.has(f.id) && changeMap.get(f.id) !== f.name)),
      ),
    [files, type, query, onlyChanged, changeMap, statusFilter, details, scheme, engineReport],
  );
  const aiEntries =
    aiTask === 'names'
      ? chosen
      : contextScope === 'all'
        ? files
        : contextScope === 'visible'
          ? visible
          : chosen;
  const eligibleAiCount = aiEntries.filter((f) =>
    route === 'cloud' ? f.policy === 'cloud' : f.policy !== 'deny',
  ).length;
  function changeSteps(update: (previous: RuleStep[]) => RuleStep[]) {
    setSteps(update);
    setEdits({});
  }
  function addRule(id: string) {
    if (steps.length >= 64) {
      tell('最多叠加 64 条规则', true);
      return;
    }
    const step = catalogStep(id);
    changeSteps((old) => [...old, step]);
    setSelectedStepId(step.id);
    setTab('rules');
  }
  function selectStep(id: string) {
    setSelectedStepId(id);
    setTab('rules');
  }
  function editStep(id: string, rule: Rule) {
    changeSteps((old) => old.map((s) => (s.id === id ? { ...s, rule } : s)));
  }
  function toggleStep(id: string) {
    changeSteps((old) => old.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  }
  function deleteStep(id: string) {
    changeSteps((old) => old.filter((s) => s.id !== id));
  }
  function duplicateStep(id: string) {
    if (steps.length >= 64) {
      tell('最多叠加 64 条规则', true);
      return;
    }
    const original = steps.find((s) => s.id === id);
    if (!original) return;
    const step = { ...makeStep(original.rule, original.source), enabled: original.enabled };
    changeSteps((old) => {
      const index = old.findIndex((s) => s.id === id);
      return [...old.slice(0, index + 1), step, ...old.slice(index + 1)];
    });
    setSelectedStepId(step.id);
  }
  function reorderStep(id: string, target: string) {
    changeSteps((old) => moveStep(old, id, target));
  }
  function shiftStep(id: string, direction: number) {
    const index = steps.findIndex((s) => s.id === id),
      target = steps[index + direction];
    if (target) reorderStep(id, target.id);
  }
  function resetRules() {
    changeSteps(() => []);
    setSelectedStepId(null);
    setValidationExamples([]);
  }
  function loadPreset(name: string) {
    const preset = presets.find((p) => p.name === name);
    if (!preset) return;
    if (steps.length + preset.steps.length > 64) {
      tell('规则总数超过 64 条，请先移除部分规则', true);
      return;
    }
    const added = preset.steps.map((s) => ({ ...makeStep(s.rule), enabled: s.enabled }));
    changeSteps((old) => [...old, ...added]);
    setScheme(preset.options ?? legacyScheme);
    setValidationExamples([]);
    if (added.length) setSelectedStepId(added[0].id);
    setTab('rules');
    tell(`已追加方案：${preset.name}`);
  }
  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    if (presetProblem) {
      tell(presetProblem, true);
      return;
    }
    const reusable = steps.filter((s) => !containsFileNames(s.rule));
    if (!reusable.length) {
      tell('请先添加通用规则；逐文件 AI 建议不能保存为通用方案', true);
      return;
    }
    const next = [
      ...presets.filter((p) => p.name !== name),
      {
        name,
        version: 3 as const,
        steps: structuredClone(reusable),
        options: structuredClone(scheme),
      },
    ];
    try {
      localStorage.setItem('uu-presets', JSON.stringify(next));
      setPresets(next);
      setPresetName('');
      setDialog(null);
      tell(
        reusable.length === steps.length
          ? '规则方案已保存'
          : '通用规则已保存；逐文件 AI 建议未保存',
      );
    } catch {
      tell('本地存储不可用，方案未保存', true);
    }
  }
  async function adoptAiDraft(mode: 'append' | 'replace') {
    if (!aiDraft) return;
    const newSteps = draftSteps(aiDraft, steps, mode);
    if (newSteps.length > 64) {
      tell('规则总数超过 64 条', true);
      return;
    }
    await run('验证方案…', async () => {
      const report = await inspectRules(newSteps, draftExamples, {}, aiDraft.options);
      if (report.details.some((d) => d.error) || report.examples.some((e) => !e.passed))
        throw new Error('方案仍有问题或未满足目标示例，请调整要求后重新生成');
      changeSteps(() => newSteps);
      if (aiDraft.options) setScheme(aiDraft.options);
      setValidationExamples(draftExamples);
      setSelectedStepId(newSteps.at(-1)?.id ?? null);
      setAiDraft(null);
      setTab('rules');
      tell('AI 方案已加入预览；确认效果后再执行');
    });
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
    if (items.length) tell(`已添加 ${items.length} 个文件（浏览器演示）`);
  }
  function loadSample() {
    const sample = sampleFiles();
    setFiles(sample);
    setSelected(new Set(sample.map((f) => f.id)));
    setEdits({});
    const step = makeStep({ kind: 'cleanCopies', params: {} });
    setSteps([step]);
    setSelectedStepId(step.id);
    tell('示例数据 · 不修改真实文件', 'info');
  }
  async function removeSelected() {
    if (!chosen.length) return;
    const count = chosen.length;
    await run('移除条目…', async () => {
      if (desktop) await invoke('remove_files', { ids: chosen.map((f) => f.id) });
      setFiles((old) => old.filter((f) => !selected.has(f.id)));
      setSelected(new Set());
      tell(`已从列表移除 ${count} 项，原文件未删除`);
    });
  }
  async function policy(value: Policy) {
    if (!chosen.length) return;
    await run('更新权限…', async () => {
      if (desktop)
        setFiles(await invoke('set_policy', { ids: chosen.map((f) => f.id), policy: value }));
      else setFiles((old) => old.map((f) => (selected.has(f.id) ? { ...f, policy: value } : f)));
      tell(
        `已更新 ${chosen.length} 项 AI 权限：${policyLabels[value]}${desktop ? '' : '（仅演示）'}`,
      );
    });
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
        list.length ? 'success' : 'info',
      );
    });
  }
  async function prepareAi() {
    if (!desktop || !aiEntries.length) return;
    await run('检查权限并准备文件名…', async () => {
      const frozenExamples = aiTask === 'rules' ? structuredClone(examples) : [];
      const date = localDate();
      setReferenceDate(date);
      const result = await invoke<Prepared>('prepare_ai', {
        ids: aiEntries.map((f) => f.id),
        options: {
          task: aiTask,
          reference_date: aiTask === 'rules' ? date : undefined,
          route,
          model: route === 'local' ? model : cloudModel,
          endpoint,
          instruction,
          content: aiTask === 'names' && content,
          current_rules:
            aiTask === 'rules' && includeRules
              ? steps.filter((s) => s.enabled && !containsFileNames(s.rule)).map((s) => s.rule)
              : [],
          current_scheme: scheme,
          examples: frozenExamples,
        },
      });
      preparedExamples.current = frozenExamples;
      setPrepared(result);
    });
  }
  async function generate() {
    if (!prepared) return;
    const current = prepared;
    setPrepared(null);
    await run(current.route === 'local' ? '本地分析…' : '云端分析…', async () => {
      if (current.task === 'rules') {
        const result = await invoke<unknown>('generate_rules', {
          token: current.token,
          cloudConsent: current.route === 'cloud',
        });
        setAiDraft(
          parseRuleDraft(
            result,
            files.filter((f) => current.reference_ids?.includes(f.id)),
          ),
        );
        setDraftExamples(preparedExamples.current);
      } else {
        const results = await invoke<Suggestion[]>('generate_ai', {
          token: current.token,
          cloudConsent: current.route === 'cloud',
        });
        if (!results.length) {
          tell('未生成名称建议，原规则保持不变', 'info');
          return;
        }
        if (steps.length >= 64) {
          tell('规则已满，请移除部分规则后重新生成', true);
          return;
        }
        setAiDraft(
          parseRuleDraft(
            {
              rules: [],
              suggestions: results,
              explanation: '逐文件基础名称先运行，之后叠加普通规则。',
            },
            files.filter((f) => current.reference_ids?.includes(f.id)),
          ),
        );
        setDraftExamples([]);
      }
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
    const action = { rename: '重命名', copy: '复制', move: '移动' }[current.operation];
    await run(`${action}…`, async () => {
      const { count: _count, ...args } = current;
      const result = await invoke<{ completed: number; error: string | null }>('execute', args);
      setSelected(new Set());
      setEdits({});
      setValidationExamples([]);
      if (!result.error) setSteps((old) => old.filter((s) => s.rule.kind !== 'aiNames'));
      const outcome = result.error
        ? `${action}${result.completed ? '部分完成' : '失败'}：已完成 ${result.completed} 项。${result.error}。请在操作记录中检查或恢复。`
        : result.completed
          ? `${action}成功：${result.completed} 个文件 · 可在操作记录中撤销`
          : `没有文件被${action}`;
      tell(outcome, result.error ? 'error' : result.completed ? 'success' : 'info');
      setBusy('刷新文件列表…');
      try {
        setFiles(await invoke('list_files'));
      } catch (e) {
        setFiles([]);
        tell(
          `${outcome}；文件列表刷新失败，请重新添加文件：${String(e)}`,
          result.error ? 'error' : 'warning',
        );
      }
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
    await run('撤销并恢复文件…', async () => {
      const n = await invoke<number>('undo', { batch });
      setRecords((old) => old.map((r) => (r.batch === batch ? { ...r, state: 'undone' } : r)));
      setFiles([]);
      setSelected(new Set());
      setEdits({});
      setValidationExamples([]);
      const outcome = n ? `撤销成功：已恢复 ${n} 项 · 请重新添加文件` : '没有需要恢复的文件';
      tell(outcome, n ? 'success' : 'info');
      setBusy('刷新操作记录…');
      try {
        setRecords(await invoke('history'));
      } catch (e) {
        tell(`${outcome}；操作记录刷新失败：${String(e)}`, 'warning');
      }
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
    statusFilter,
    setStatusFilter,
    scheme,
    setScheme,
    referenceDate,
    setReferenceDate,
    engineReport,
    details,
    inspectRules,
    evaluationError,
    examples,
    setExamples,
    draftExamples,
    includeRules,
    setIncludeRules,
    setOnlyChanged,
    tab,
    setTab,
    steps,
    selectedStep,
    selectStep,
    addRule,
    editStep,
    toggleStep,
    deleteStep,
    duplicateStep,
    reorderStep,
    shiftStep,
    pipelineErrors,
    aiTask,
    setAiTask,
    contextScope,
    setContextScope,
    aiEntries,
    eligibleAiCount,
    aiDraft,
    setAiDraft,
    adoptAiDraft,
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
    dismissNotice,
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
    presetProblem,
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
