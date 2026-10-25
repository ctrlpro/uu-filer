import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Folder,
  History,
  Info,
  Keyboard,
  Layers3,
  Library,
  LoaderCircle,
  Moon,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  X,
  Files,
} from 'lucide-react';
import { sizeLabel, type Policy } from './domain';
import { useWorkspace } from './useWorkspace';
import { useAppearance } from './useAppearance';
import { AppearanceControls } from './components/AppearanceControls';
import { FileTable } from './components/FileTable';
import { Inspector } from './components/Inspector';
import { WorkspaceDialogs, type SettingsTab } from './components/WorkspaceDialogs';

export default function App() {
  const w = useWorkspace(),
    a = useAppearance();
  const [appearanceOpen, setAppearanceOpen] = useState(false),
    [importOpen, setImportOpen] = useState(false),
    [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');
  const popoverRef = useRef<HTMLDivElement>(null),
    importRef = useRef<HTMLDivElement>(null),
    searchRef = useRef<HTMLInputElement>(null),
    appearanceButton = useRef<HTMLButtonElement>(null),
    splitterDragging = useRef(false),
    appRef = useRef<HTMLDivElement>(null);
  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab);
    setAppearanceOpen(false);
    w.setDialog('settings');
  };
  useEffect(() => {
    if (!appearanceOpen && !importOpen) return;
    const click = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popoverRef.current?.contains(target)) setAppearanceOpen(false);
      if (!importRef.current?.contains(target)) setImportOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAppearanceOpen(false);
        setImportOpen(false);
        appearanceButton.current?.focus();
      }
    };
    document.addEventListener('pointerdown', click);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', click);
      document.removeEventListener('keydown', escape);
    };
  }, [appearanceOpen, importOpen]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || w.busy) return;
      const editing =
        e.target instanceof HTMLElement &&
        !!e.target.closest('input,textarea,select,[contenteditable=true]');
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'Enter') {
          e.preventDefault();
          w.openExecute();
        } else if (e.key.toLowerCase() === 'o') {
          e.preventDefault();
          void w.choose();
        } else if (e.key.toLowerCase() === 'f') {
          e.preventDefault();
          searchRef.current?.focus();
        } else if (e.key.toLowerCase() === 'a' && !editing) {
          e.preventDefault();
          w.selectVisible(true);
        }
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [w]);
  const totalSize = w.files.reduce((sum, f) => sum + f.size, 0);
  function chooseTab(tab: typeof w.tab) {
    w.setTab(tab);
    a.update({ panelOpen: true });
  }
  return (
    <div className={`app ${a.settings.panelOpen ? '' : 'panel-hidden'}`} ref={appRef}>
      <header className="topbar">
        <span className="logo">
          <Layers3 size={18} />
        </span>
        <strong className="brand">uu filer</strong>
        <span className="top-separator" />
        <div className="breadcrumb">
          <span>工作区</span>
          <span>/</span>
          <strong>文件工作台</strong>
          <span className="badge-num">{w.files.length}</span>
        </div>
        {!w.desktop && <span className="preview-pill">浏览器演示</span>}
        <div className="top-spacer" />
        <span className="local-badge" title="默认仅本地处理">
          <ShieldCheck size={13} />
          本地优先
        </span>
        <button className="icon-button" aria-label="操作记录" onClick={() => void w.showHistory()}>
          <History size={16} />
        </button>
        <button
          className="icon-button"
          aria-label={a.dark ? '切换浅色主题' : '切换深色主题'}
          onClick={a.toggleTheme}
        >
          {a.dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <div className="theme-control" ref={popoverRef}>
          <button
            className={`icon-button ${appearanceOpen ? 'pressed' : ''}`}
            ref={appearanceButton}
            aria-label="全局外观"
            aria-expanded={appearanceOpen}
            onClick={() => setAppearanceOpen(!appearanceOpen)}
          >
            <Palette size={16} />
          </button>
          {appearanceOpen && (
            <div className="appearance-popover" role="dialog" aria-label="全局外观设置">
              <AppearanceControls a={a} />
            </div>
          )}
        </div>
        <button
          className="icon-button"
          aria-label="偏好与 AI 设置"
          onClick={() => openSettings('appearance')}
        >
          <Settings2 size={16} />
        </button>
      </header>
      <nav className="rail" aria-label="工作区导航">
        <button
          className={w.tab === 'rules' ? 'active' : ''}
          aria-label="文件工作台"
          title="文件工作台"
          onClick={() => chooseTab('rules')}
        >
          <Files size={18} />
        </button>
        <button
          className={w.tab === 'presets' ? 'active' : ''}
          aria-label="内置规则库"
          title="内置规则"
          onClick={() => chooseTab('presets')}
        >
          <Library size={18} />
        </button>
        <button
          className={w.tab === 'ai' ? 'active' : ''}
          aria-label="AI 命名面板"
          title="AI 命名"
          onClick={() => chooseTab('ai')}
        >
          <Sparkles size={18} />
        </button>
        <button aria-label="历史与恢复" title="历史与恢复" onClick={() => void w.showHistory()}>
          <History size={18} />
        </button>
        <button
          className="rail-bottom"
          aria-label="键盘快捷键"
          title="快捷键"
          onClick={() => w.setDialog('shortcuts')}
        >
          <Keyboard size={18} />
        </button>
        <button aria-label="隐私设置" title="隐私策略" onClick={() => openSettings('privacy')}>
          <ShieldCheck size={18} />
        </button>
      </nav>
      <section className={`files-area ${w.dragging ? 'dragging' : ''}`} aria-label="文件工作区">
        <fieldset className="file-toolbar control-fieldset" disabled={!!w.busy}>
          <button className="primary" onClick={() => void w.choose()}>
            <Plus size={14} />
            添加文件
          </button>
          <div className="folder-control" ref={importRef}>
            <div className="split-button">
              <button onClick={() => void w.choose(true)}>
                <Folder size={14} />
                <span className="button-text">添加文件夹</span>
              </button>
              <button
                aria-label="文件夹导入选项"
                aria-expanded={importOpen}
                onClick={() => setImportOpen(!importOpen)}
              >
                <ChevronDown size={12} />
              </button>
            </div>
            {importOpen && (
              <div className="import-popover">
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={w.recursive}
                    onChange={(e) => w.setRecursive(e.target.checked)}
                  />
                  包含子目录
                </label>
              </div>
            )}
          </div>
          <button
            className="icon-button"
            aria-label="移除所选文件"
            title="从工作区移除，不删除原文件"
            disabled={!w.chosen.length}
            onClick={() => void w.removeSelected()}
          >
            <Trash2 size={15} />
          </button>
          <span className="top-separator" />
          {!w.desktop && w.files.length > 0 && (
            <button className="text-button" onClick={w.loadSample}>
              载入示例
            </button>
          )}
          <label className="search">
            <Search size={14} />
            <input
              ref={searchRef}
              aria-label="搜索文件"
              placeholder="搜索文件…"
              value={w.query}
              onChange={(e) => w.setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="筛选文件类型"
            value={w.type}
            onChange={(e) => w.setType(e.target.value)}
          >
            <option value="all">全部类型</option>
            {[...new Set(w.files.map((f) => f.extension))]
              .filter(Boolean)
              .sort()
              .map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
          </select>
          <button
            className="icon-button"
            aria-label={a.settings.panelOpen ? '收起操作面板' : '展开操作面板'}
            title={a.settings.panelOpen ? '收起操作面板' : '展开操作面板'}
            onClick={() => a.update({ panelOpen: !a.settings.panelOpen })}
          >
            {a.settings.panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </fieldset>
        <fieldset className="selection-tools control-fieldset" disabled={!!w.busy}>
          <label>
            <input
              type="checkbox"
              aria-label="选择所有可见文件"
              checked={!!w.visible.length && w.visible.every((f) => w.selected.has(f.id))}
              onChange={(e) => w.selectVisible(e.target.checked)}
            />
            已选 {w.chosen.length} 项
          </label>
          <button onClick={w.invertVisible}>反选</button>
          <span className="push" />
          <button
            className={w.onlyChanged ? 'active' : ''}
            aria-pressed={w.onlyChanged}
            onClick={() => w.setOnlyChanged(!w.onlyChanged)}
          >
            仅看更改
          </button>
          <select
            aria-label="所选文件隐私策略"
            value=""
            disabled={!w.chosen.length}
            onChange={(e) => void w.policy(e.target.value as Policy)}
          >
            <option value="" disabled>
              AI 权限
            </option>
            <option value="deny">禁止 AI</option>
            <option value="local">仅本地 AI</option>
            <option value="cloud">允许云端</option>
          </select>
        </fieldset>
        {!w.desktop && w.files.length === 0 && (
          <div className="demo-note">
            <Info size={12} />
            浏览器仅预览规则；文件操作与 AI 请使用桌面应用。
          </div>
        )}
        {w.notice?.text && (
          <div
            className={`notice ${w.notice.error ? 'error' : ''}`}
            role={w.notice.error ? 'alert' : 'status'}
          >
            <span>{w.notice.text}</span>
            <button className="icon-button" aria-label="关闭提示" onClick={() => w.setNotice(null)}>
              <X size={13} />
            </button>
          </div>
        )}
        <FileTable
          w={w}
          compact={a.settings.density === 'compact'}
          showSize={a.settings.showSize}
        />
        <div className="table-bottom">
          <span>
            {w.files.length} 个文件 · 显示 {w.visible.length} 项
          </span>
          <span>共 {sizeLabel(totalSize)}</span>
          <span>修改前预览</span>
        </div>
      </section>
      {a.settings.panelOpen && (
        <>
          <div
            className="splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整操作面板宽度"
            aria-valuenow={Math.round(a.settings.panelWidth)}
            aria-valuemin={290}
            aria-valuemax={470}
            tabIndex={0}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              splitterDragging.current = true;
            }}
            onPointerMove={(e) => {
              if (splitterDragging.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
                const right = appRef.current?.getBoundingClientRect().right ?? innerWidth;
                a.update({ panelWidth: right - e.clientX });
              }
            }}
            onPointerUp={() => {
              splitterDragging.current = false;
            }}
            onLostPointerCapture={() => {
              splitterDragging.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                a.update({
                  panelWidth: a.settings.panelWidth + (e.key === 'ArrowLeft' ? 10 : -10),
                });
              }
            }}
          />
          <Inspector w={w} openSettings={openSettings} />
        </>
      )}
      <footer className="statusbar">
        <span className={`status-dot ${w.conflicts ? 'warning' : ''}`} />
        <div className="counts">
          <span>
            已选 <b>{w.chosen.length}</b>
          </span>
          <span>
            更改 <b data-testid="changed-count">{w.changed}</b>
          </span>
          <span className={w.conflicts ? 'conflict-count' : ''}>
            冲突 <b>{w.conflicts}</b>
          </span>
        </div>
        <div className="top-spacer" />
        {w.busy ? (
          <span className="busy-label" role="status">
            <LoaderCircle size={14} className="spin" />
            {w.busy}
          </span>
        ) : (
          <span className="shortcut-hint">Ctrl / ⌘ + Enter</span>
        )}
        <button onClick={() => void w.showHistory()} disabled={!!w.busy}>
          <History size={13} />
          历史 / 恢复
        </button>
        <button
          className="primary"
          aria-label="确认并执行"
          disabled={!w.canExecute}
          onClick={w.openExecute}
        >
          <Check size={14} />
          {w.operation === 'rename'
            ? `执行 ${w.changed} 项更改`
            : `${w.operation === 'copy' ? '复制' : '移动'} ${w.changed} 项`}
        </button>
      </footer>
      <input
        ref={w.browserInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          w.addBrowserFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={w.browserFolder}
        type="file"
        multiple
        hidden
        {...{ webkitdirectory: '' }}
        onChange={(e) => {
          w.addBrowserFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <WorkspaceDialogs w={w} a={a} settingsTab={settingsTab} />
    </div>
  );
}
