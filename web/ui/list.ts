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

export interface WindowedGrid {
  readonly grid: HTMLDivElement;
  dispose(): void;
}

interface Win {
  grid: HTMLDivElement;
  count: number;
  make(i: number): HTMLElement;
  drop(el: HTMLElement): void;
  cards: Map<number, HTMLElement>;
  first: number;
  last: number;
  cols: number;
  width: number;
  head: HTMLElement;
  foot: HTMLElement;
}

const wins = new Set<Win>();
const winOf = new WeakMap<Element, Win>();
const indexOf = new WeakMap<Element, number>();
const rowHeights = new Map<string, number>();

const resized = typeof ResizeObserver === 'undefined' ? null
  : new ResizeObserver((entries) => {
    for (const e of entries) {
      const w = winOf.get(e.target);
      if (w) updateWin(w);
    }
  });

if (typeof document !== 'undefined') {
  const all = (): void => { for (const w of wins) updateWin(w); };
  document.addEventListener('scroll', all, { capture: true, passive: true });
  window.addEventListener('resize', all, { passive: true });
}

export function syncWindowedGrids(): void {
  for (const w of wins) updateWin(w);
}

function spacer(): HTMLElement {
  const s = document.createElement('div');
  s.className = 'tile-spacer';
  s.setAttribute('aria-hidden', 'true');
  s.hidden = true;
  return s;
}

function setSpacer(s: HTMLElement, rows: number, pitch: number, gap: number): void {
  s.hidden = rows <= 0;
  if (rows > 0) s.style.height = `${rows * pitch - gap}px`;
}

function updateWin(w: Win, extend?: number): void {
  const g = w.grid;
  if (!g.isConnected) return;
  const r = g.getBoundingClientRect();
  if (r.width === 0) return;
  const cs = getComputedStyle(g);
  const cols = Math.max(1, cs.gridTemplateColumns.split(' ').filter(Boolean).length);
  const gap = parseFloat(cs.rowGap) || 0;
  const colGap = parseFloat(cs.columnGap) || 0;
  w.cols = cols;
  w.width = r.width;
  const key = `${Math.round(r.width)}:${cols}:${gap}`;
  for (let pass = 0; pass < 2; pass++) {
    const colW = (r.width - colGap * (cols - 1)) / cols;
    const known = rowHeights.get(key);
    const pitch = (known ?? colW * 1.25 + 100) + gap;
    const rows = Math.ceil(w.count / cols);
    const margin = window.innerHeight;
    let fr = Math.max(0, Math.min(rows, Math.floor((-r.top - margin) / pitch)));
    let lr = Math.max(fr, Math.min(rows, Math.ceil((window.innerHeight - r.top + margin) / pitch)));
    if (extend !== undefined) {
      const er = Math.floor(extend / cols);
      fr = Math.min(fr, er);
      lr = Math.max(lr, er + 1);
    }
    const first = fr * cols;
    const last = Math.min(w.count, lr * cols);
    reconcile(w, first, last);
    if (first === last) {
      setSpacer(w.head, rows, pitch, gap);
      setSpacer(w.foot, 0, pitch, gap);
    } else {
      setSpacer(w.head, fr, pitch, gap);
      setSpacer(w.foot, rows - lr, pitch, gap);
    }
    if (known !== undefined || first === last) break;
    let h = 0;
    for (const el of w.cards.values()) h = Math.max(h, el.offsetHeight);
    if (!h) break;
    rowHeights.set(key, h);
    if (Math.abs(h + gap - pitch) < 1) break;
    for (const o of wins) if (o !== w && o.width === w.width) updateWin(o);
  }
}

function reconcile(w: Win, first: number, last: number): void {
  if (first === w.first && last === w.last) return;
  for (const [i, el] of w.cards) {
    if (i >= first && i < last) continue;
    el.remove();
    w.cards.delete(i);
    w.drop(el);
  }
  const kf = Math.max(first, w.first);
  const kl = Math.min(last, w.last);
  const build = (from: number, to: number): DocumentFragment => {
    const f = document.createDocumentFragment();
    for (let i = from; i < to; i++) {
      const el = w.make(i);
      indexOf.set(el, i);
      w.cards.set(i, el);
      f.append(el);
    }
    return f;
  };
  if (kf >= kl) {
    w.foot.before(build(first, last));
  } else {
    w.head.after(build(first, kf));
    w.foot.before(build(kl, last));
  }
  w.first = first;
  w.last = last;
}

export function windowedGrid(
  count: number, make: (i: number) => HTMLElement, drop: (el: HTMLElement) => void = () => undefined,
): WindowedGrid {
  const grid = tileGrid();
  const w: Win = {
    grid, count, make, drop, cards: new Map(), first: 0, last: 0,
    cols: 0, width: 0, head: spacer(), foot: spacer(),
  };
  grid.append(w.head, w.foot);
  wins.add(w);
  winOf.set(grid, w);
  resized?.observe(grid);
  return {
    grid,
    dispose() {
      if (!wins.delete(w)) return;
      resized?.unobserve(grid);
      for (const el of w.cards.values()) { el.remove(); drop(el); }
      w.cards.clear();
      w.first = w.last = 0;
    },
  };
}

export function windowedNeighbour(card: Element, step: 'left' | 'right' | 'up' | 'down'): HTMLElement | null {
  const w = card.parentElement && winOf.get(card.parentElement);
  const i = indexOf.get(card);
  if (!w || i === undefined) return null;
  const j = i + { left: -1, right: 1, up: -w.cols, down: w.cols }[step];
  if (j < 0 || j >= w.count) return null;
  if (!w.cards.has(j)) updateWin(w, j);
  return w.cards.get(j) ?? null;
}

export function isWindowed(grid: Element): boolean {
  return winOf.has(grid);
}

const STRIP_DRAG_PX = 6;

export function tileStrip(cards: HTMLElement[] = []): HTMLDivElement {
  const strip = document.createElement('div');
  strip.className = 'tile-strip';
  strip.append(...cards);
  const box = document.createElement('div');
  box.className = 'tile-strip-box tile-strip-at-start tile-strip-at-end';
  const arrow = (icon: string, label: string, dir: -1 | 1): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `nb-icon-btn tile-strip-arrow tile-strip-${dir < 0 ? 'prev' : 'next'}`;
    b.setAttribute('aria-label', label);
    b.append(rowIcon(icon, 'tile-strip-chev', 20));
    b.addEventListener('click', () => pageStrip(strip, dir));
    return b;
  };
  const prev = arrow(UI_ICONS.chevLeft, str('ui.list.previous'), -1);
  const next = arrow(UI_ICONS.chevRight, str('ui.list.next'), 1);
  box.append(strip, prev, next);

  const sync = (): void => {
    const atStart = strip.scrollLeft <= 1;
    const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
    box.classList.toggle('tile-strip-at-start', atStart);
    box.classList.toggle('tile-strip-at-end', atEnd);
    if (atStart && document.activeElement === prev) next.focus();
    if (atEnd && document.activeElement === next) prev.focus();
  };
  strip.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(strip);
  dragStrip(strip);
  return box;
}

function pageStrip(strip: HTMLElement, dir: -1 | 1): void {
  const [a, b] = strip.children;
  if (!a || !b) return;
  const pitch = b.getBoundingClientRect().left - a.getBoundingClientRect().left;
  const css = getComputedStyle(strip);
  const shown = strip.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  const cards = Math.max(1, Math.floor((shown + parseFloat(css.columnGap)) / pitch) - 1);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  strip.scrollBy({ left: dir * cards * pitch, behavior: still ? 'instant' : 'smooth' });
}

function dragStrip(strip: HTMLElement): void {
  let press: { id: number; x: number; left: number } | null = null;
  let dragging = false;
  let swallowClick = false;
  strip.addEventListener('pointerdown', (e) => {
    swallowClick = false;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (strip.scrollWidth <= strip.clientWidth) return;
    press = { id: e.pointerId, x: e.clientX, left: strip.scrollLeft };
  });
  strip.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const moved = e.clientX - press.x;
    if (!dragging && Math.abs(moved) > STRIP_DRAG_PX) {
      dragging = true;
      strip.setPointerCapture(press.id);
      strip.classList.add('tile-strip-dragging');
    }
    if (dragging) strip.scrollLeft = press.left - moved;
  });
  const end = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    press = null;
    if (!dragging) return;
    dragging = false;
    swallowClick = e.type === 'pointerup';
    strip.classList.remove('tile-strip-dragging');
  };
  strip.addEventListener('pointerup', end);
  strip.addEventListener('pointercancel', end);
  strip.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  strip.addEventListener('dragstart', (e) => e.preventDefault());
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
