import { LANGUAGES, currentLanguage, setLanguage, str } from '../i18n';
import { UI_ICONS } from './icons';
import { closeSheet, showSheet, valueRow } from './sheet';
import { closeSideCard, openSideCard, sideCardOpen } from './sidecard';

const PHONE = '(max-width: 600px)';
const isPhone = (): boolean => matchMedia(PHONE).matches;

function svgIcon(markup: string, cls: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add(...cls.split(' '));
  svg.innerHTML = markup;
  return svg;
}

function languageList(kind: 'menu' | 'sheet', close: () => void): HTMLElement {
  const list = document.createElement('div');
  list.className = kind === 'menu' ? 'nb-menu lang-list' : 'lang-list lang-list--sheet';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', str('ui.langpick.language'));
  const now = currentLanguage().code;
  const rows = LANGUAGES.map((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lang-opt';
    b.setAttribute('role', 'option');
    b.setAttribute('lang', l.code);
    b.setAttribute('aria-selected', String(l.code === now));
    b.tabIndex = l.code === now ? 0 : -1;
    const code = document.createElement('span');
    code.className = 'lang-code';
    code.textContent = l.short;
    const name = document.createElement('span');
    name.className = 'lang-name';
    name.textContent = l.name;
    b.append(code, name);
    b.addEventListener('click', () => pick(l.code));
    return b;
  });
  list.append(...rows);
  const pick = (code: string): void => {
    close();
    setLanguage(code);
  };
  list.addEventListener('keydown', (e) => {
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number): void => { rows[(i + rows.length) % rows.length].focus(); };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  return list;
}

const selectedRow = (list: HTMLElement): HTMLElement | null => list.querySelector('[aria-selected="true"]');

function openSheet(returnTo: HTMLElement, back?: () => void): void {
  const list = languageList('sheet', closeSheet);
  showSheet(str('ui.langpick.language'), [list], returnTo, back ? { back } : {});
  document.getElementById('sheet-title')?.before(svgIcon(UI_ICONS.globe, 'sheet-head-icon lang-sheet-globe'));
  selectedRow(list)?.focus();
}

export function languageRow(o: { returnTo: HTMLElement; back?: () => void; beforeSheet?: () => void }): HTMLButtonElement {
  const { row } = valueRow(str('ui.langpick.language'), currentLanguage().name);
  row.setAttribute('aria-haspopup', 'listbox');
  row.addEventListener('click', () => {
    if (sideCardOpen(row)) { closeSideCard(); return; }
    const card = languageList('menu', () => { closeSideCard(); row.focus(); });
    card.classList.add('lang-card');
    const panel = row.closest<HTMLElement>('#sheet, .nb-menu');
    if (!isPhone() && panel && openSideCard(card, row, panel)) {
      selectedRow(card)?.focus();
      return;
    }
    o.beforeSheet?.();
    openSheet(o.returnTo, o.back);
  });
  return row;
}
