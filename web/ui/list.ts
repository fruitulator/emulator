import { UI_ICONS, rowIcon } from './icons';
import { str } from '../i18n';
import { bubbleTip } from './tip';

function cutOff(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth + 1) return true;
  const copy = el.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  Object.assign(copy.style, {
    position: 'absolute', visibility: 'hidden', pointerEvents: 'none', left: '0', top: '0',
    display: 'block', webkitLineClamp: 'none', height: 'auto', minHeight: '0', maxHeight: 'none',
    width: `${el.clientWidth}px`,
  });
  el.parentElement!.append(copy);
  const whole = copy.offsetHeight;
  copy.remove();
  return whole > el.clientHeight + 1;
}

const CHIP_CLASS = {
  plat: 'nb-chip',
  warn: 'nb-chip nb-chip--cherry',
  on: 'nb-chip nb-chip--mint',
  plain: 'nb-chip nb-chip--grey',
} as const;

export function chip(label: string, kind?: 'plat' | 'warn' | 'on'): HTMLElement {
  const el = document.createElement('span');
  el.className = CHIP_CLASS[kind ?? 'plain'];
  el.textContent = label;
  return el;
}

export function chipButton(label: string, name: string, onPress: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${CHIP_CLASS.plain} chip-btn`;
  b.textContent = label;
  b.setAttribute('aria-label', name);
  b.title = name;
  b.addEventListener('click', (ev) => { ev.stopPropagation(); onPress(); });
  b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.stopPropagation(); });
  return b;
}

export function sectionHeading(label: string, after?: HTMLElement | null): HTMLElement {
  const head = document.createElement('div');
  head.className = 'nb-section';
  const title = document.createElement('h2');
  title.textContent = label;
  const line = document.createElement('span');
  line.className = 'nb-section__line';
  head.append(title, line);
  if (after) head.append(after);
  return head;
}

export function tileGrid(cards: HTMLElement[] = []): HTMLDivElement {
  const grid = document.createElement('div');
  grid.className = 'tile-grid';
  grid.append(...cards);
  return grid;
}

export function tileStrip(cards: HTMLElement[] = []): HTMLDivElement {
  const strip = document.createElement('div');
  strip.className = 'tile-strip';
  strip.append(...cards);
  return strip;
}

export interface TileCardOptions {
  label: string;
  art: HTMLElement;
  flag?: HTMLElement | null;
  title: string;
  titleTip?: string;
  titleOnArt?: boolean;
  chips: HTMLElement[];
  body?: HTMLElement[] | null;
  more?: HTMLElement | null;
}

export function tileCard(o: TileCardOptions): HTMLElement {
  const el = document.createElement('article');
  el.className = 'card nb-card';
  el.tabIndex = 0;
  el.setAttribute('aria-label', o.label);
  o.art.classList.add('nb-card__art');
  el.append(o.art);
  if (o.flag) o.art.append(o.flag);
  const panel = document.createElement('div');
  panel.className = 'card-panel nb-card__body';
  const name = document.createElement('h3');
  name.className = o.titleOnArt ? 'card-title nb-card__title on-art' : 'card-title nb-card__title';
  name.textContent = o.title;
  if (o.titleTip !== undefined) bubbleTip(name, o.titleTip, '', () => cutOff(name));
  if (o.titleOnArt) {
    el.classList.add('title-on-art');
    o.art.append(name);
  } else {
    panel.append(name);
  }
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
  bar.className = 'ui-search-bar nb-search';
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
  close.className = 'ui-search-close nb-search__clear';
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
    h.className = 'ui-empty-hint nb-meta';
    h.textContent = o.hint;
    box.append(h);
  }
  return box;
}

export function actionButton(
  label: string, kind: 'primary' | 'secondary' | 'tertiary', onClick: (ev: MouseEvent) => void, icon?: string,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = kind === 'primary' ? 'nb-btn nb-btn--primary' : kind === 'secondary' ? 'nb-btn' : 'nb-link-btn';
  if (icon) b.append(rowIcon(icon, 'row-icon', 16).firstElementChild!);
  b.append(label);
  b.addEventListener('click', onClick);
  return b;
}

export function pillButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nb-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
