import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from '../appearance';
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(value)),
    [draft, setDraft] = useState(value);
  const hsvRef = useRef(hsv);
  useEffect(() => {
    setDraft(value);
    if (hsvToHex(hsvRef.current) !== value) {
      const next = hexToHsv(value);
      hsvRef.current = next;
      setHsv(next);
    }
  }, [value]);
  function change(patch: Partial<Hsv>) {
    const next = { ...hsvRef.current, ...patch };
    next.h = ((next.h % 360) + 360) % 360;
    next.s = Math.max(0, Math.min(100, next.s));
    next.v = Math.max(0, Math.min(100, next.v));
    hsvRef.current = next;
    setHsv(next);
    onChange(hsvToHex(next));
  }
  function point(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    change({
      s: ((e.clientX - rect.left) / rect.width) * 100,
      v: 100 - ((e.clientY - rect.top) / rect.height) * 100,
    });
  }
  const invalid = normalizeHex(draft) === null;
  return (
    <div className="color-picker">
      <div
        className="saturation-plane"
        role="button"
        aria-label="调色板：饱和度与亮度"
        aria-description="左右调整饱和度，上下调整亮度"
        tabIndex={0}
        style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          point(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) point(e);
        }}
        onKeyDown={(e) => {
          const delta = e.shiftKey ? 10 : 1;
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            change({ s: hsv.s - delta });
          }
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            change({ s: hsv.s + delta });
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            change({ v: hsv.v + delta });
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            change({ v: hsv.v - delta });
          }
        }}
      >
        <span className="color-cursor" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
      </div>
      <label className="hue-field">
        <span className="sr-only">色相</span>
        <input
          className="hue-range"
          aria-label="色相"
          type="range"
          min={0}
          max={360}
          step={1}
          value={hsv.h}
          onChange={(e) => change({ h: Number(e.target.value) })}
        />
      </label>
      <div className="color-values">
        <label className="native-color" title="打开系统调色板">
          <input
            type="color"
            aria-label="系统调色板"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
        <label className="hex-field">
          <span>HEX</span>
          <input
            aria-label="强调色 HEX"
            value={draft}
            maxLength={7}
            spellCheck={false}
            aria-invalid={invalid}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              const hex = normalizeHex(raw);
              if (hex && raw.replace(/^#/, '').length === 6) onChange(hex);
            }}
            onBlur={() => {
              const hex = normalizeHex(draft);
              if (hex) onChange(hex);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const hex = normalizeHex(draft);
                if (hex) onChange(hex);
              }
            }}
          />
        </label>
      </div>
      {invalid && <small className="validation-error">输入 3 位或 6 位 HEX 色值</small>}
    </div>
  );
}
