import { str } from '../i18n';
import { UI_ICONS, rowIcon } from './icons';
import { showSheet, valueRow } from './sheet';
import { closeSideCard, openSideCard, sideCardOpen } from './sidecard';
import { THEMES, type Theme, currentTheme, onThemeChange, setTheme } from './theme';

export function themeName(t: Theme): string {
  switch (t) {
    case 'cherry': return str('ui.theme.cherry');
    case 'emerald': return str('ui.theme.emerald');
    case 'ocean': return str('ui.theme.ocean');
    default: return str('ui.theme.nebula');
  }
}

function themeTiles(picked: (t: Theme) => void): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'nb-theme-grid';
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', str('ui.theme.theme'));
  const tiles = THEMES.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nb-theme-tile';
    b.setAttribute('role', 'radio');
    b.dataset.theme = t;
    const preview = document.createElement('span');
    preview.className = 'nb-theme-tile__preview';
    preview.dataset.themePreview = t;
    preview.setAttribute('aria-hidden', 'true');
    for (const c of ['nb-theme-tile__bar', 'nb-theme-tile__bar', 'nb-theme-tile__pill']) {
      const i = document.createElement('i');
      i.className = c;
      preview.append(i);
    }
    preview.append(rowIcon(UI_ICONS.tick, 'nb-theme-tile__tick', 14));
    const name = document.createElement('span');
    name.className = 'nb-theme-tile__name';
    name.textContent = themeName(t);
    b.append(preview, name);
    b.addEventListener('click', () => {
      setTheme(t, { fade: true });
      mark(t);
      picked(t);
    });
    return b;
  });
  const mark = (now: Theme = currentTheme()): void => {
    for (const b of tiles) {
      const on = b.dataset.theme === now;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  mark();
  grid.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[e.key];
    if (step === undefined) return;
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = tiles[Math.min(tiles.length - 1, Math.max(0, at + step))];
    for (const b of tiles) b.tabIndex = b === next ? 0 : -1;
    next.focus();
  });
  grid.append(...tiles);
  return grid;
}

export function themeRow(o: { returnTo: HTMLElement; picked?: (t: Theme) => void; back?: () => void; beforeSheet?: () => void }): HTMLButtonElement {
  const picked = o.picked ?? (() => {});
  const { row, setValue } = valueRow(str('ui.theme.theme'), themeName(currentTheme()));
  const stop = onThemeChange(() => {
    if (!row.isConnected) { stop(); return; }
    setValue(themeName(currentTheme()));
  });
  row.addEventListener('click', () => {
    if (sideCardOpen(row)) { closeSideCard(); return; }
    const grid = themeTiles(picked);
    const card = document.createElement('div');
    card.className = 'nb-menu nb-theme-card';
    card.append(grid);
    const panel = row.closest<HTMLElement>('#sheet, .nb-menu');
    if (panel && openSideCard(card, row, panel)) {
      (grid.querySelector('[tabindex="0"]') as HTMLElement | null)?.focus();
      return;
    }
    o.beforeSheet?.();
    showSheet(str('ui.theme.theme'), [themeTiles(picked)], o.returnTo, o.back ? { back: o.back } : {});
    document.getElementById('sheet-title')?.before(rowIcon(UI_ICONS.palette, 'sheet-head-icon nb-theme-head-icon', 22));
    (document.querySelector('#sheet-rows .nb-theme-grid [tabindex="0"]') as HTMLElement | null)?.focus();
  });
  return row;
}
