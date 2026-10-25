export type ThemeMode = 'light' | 'dark' | 'system';
export interface Appearance {
  theme: ThemeMode;
  accent: string;
  density: 'standard' | 'compact';
  panelWidth: number;
  panelOpen: boolean;
  showSize: boolean;
}
export const defaultAppearance: Appearance = {
  theme: 'system',
  accent: '#7059d9',
  density: 'standard',
  panelWidth: 334,
  panelOpen: true,
  showSize: true,
};
export function normalizeHex(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[\da-f]{6}$/i.test(hex)) return '#' + hex.toLowerCase();
  if (/^[\da-f]{3}$/i.test(hex))
    return (
      '#' +
      hex
        .split('')
        .map((c) => c + c)
        .join('')
        .toLowerCase()
    );
  return null;
}
export function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
function hexFromRgb(values: number[]) {
  return (
    '#' +
    values
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const values = rgb(hex).map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
  };
  const l = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l[0] + 0.05) / (l[1] + 0.05);
}
export function mix(a: string, b: string, amount: number): string {
  const from = rgb(a),
    to = rgb(b);
  return hexFromRgb(from.map((v, i) => v + (to[i] - v) * amount));
}
export function accentTokens(accent: string, dark: boolean) {
  const base = normalizeHex(accent) ?? defaultAppearance.accent;
  const surface = dark ? '#1c1f25' : '#ffffff',
    tint = mix(surface, base, 0.08);
  let ink = base;
  for (let i = 0; i <= 100; i++) {
    ink = mix(base, dark ? '#ffffff' : '#000000', i / 100);
    if (contrast(ink, surface) >= 4.8 && contrast(ink, tint) >= 4.8) break;
  }
  return {
    accent: base,
    rgb: rgb(base).join(', '),
    ink,
    onAccent: contrast(base, '#ffffff') >= contrast(base, '#000000') ? '#ffffff' : '#000000',
  };
}
export interface Hsv {
  h: number;
  s: number;
  v: number;
}
export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = rgb(hex).map((v) => v / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const hue =
    d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (hue * 60 + 360) % 360, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}
export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360,
    sat = Math.max(0, Math.min(100, s)) / 100,
    value = Math.max(0, Math.min(100, v)) / 100;
  const c = value * sat,
    x = c * (1 - Math.abs(((hue / 60) % 2) - 1)),
    m = value - c;
  const channels =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return hexFromRgb(channels.map((n) => (n + m) * 255));
}
export function parseAppearance(raw: string | null): Appearance {
  try {
    const p = JSON.parse(raw ?? 'null');
    if (!p || typeof p !== 'object') return { ...defaultAppearance };
    return {
      theme: ['light', 'dark', 'system'].includes(p.theme) ? p.theme : defaultAppearance.theme,
      accent:
        typeof p.accent === 'string'
          ? (normalizeHex(p.accent) ?? defaultAppearance.accent)
          : defaultAppearance.accent,
      density: p.density === 'compact' ? 'compact' : 'standard',
      panelWidth:
        typeof p.panelWidth === 'number' && Number.isFinite(p.panelWidth)
          ? Math.max(290, Math.min(470, p.panelWidth))
          : 334,
      panelOpen: typeof p.panelOpen === 'boolean' ? p.panelOpen : true,
      showSize: typeof p.showSize === 'boolean' ? p.showSize : true,
    };
  } catch {
    return { ...defaultAppearance };
  }
}
