import { Moon, Sun, Monitor, RotateCcw } from 'lucide-react';
import { defaultAppearance, type ThemeMode } from '../appearance';
import type { AppearanceController } from '../useAppearance';
import { ColorPicker } from './ColorPicker';
export function AppearanceControls({ a }: { a: AppearanceController }) {
  return (
    <div className="appearance-controls">
      <h3>主题</h3>
      <div className="theme-choices" role="group" aria-label="主题模式">
        {(
          [
            ['light', '浅色', Sun],
            ['dark', '深色', Moon],
            ['system', '系统', Monitor],
          ] as const
        ).map(([mode, label, Icon]) => (
          <button
            key={mode}
            className={a.settings.theme === mode ? 'active' : ''}
            aria-pressed={a.settings.theme === mode}
            onClick={() => a.update({ theme: mode as ThemeMode })}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <div className="section-row">
        <h3>强调色</h3>
        <button
          className="text-button"
          onClick={() => a.update({ accent: defaultAppearance.accent })}
        >
          <RotateCcw size={11} />
          重置
        </button>
      </div>
      <ColorPicker value={a.settings.accent} onChange={(accent) => a.update({ accent })} />
      <div className="appearance-row">
        <label htmlFor="appearance-density">列表密度</label>
        <select
          id="appearance-density"
          value={a.settings.density}
          onChange={(e) => a.update({ density: e.target.value as 'standard' | 'compact' })}
        >
          <option value="standard">标准 · 38px</option>
          <option value="compact">紧凑 · 30px</option>
        </select>
      </div>
      <div className="appearance-row">
        <label htmlFor="show-size">显示文件大小</label>
        <input
          id="show-size"
          type="checkbox"
          checked={a.settings.showSize}
          onChange={(e) => a.update({ showSize: e.target.checked })}
        />
      </div>
      <label className="panel-size">
        操作面板宽度
        <input
          aria-label="操作面板宽度"
          type="range"
          min={290}
          max={470}
          value={a.settings.panelWidth}
          onChange={(e) => a.update({ panelWidth: Number(e.target.value) })}
        />
      </label>
      {a.storageFailed && <small className="validation-error">外观已应用，本地存储不可用。</small>}
    </div>
  );
}
