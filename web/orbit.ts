import type { GameMeta } from './store';
import type { LibraryHandlers } from './library';
import { str } from './i18n';
import { createOrbitCaption, type OrbitCaption, type OrbitCaptionGame } from './ui/orbit-caption.js';

export interface OrbitDeps {
  h: LibraryHandlers;
  displayTitle(g: GameMeta): string;
  systemLabel(system: string): string;
  activity(g: GameMeta): string;
  fillArtwork(frame: HTMLElement): Promise<void>;
  clearArtwork(frame: HTMLElement): void;
  chip(label: string, kind?: 'plat' | 'warn' | 'on'): HTMLElement;
}

const SLOT_MAX = 12;

type Pose = { x: number; turn: number; scale: number; opacity: number; w: number; h: number };
const WIDE: readonly Pose[] = [
  { x: 0, turn: 0, scale: 1, opacity: 1, w: 330, h: 430 },
  { x: 270, turn: 34, scale: 0.88, opacity: 0.75, w: 250, h: 340 },
  { x: 470, turn: 48, scale: 0.72, opacity: 0.35, w: 250, h: 340 },
  { x: 470, turn: 48, scale: 0.72, opacity: 0, w: 250, h: 340 },
];
const NARROW: readonly Pose[] = [
  { x: 0, turn: 0, scale: 1, opacity: 1, w: 250, h: 330 },
  { x: 170, turn: 34, scale: 0.75, opacity: 0.75, w: 250, h: 340 },
  { x: 470, turn: 48, scale: 0.72, opacity: 0, w: 250, h: 340 },
  { x: 470, turn: 48, scale: 0.72, opacity: 0, w: 250, h: 340 },
];
const narrowQuery = typeof matchMedia === 'function' ? matchMedia('(max-width: 720px)') : null;
const poses = (): readonly Pose[] => (narrowQuery?.matches ? NARROW : WIDE);

let games: GameMeta[] = [];
let saved = new Set<string>();
let deps: OrbitDeps | null = null;

let focusHash: string | null = null;

let pos = 0;
let slotCount = 0;
let slots: HTMLElement[] = [];
let wired = false;

const mod = (n: number, m: number): number => ((n % m) + m) % m;

function stageEl(): HTMLElement { return document.getElementById('orbit-stage')!; }
function wrapEl(): HTMLElement { return document.getElementById('orbit-wrap')!; }

function onScreen(el: HTMLElement): boolean {
  return screenVisible(el);
}

export function screenVisible(el: {
  getClientRects(): { length: number };
  closest(sel: string): unknown;
} | null | undefined): boolean {
  if (!el) return false;
  return el.getClientRects().length > 0 && !el.closest('[inert]');
}
function ringEl(): HTMLElement { return document.getElementById('orbit-ring')!; }

function focused(): GameMeta { return games[mod(Math.round(pos), games.length)]; }

export function renderOrbit(g: GameMeta[], s: Set<string>, d: OrbitDeps): void {
  games = g;
  saved = s;
  deps = d;
  wireOnce();
  const ring = ringEl();
  if (!games.length) { ring.replaceChildren(); return; }

  const idx = Math.max(0, games.findIndex((x) => x.hash === focusHash));
  pos = idx;
  slotCount = Math.min(games.length, SLOT_MAX);

  slots = Array.from({ length: slotCount }, () => {
    const el = document.createElement('article');
    el.className = 'orbit-card nb-orbit__item';
    return el;
  });
  ring.replaceChildren(...slots);

  const stage = stageEl();
  stage.classList.add('placing');
  assign();
  applyPoses(false);
  void stage.offsetHeight;
  stage.classList.remove('placing');
  fitToHeight();
  settleOrbitCaption();
}

function poseAt(o: number): Pose {
  const P = poses();
  const d = Math.min(Math.abs(o), P.length - 1);
  const i = Math.min(Math.floor(d), P.length - 2);
  const t = d - i;
  const mix = (k: keyof Pose): number => P[i][k] + (P[i + 1][k] - P[i][k]) * t;
  const left = o < 0;
  return {
    x: (left ? -1 : 1) * mix('x'), turn: (left ? 1 : -1) * mix('turn'),
    scale: mix('scale'), opacity: mix('opacity'), w: mix('w'), h: mix('h'),
  };
}

function fitToHeight(): void {
  const wrap = wrapEl();
  const cap = document.getElementById('orbit-caption');
  if (!cap || !onScreen(wrap)) return;
  const base = narrowQuery?.matches ? 380 : 470;
  const top = stageEl().getBoundingClientRect().top + window.scrollY;
  const capH = cap.offsetHeight + parseFloat(getComputedStyle(cap).marginTop || '0');
  const k = Math.max(0.45, Math.min(1, (window.innerHeight - top - capH) / base));
  wrap.style.setProperty('--fan-scale', k.toFixed(3));
}

function applyPoses(held: boolean): void {
  for (const el of slots) {
    const o = Number(el.dataset.k) - pos;
    const at = Math.round(o);
    el.dataset.pos = String(at);
    if (at === 0) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
    if (held) {
      const p = poseAt(o);
      el.style.width = `${p.w.toFixed(1)}px`;
      el.style.height = `${p.h.toFixed(1)}px`;
      el.style.marginTop = `${(-p.h / 2).toFixed(1)}px`;
      el.style.marginLeft = `${(-p.w / 2).toFixed(1)}px`;
      el.style.transform = `translateX(${p.x.toFixed(1)}px) rotateY(${p.turn.toFixed(2)}deg) scale(${p.scale.toFixed(3)})`;
      el.style.opacity = p.opacity.toFixed(3);
    } else {
      for (const k of ['width', 'height', 'marginTop', 'marginLeft', 'transform', 'opacity'] as const) el.style[k] = '';
    }
  }
}

function assign(): void {
  const n = games.length;
  const base = Math.round(pos);
  const lo = -Math.floor(slotCount / 2);
  for (let o = lo; o < lo + slotCount; o++) {
    const slot = slots[mod(base + o, slotCount)];
    const gi = mod(base + o, n);
    slot.dataset.k = String(base + o);
    if (slot.dataset.gi === String(gi)) continue;
    slot.dataset.gi = String(gi);
    fillSlot(slot, games[gi]);
  }
}

function fillSlot(slot: HTMLElement, g: GameMeta): void {
  const d = deps!;
  const old = slot.querySelector<HTMLElement>('.art');
  if (old) d.clearArtwork(old);
  slot.replaceChildren();
  slot.dataset.hash = g.hash;

  const frame = document.createElement('div');
  frame.className = 'art nb-cab__glass';
  frame.dataset.hash = g.hash;
  frame.dataset.alt = d.displayTitle(g);
  if (g.hasThumb) {
    void d.fillArtwork(frame);
  } else {
    const ph = document.createElement('div');
    ph.className = 'art-placeholder';
    frame.append(ph);
  }
  const deck = document.createElement('div');
  deck.className = 'nb-cab__deck';
  const cab = document.createElement('div');
  cab.className = 'nb-cab';
  cab.append(frame, deck);
  slot.append(cab);

  const blocked = d.h.unplayable(g);
  slot.classList.toggle('cannot-run', !!blocked);
  if (blocked) {
    const flag = document.createElement('span');
    flag.className = 'card-flag nb-chip nb-chip--cherry';
    flag.textContent = '!';
    flag.title = blocked.detail;
    flag.setAttribute('aria-hidden', 'true');
    frame.append(flag);
  }
}

let caption: OrbitCaption | null = null;
const captionCtl = (): OrbitCaption => (caption ??= createOrbitCaption(wrapEl()));

const SETTLE_MS = 450;
let settleTimer = 0;
let spinTimers: number[] = [];

let settleSeq = 0;

function moved(): void {
  captionCtl().moving(true);
  window.clearTimeout(settleTimer);
  const seq = ++settleSeq;
  const front = slots.find((el) => el.dataset.pos === '0') ?? null;
  const done = (): void => {
    if (seq !== settleSeq) return;
    window.clearTimeout(settleTimer);
    front?.removeEventListener('transitionend', onEnd);
    captionCtl().moving(false);
  };
  const onEnd = (e: TransitionEvent): void => { if (e.target === front && e.propertyName === 'transform') done(); };
  front?.addEventListener('transitionend', onEnd);
  settleTimer = window.setTimeout(done, SETTLE_MS + 100);
}

function stopSpin(): void {
  for (const t of spinTimers) window.clearTimeout(t);
  spinTimers = [];
}

export function replayOrbitCaption(): void {
  if (!games.length || !onScreen(wrapEl())) return;
  cancelMove();
  captionCtl().replay(captionFor(focused()));
}

function cancelMove(): void {
  stopSpin();
  settleSeq++;
  window.clearTimeout(settleTimer);
}

export function settleOrbitCaption(): void {
  if (!games.length) return;
  cancelMove();
  captionCtl().settle(captionFor(focused()));
}

function updateCaption(): void {
  if (!games.length) return;
  showCaption(focused());
}

function showCaption(g: GameMeta): void {
  captionCtl().update(captionFor(g));
}

function captionFor(g: GameMeta): OrbitCaptionGame {
  const d = deps!;
  focusHash = g.hash;
  const blocked = d.h.unplayable(g);
  const hasState = saved.has(g.hash);
  const chips: HTMLElement[] = [];
  if (blocked) {
    const warn = d.chip(blocked.label, 'warn');
    warn.title = blocked.detail;
    chips.push(warn);
  }
  chips.push(d.chip(d.systemLabel(g.system), 'plat'), d.chip(d.activity(g)));
  if (hasState) chips.push(d.chip(str('orbit.state_saved'), 'on'));
  const play = document.getElementById('orbit-play') as HTMLButtonElement;
  play.classList.toggle('blocked', !!blocked);
  play.classList.toggle('nb-btn--primary', !blocked);
  return {
    title: d.displayTitle(g),
    chipsHtml: chips.map((c) => c.outerHTML).join(''),
    ctaLabel: hasState ? str('orbit.resume') : str('orbit.play'),
  };
}

function openFocused(): void {
  const d = deps!;
  if (!games.length) return;
  const g = focused();
  const blocked = d.h.unplayable(g);
  if (blocked) d.h.onUnplayable(d.displayTitle(g), blocked.detail);
  else d.h.onOpen(g.hash, true);
}

function setFocus(target: number): void {
  if (!games.length) return;
  stopSpin();
  const from = Math.round(pos);
  pos = target;
  assign();
  applyPoses(false);
  moved();
  const steps = Math.round(target) - from;
  if (Math.abs(steps) <= 1) { updateCaption(); return; }
  const gap = Math.min(120, SETTLE_MS / Math.abs(steps));
  for (let i = 1; i <= Math.abs(steps); i++) {
    const gi = mod(from + Math.sign(steps) * i, games.length);
    spinTimers.push(window.setTimeout(() => showCaption(games[gi]), (i - 1) * gap));
  }
}

function wireOnce(): void {
  if (wired) return;
  wired = true;
  const stage = stageEl();

  const back = (): void => { if (onScreen(wrapEl())) settleOrbitCaption(); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') back();
  });
  window.addEventListener('pageshow', back);

  document.getElementById('orbit-prev')!.addEventListener('click', () => {
    setFocus(Math.round(pos) - 1);
  });
  document.getElementById('orbit-next')!.addEventListener('click', () => {
    setFocus(Math.round(pos) + 1);
  });
  document.getElementById('orbit-play')!.addEventListener('click', openFocused);

  document.addEventListener('keydown', (ev) => {
    if (!onScreen(wrapEl())) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const t = ev.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); setFocus(Math.round(pos) - 1); }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); setFocus(Math.round(pos) + 1); }
    const a = document.activeElement;
    if ((ev.key === 'Enter' || ev.key === ' ') && (a === stage || a === document.body || a === null)) {
      ev.preventDefault();
      openFocused();
    }
  });

  let wheelAcc = 0;
  let wheelAt = 0;
  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    wheelAcc += delta;
    const now = performance.now();
    if (Math.abs(wheelAcc) < 50 || now - wheelAt < 90) return;
    setFocus(Math.round(pos) + Math.sign(wheelAcc));
    wheelAcc = 0;
    wheelAt = now;
  }, { passive: false });

  let dragging = false;
  let startX = 0;
  let startPos = 0;
  let moved = false;
  let lastX = 0;
  let lastT = 0;
  let vel = 0;
  let downTarget: HTMLElement | null = null;

  const posPerPx = () => 1 / poses()[1].x;

  stage.addEventListener('pointerdown', (ev) => {
    if (!games.length || ev.button !== 0) return;
    dragging = true;
    wrapEl().setAttribute('data-dragging', '');
    moved = false;
    downTarget = ev.target as HTMLElement;
    startX = lastX = ev.clientX;
    startPos = pos;
    lastT = performance.now();
    vel = 0;
    stage.setPointerCapture(ev.pointerId);
  });
  stage.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - startX;
    if (Math.abs(dx) > 6) moved = true;
    if (!moved) return;
    stage.classList.add('dragging');
    stopSpin();
    captionCtl().moving(true);
    settleSeq++;
    window.clearTimeout(settleTimer);
    const now = performance.now();
    if (now > lastT) vel = (ev.clientX - lastX) / (now - lastT);
    lastX = ev.clientX;
    lastT = now;
    const was = Math.round(pos);
    pos = startPos - dx * posPerPx();
    assign();
    applyPoses(true);
    if (Math.round(pos) !== was) updateCaption();
  });
  const release = (_ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    wrapEl().removeAttribute('data-dragging');
    stage.classList.remove('dragging');
    if (moved) {
      const fling = Math.max(-3, Math.min(3, Math.round(-vel * 150 * posPerPx())));
      setFocus(Math.round(pos + fling));
      return;
    }
    const card = downTarget?.closest<HTMLElement>('.orbit-card');
    if (!card || card.dataset.gi === undefined) return;
    const gi = Number(card.dataset.gi);
    const base = Math.round(pos);
    let o = mod(gi - base, games.length);
    if (o > games.length / 2) o -= games.length;
    if (o === 0) openFocused();
    else setFocus(base + o);
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', (ev) => {
    if (!dragging) return;
    moved = true;
    release(ev);
  });

  window.addEventListener('resize', fitToHeight);
  new ResizeObserver(() => {
    if (!slots.length) return;
    if (!stage.classList.contains('dragging')) applyPoses(false);
  }).observe(stage);
}
