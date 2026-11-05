
export interface LayerOptions {
  kind: 'dialog' | 'menu';
  close: () => void;
  onEscape?: () => boolean;
  focus?: HTMLElement | null;
  returnTo?: HTMLElement | null;
  keysThrough?: boolean;
}

export interface Layer {
  release(): void;
  add(root: HTMLElement): void;
}

interface Entry {
  roots: HTMLElement[];
  o: LayerOptions;
  returnTo: HTMLElement | null;
  stopKeys: (ev: Event) => void;
  released: boolean;
}

const KEYS = ['keydown', 'keyup', 'keypress'];
const PRESSES = ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'contextmenu', 'auxclick', 'wheel'];
const stopPress = (ev: Event): void => ev.stopPropagation();

function bind(e: Entry, r: HTMLElement, on: boolean): void {
  const f = on ? r.addEventListener.bind(r) : r.removeEventListener.bind(r);
  for (const k of KEYS) f(k, e.stopKeys);
  for (const k of PRESSES) f(k, stopPress);
  if (on) r.style.overscrollBehavior = 'contain';
}

const EXEMPT = '.ui-toasts, #stopnote, #stopnote-dim, script, style, link, template';

const stack: Entry[] = [];
const ours = new Set<Element>();
let swallowPress = false;
let scrollLock: { overflow: string; padding: string } | null = null;
let bodyWatch: MutationObserver | null = null;
let lastFocus: HTMLElement | null = null;
let byPointer = false;

const top = (): Entry | undefined => stack[stack.length - 1];

const inside = (e: Entry, n: EventTarget | null): boolean =>
  n instanceof Node && e.roots.some((r) => r.contains(n));

const exempt = (n: EventTarget | null): boolean =>
  n instanceof Element && !!n.closest(EXEMPT);

function tabbable(el: HTMLElement): boolean {
  if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled) return false;
  if (el.closest('[inert], [hidden]')) return false;
  const s = getComputedStyle(el);
  if (s.visibility === 'hidden' || s.display === 'none') return false;
  return el.getClientRects().length > 0;
}

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';

function stops(e: Entry): HTMLElement[] {
  const all = e.roots.flatMap((r) => [...(r.matches(FOCUSABLE) ? [r] : []), ...r.querySelectorAll<HTMLElement>(FOCUSABLE)]);
  return all.filter(tabbable).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

function applyInert(): void {
  const want = new Set<Element>();
  const t = top();
  if (t) {
    const keep = new Set<Element>();
    for (const r of t.roots) for (let n: Element | null = r; n; n = n.parentElement) keep.add(n);
    for (const k of keep) {
      const p = k.parentElement;
      if (!p || p === document.documentElement) continue;
      for (const sib of p.children) {
        if (keep.has(sib) || sib.matches(EXEMPT)) continue;
        if ((sib as HTMLElement).inert && !ours.has(sib)) continue;
        want.add(sib);
      }
    }
  }
  for (const e of [...ours]) if (!want.has(e)) { (e as HTMLElement).inert = false; ours.delete(e); }
  for (const e of want) if (!ours.has(e)) { (e as HTMLElement).inert = true; ours.add(e); }
}

function lockScroll(on: boolean): void {
  const html = document.documentElement;
  if (on && !scrollLock) {
    const bar = innerWidth - html.clientWidth;
    scrollLock = { overflow: html.style.overflow, padding: html.style.paddingRight };
    html.style.overflow = 'hidden';
    if (bar > 0) html.style.paddingRight = `${bar}px`;
  } else if (!on && scrollLock) {
    html.style.overflow = scrollLock.overflow;
    html.style.paddingRight = scrollLock.padding;
    scrollLock = null;
  }
}

function scrollsInside(e: Entry, from: EventTarget | null, dx: number, dy: number): boolean {
  for (let n = from instanceof Element ? from : null; n && inside(e, n); n = n.parentElement) {
    const s = getComputedStyle(n);
    if (dy && /(auto|scroll|overlay)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) {
      if (dy < 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1) return true;
    }
    if (dx && /(auto|scroll|overlay)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1) {
      if (dx < 0 ? n.scrollLeft > 0 : n.scrollLeft + n.clientWidth < n.scrollWidth - 1) return true;
    }
  }
  return false;
}

function focusInto(e: Entry): void {
  if (inside(e, document.activeElement)) return;
  const pick = e.o.focus
    ?? e.roots.map((r) => r.querySelector<HTMLElement>('[autofocus]')).find((x) => x && tabbable(x))
    ?? e.roots.map((r) => r.querySelector<HTMLElement>('.nb-btn--primary')).find((x) => x && tabbable(x))
    ?? stops(e)[0]
    ?? e.roots[0];
  if (pick && !pick.matches(FOCUSABLE) && pick.tabIndex < 0) pick.tabIndex = -1;
  pick?.focus({ preventScroll: true });
}

export function openLayer(roots: readonly HTMLElement[], o: LayerOptions): Layer {
  const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const entry: Entry = {
    roots: [...roots],
    o,
    returnTo: o.returnTo ?? (active && !roots.some((r) => r.contains(active)) ? active : lastFocus),
    stopKeys: (ev) => { if (!o.keysThrough && (ev as KeyboardEvent).key !== 'Escape') ev.stopPropagation(); },
    released: false,
  };
  for (const r of entry.roots) {
    bind(entry, r, true);
    r.classList.toggle('layer-by-pointer', byPointer);
  }
  stack.push(entry);
  applyInert();
  lockScroll(true);
  if (!bodyWatch) {
    let queued = false;
    bodyWatch = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        for (const e of [...stack]) if (!e.released && !e.roots.some((r) => r.isConnected)) release(e, false);
        applyInert();
      });
    });
    bodyWatch.observe(document.body, { childList: true, subtree: true });
  }
  focusInto(entry);
  return {
    release: () => release(entry),
    add: (root) => {
      if (entry.released || entry.roots.includes(root)) return;
      entry.roots.push(root);
      bind(entry, root, true);
      root.classList.toggle('layer-by-pointer', byPointer);
      applyInert();
    },
  };
}

function release(e: Entry, cascade = true): void {
  if (e.released) return;
  if (cascade) {
    const at = stack.indexOf(e);
    for (const above of stack.slice(at + 1).reverse()) above.o.close();
    for (const above of stack.slice(at + 1)) release(above);
  }
  e.released = true;
  const wasTop = top() === e;
  stack.splice(stack.indexOf(e), 1);
  for (const r of e.roots) {
    bind(e, r, false);
    r.classList.remove('layer-by-pointer');
  }
  applyInert();
  if (!stack.length) {
    lockScroll(false);
    bodyWatch?.disconnect();
    bodyWatch = null;
  }
  if (!wasTop) return;
  const back = e.returnTo;
  const under = top();
  if (back?.isConnected && !back.closest('[inert]') && (!under || inside(under, back))) back.focus({ preventScroll: true });
  else if (under) focusInto(under);
}

export function layerOpen(): boolean {
  return stack.length > 0;
}

export function inTopLayer(el: EventTarget | null): boolean {
  const t = top();
  return !t || inside(t, el) || exempt(el);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const opts = { capture: true, passive: false } as const;

  document.addEventListener('focusin', (ev) => {
    const t = top();
    if (!t) {
      if (ev.target instanceof HTMLElement) lastFocus = ev.target;
      return;
    }
    if (inside(t, ev.target) || exempt(ev.target)) return;
    queueMicrotask(() => {
      const now = top();
      if (now && !inside(now, document.activeElement) && !exempt(document.activeElement)) focusInto(now);
    });
  }, true);

  addEventListener('pointerdown', () => { byPointer = true; }, { capture: true, passive: true });
  addEventListener('keydown', (ev) => {
    if (byPointer) {
      byPointer = false;
      for (const e of stack) for (const r of e.roots) r.classList.remove('layer-by-pointer');
    }
    const t = top();
    if (!t || ev.isComposing) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.repeat) return;
      if (t.o.onEscape?.()) return;
      t.o.close();
      return;
    }
    if (ev.key !== 'Tab') return;
    const all = stops(t);
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (!all.length) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
    const wrap = at < 0 ? (ev.shiftKey ? all.length - 1 : 0)
      : ev.shiftKey && at === 0 ? all.length - 1
        : !ev.shiftKey && at === all.length - 1 ? 0 : -1;
    if (wrap < 0) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    all[wrap].focus({ preventScroll: true });
  }, true);

  const press = (ev: Event): void => {
    const t = top();
    const behind = !!t && !inside(t, ev.target) && !exempt(ev.target);
    if (ev.type === 'pointerdown') {
      swallowPress = behind;
      if (!behind) return;
      ev.stopPropagation();
      if (ev.cancelable) ev.preventDefault();
      if (t!.o.kind === 'menu') t!.o.close();
      return;
    }
    if (swallowPress) {
      ev.stopPropagation();
      if (ev.cancelable) ev.preventDefault();
      if (ev.type === 'click') swallowPress = false;
      return;
    }
    if ((ev.type === 'mousedown' || ev.type === 'touchstart') && behind) {
      ev.stopPropagation();
      if (ev.cancelable) ev.preventDefault();
      return;
    }
    if (t && (ev.type === 'click' || ev.type === 'dblclick' || ev.type === 'contextmenu' || ev.type === 'auxclick') && !inside(t, ev.target) && !exempt(ev.target)) {
      ev.stopPropagation();
      if (ev.cancelable) ev.preventDefault();
    }
  };
  for (const k of ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click', 'dblclick', 'contextmenu', 'auxclick']) {
    addEventListener(k, press, opts);
  }

  addEventListener('wheel', (ev) => {
    const t = top();
    if (!t) return;
    const own = inside(t, ev.target);
    if (!own && !exempt(ev.target)) ev.stopPropagation();
    if (!own || !scrollsInside(t, ev.target, ev.deltaX, ev.deltaY)) ev.preventDefault();
  }, opts);
  let touchAt: { x: number; y: number } | null = null;
  addEventListener('touchstart', (ev) => {
    const p = ev.touches[0];
    touchAt = p ? { x: p.clientX, y: p.clientY } : null;
  }, { capture: true, passive: true });
  addEventListener('touchmove', (ev) => {
    const t = top();
    const p = ev.touches[0];
    if (!t || !p || !touchAt) return;
    const dx = touchAt.x - p.clientX;
    const dy = touchAt.y - p.clientY;
    touchAt = { x: p.clientX, y: p.clientY };
    const own = inside(t, ev.target);
    if (!own && !exempt(ev.target)) ev.stopPropagation();
    if (own && (ev.target as Element).closest?.('input, textarea, select')) return;
    if (ev.cancelable && (!own || !scrollsInside(t, ev.target, dx, dy))) ev.preventDefault();
  }, opts);
}
