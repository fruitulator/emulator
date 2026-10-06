import { UI_ICONS, rowIcon } from './icons';
import { str } from '../i18n';

export function chip(label: string, kind?: 'plat' | 'warn'): HTMLElement {
  const el = document.createElement('span');
  el.className = kind ? `chip ${kind}` : 'chip';
  el.textContent = label;
  return el;
}

export function sectionHeading(label: string): HTMLHeadingElement {
  const head = document.createElement('h2');
  head.className = 'lib-heading group-h';
  head.textContent = label;
  return head;
}

export function tileGrid(cards: HTMLElement[] = []): HTMLDivElement {
  const grid = document.createElement('div');
  grid.className = 'tile-grid';
  grid.append(...cards);
  return grid;
}

export interface TileCardOptions {
  label: string;
  art: HTMLElement;
  flag?: HTMLElement | null;
  title: string;
  titleTip?: string;
  chips: HTMLElement[];
  body?: HTMLElement[] | null;
  more?: HTMLElement | null;
}

export function tileCard(o: TileCardOptions): HTMLElement {
  const el = document.createElement('article');
  el.className = 'card';
  el.tabIndex = 0;
  el.setAttribute('aria-label', o.label);
  el.append(o.art);
  if (o.flag) o.art.append(o.flag);
  const panel = document.createElement('div');
  panel.className = 'card-panel';
  const name = document.createElement('h3');
  name.className = 'card-title';
  name.textContent = o.title;
  if (o.titleTip !== undefined) name.title = o.titleTip;
  panel.append(name);
  const plat = document.createElement('div');
  plat.className = 'chips';
  plat.append(...o.chips);
  panel.append(plat);
  if (o.body) {
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'panel-body';
    const inner = document.createElement('div');
    inner.className = 'panel-inner';
    inner.append(...o.body);
    bodyWrap.append(inner);
    o.art.append(bodyWrap);
  }
  el.append(panel);
  if (o.more) el.append(o.more);
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';
function svg(paths: string): SVGSVGElement {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = paths;
  return s;
}

export interface SearchBar {
  wrap: HTMLDivElement;
  input: HTMLInputElement;
  open(): void;
  close(): void;
}

export function searchBar(o: {
  placeholder: string; label: string; onInput: (text: string) => void; inline?: boolean;
}): SearchBar {
  const wrap = document.createElement('div');
  wrap.className = o.inline ? 'ui-search-wrap inline open' : 'ui-search-wrap';
  const bar = document.createElement('div');
  bar.className = 'ui-search-bar';
  bar.setAttribute('role', 'search');
  const input = document.createElement('input');
  input.className = 'ui-search-input';
  input.type = 'search';
  input.placeholder = o.placeholder;
  input.setAttribute('aria-label', o.label);
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => o.onInput(input.value.trim()));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ui-search-close';
  close.setAttribute('aria-label', str('ui.list.clear'));
  close.append(svg(UI_ICONS.cross));
  close.addEventListener('click', () => {
    input.value = '';
    o.onInput('');
    if (o.inline) input.focus(); else wrap.classList.remove('open');
  });
  bar.append(svg(UI_ICONS.search), input, close);
  wrap.append(bar);
  return {
    wrap, input,
    open: () => { wrap.classList.add('open'); input.focus({ preventScroll: true }); },
    close: () => { wrap.classList.remove('open'); },
  };
}

export function emptyState(o: {
  message: string; actions?: HTMLElement[]; hint?: string; welcome?: boolean;
}): HTMLDivElement {
  const box = document.createElement('div');
  box.className = o.welcome === false ? 'ui-empty' : 'ui-empty welcome';
  const msg = document.createElement('p');
  msg.className = 'ui-empty-msg';
  msg.textContent = o.message;
  box.append(msg);
  if (o.actions?.length) {
    const acts = document.createElement('div');
    acts.className = 'ui-empty-actions';
    acts.append(...o.actions);
    box.append(acts);
  }
  if (o.hint) {
    const h = document.createElement('p');
    h.className = 'ui-empty-hint';
    h.textContent = o.hint;
    box.append(h);
  }
  return box;
}

export function actionButton(
  label: string, kind: 'primary' | 'secondary' | 'tertiary', onClick: () => void, icon?: string,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `ui-btn ${kind}`;
  if (icon) b.append(rowIcon(icon, 'row-icon', 16).firstElementChild!);
  b.append(label);
  b.addEventListener('click', onClick);
  return b;
}

export function pillButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
