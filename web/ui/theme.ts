
export const THEMES = ['nebula', 'cherry', 'emerald', 'ocean'] as const;
export type Theme = typeof THEMES[number];
export const DEFAULT_THEME: Theme = 'nebula';
export const THEME_KEY = 'fruitulator.theme';

export function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v);
}

export function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return isTheme(t) ? t : DEFAULT_THEME;
}

export function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return isTheme(t) ? t : null;
  } catch {
    return null;
  }
}

export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return isTheme(t) ? t : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

const listeners = new Set<(t: Theme) => void>();

export function onThemeChange(fn: (t: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function put(t: Theme): void {
  const root = document.documentElement;
  if (t === DEFAULT_THEME) delete root.dataset.theme;
  else root.dataset.theme = t;
  const bg = getComputedStyle(root).getPropertyValue('--nb-bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  for (const fn of listeners) fn(t);
}

export function setTheme(t: Theme, o: { fade?: boolean } = {}): void {
  try { localStorage.setItem(THEME_KEY, t); } catch {  }
  if (t === currentTheme()) return;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!o.fade || still || !doc.startViewTransition) { put(t); return; }
  const root = document.documentElement;
  root.classList.add('nb-theme-fade');
  doc.startViewTransition(() => put(t)).finished.finally(() => root.classList.remove('nb-theme-fade'));
}

let following = false;
export function followOtherTabs(): void {
  if (following) return;
  following = true;
  addEventListener('storage', (e) => {
    if (e.key === THEME_KEY) put(isTheme(e.newValue) ? e.newValue : DEFAULT_THEME);
  });
  put(currentTheme());
}
