import { useEffect, useLayoutEffect, useState } from 'react';
import { accentTokens, parseAppearance, type Appearance } from './appearance';
export function useAppearance() {
  const [settings, setSettings] = useState(() => {
    try {
      return parseAppearance(localStorage.getItem('uu-appearance'));
    } catch {
      return parseAppearance(null);
    }
  });
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)'),
      listener = () => setSystemDark(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
  useLayoutEffect(() => {
    const root = document.documentElement,
      tokens = accentTokens(settings.accent, dark);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.density = settings.density;
    root.style.setProperty('--accent', tokens.accent);
    root.style.setProperty('--accent-rgb', tokens.rgb);
    root.style.setProperty('--accent-text', tokens.ink);
    root.style.setProperty('--on-accent', tokens.onAccent);
    root.style.setProperty('--right', `${settings.panelWidth}px`);
    root.style.colorScheme = dark ? 'dark' : 'light';
  }, [settings, dark]);
  useEffect(() => {
    try {
      localStorage.setItem('uu-appearance', JSON.stringify(settings));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [settings]);
  const update = (patch: Partial<Appearance>) =>
    setSettings((old) => parseAppearance(JSON.stringify({ ...old, ...patch })));
  return {
    settings,
    update,
    dark,
    storageFailed,
    toggleTheme: () => update({ theme: dark ? 'light' : 'dark' }),
  };
}
export type AppearanceController = ReturnType<typeof useAppearance>;
