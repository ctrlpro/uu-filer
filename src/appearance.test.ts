import { describe, it, expect } from 'vitest';
import {
  accentTokens,
  contrast,
  hexToHsv,
  hsvToHex,
  mix,
  normalizeHex,
  parseAppearance,
} from './appearance';
describe('unrestricted accent palette', () => {
  it('accepts any RGB color and normalizes short HEX without accepting CSS injection', () => {
    expect(normalizeHex('#c9a23b')).toBe('#c9a23b');
    expect(normalizeHex('  AbC ')).toBe('#aabbcc');
    for (const value of [
      'red',
      '#ff00ff00',
      'url(https://example.com)',
      ';color:red',
      '#12xz00',
      '',
    ])
      expect(normalizeHex(value)).toBeNull();
  });
  it('preserves the selected fill and keeps primary text and accent labels legible in both themes', () => {
    for (const dark of [false, true])
      for (let r = 0; r <= 255; r += 51)
        for (let g = 0; g <= 255; g += 51)
          for (let b = 0; b <= 255; b += 51) {
            const color = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
            const t = accentTokens(color, dark),
              surface = dark ? '#1c1f25' : '#ffffff';
            expect(t.accent).toBe(color);
            expect(contrast(t.accent, t.onAccent)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(t.ink, surface)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(t.ink, mix(surface, color, 0.08))).toBeGreaterThanOrEqual(4.5);
          }
  });
  it('round-trips palette hue/saturation/value, including black, white and arbitrary colors', () => {
    for (const color of [
      '#000000',
      '#ffffff',
      '#7059d9',
      '#19a78e',
      '#ff00ff',
      '#c9a23b',
      '#f2f000',
      '#010203',
    ])
      expect(hsvToHex(hexToHsv(color))).toBe(color);
  });
  it('recovers from corrupted preferences and bounds panel dimensions', () => {
    expect(parseAppearance('broken').theme).toBe('system');
    expect(parseAppearance('{"panelWidth":9999}').panelWidth).toBe(470);
    expect(parseAppearance('{"accent":"#f0a","theme":"dark","density":"compact"}')).toMatchObject({
      accent: '#ff00aa',
      theme: 'dark',
      density: 'compact',
    });
    expect(parseAppearance('{"accent":"oops","panelWidth":"wide"}').accent).toBe('#7059d9');
  });
});
