import type { GameMeta } from './store';
import type { LibraryHandlers } from './library';
import { str } from './i18n';

export interface OrbitDeps {
  h: LibraryHandlers;
  displayTitle(g: GameMeta): string;
  systemLabel(system: string): string;
  activity(g: GameMeta): string;
  fillArtwork(frame: HTMLElement): Promise<void>;
  clearArtwork(frame: HTMLElement): void;
  chip(label: string, kind?: 'plat' | 'warn'): HTMLElement;
}

const SLOT_MAX = 12;

const VISIBLE_DEG = 112;

let games: GameMeta[] = [];
let saved = new Set<string>();
let deps: OrbitDeps | null = null;

let focusHash: string | null = null;

let pos = 0;
let slotCount = 0;
let radius = 0;
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
    el.className = 'orbit-card';
    return el;
  });
  ring.replaceChildren(...slots);

  layout();
  applyRotation(false);
  assign();
  updateDepth();
  updateCaption();
}

function layout(): void {
  const ring = ringEl();
  const w = ring.offsetWidth || 220;
  const step = 360 / slotCount;
  radius = Math.max(
    Math.round((w * 1.16) / (2 * Math.tan(Math.PI / slotCount))),
    Math.round(w * 0.72),
  );
  for (let i = 0; i < slots.length; i++) {
    slots[i].style.transform = `rotateY(${i * step}deg) translateZ(${radius}px)`;
  }
}

function applyRotation(animate: boolean): void {
  const ring = ringEl();
  const step = 360 / slotCount;
  if (!animate) {
    ring.style.transition = 'none';
    void ring.offsetHeight;
  }
  ring.style.transform = `translateZ(${-radius}px) rotateY(${-pos * step}deg)`;
  if (!animate) ring.style.transition = '';
}

function assign(): void {
  const n = games.length;
  const base = Math.round(pos);
  const lo = -Math.floor(slotCount / 2);
  for (let o = lo; o < lo + slotCount; o++) {
    const slot = slots[mod(base + o, slotCount)];
    const gi = mod(base + o, n);
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
  frame.className = 'art';
  if (g.hasThumb) {
    frame.dataset.hash = g.hash;
    frame.dataset.alt = d.displayTitle(g);
    void d.fillArtwork(frame);
  } else {
    const ph = document.createElement('div');
    ph.className = 'art-placeholder';
    frame.append(ph);
    frame.dataset.hash = g.hash;
    frame.dataset.alt = d.displayTitle(g);
  }
  slot.append(frame);

  const blocked = d.h.unplayable(g);
  slot.classList.toggle('cannot-run', !!blocked);
  if (blocked) {
    const flag = document.createElement('span');
    flag.className = 'card-flag';
    flag.textContent = '!';
    flag.title = blocked.detail;
    flag.setAttribute('aria-hidden', 'true');
    frame.append(flag);
  }
}

function updateDepth(): void {
  const step = 360 / slotCount;
  const rot = -pos * step;
  for (let i = 0; i < slots.length; i++) {
    let a = mod(i * step + rot, 360);
    if (a >= 180) a -= 360;
    const c = Math.cos((a * Math.PI) / 180);
    const el = slots[i];
    el.style.opacity = Math.abs(a) < VISIBLE_DEG ? '1' : '0';
    el.style.filter = `brightness(${(0.42 + 0.58 * Math.max(0, c)).toFixed(3)})`;
    el.classList.toggle('focused', Math.abs(a) < step / 2);
  }
}

let captionSeq = 0;

const CAPTION_OUT_MS = 140;

function updateCaption(): void {
  if (!games.length) return;
  const g = focused();
  focusHash = g.hash;
  const text = document.getElementById('orbit-cap-text')!;
  if (text.dataset.hash === g.hash) return;
  const seq = ++captionSeq;
  if (!text.dataset.hash) { setCaption(g); return; }
  text.classList.add('out');
  window.setTimeout(() => {
    if (seq !== captionSeq) return;
    setCaption(g);
    text.classList.remove('out');
  }, CAPTION_OUT_MS);
}

function setCaption(g: GameMeta): void {
  const d = deps!;
  const text = document.getElementById('orbit-cap-text')!;
  const title = document.getElementById('orbit-title')!;
  const chips = document.getElementById('orbit-chips')!;
  const sub = document.getElementById('orbit-sub')!;
  const play = document.getElementById('orbit-play') as HTMLButtonElement;

  text.dataset.hash = g.hash;
  title.textContent = d.displayTitle(g);
  const blocked = d.h.unplayable(g);
  chips.replaceChildren();
  if (blocked) {
    const warn = d.chip(blocked.label, 'warn');
    warn.title = blocked.detail;
    chips.append(warn);
  }
  const hasState = saved.has(g.hash);
  sub.textContent = `${d.activity(g)}${hasState ? ' · state saved' : ''}`;
  play.textContent = hasState ? str('orbit.resume') : str('orbit.play');
  play.classList.toggle('blocked', !!blocked);
}

function openFocused(): void {
  const d = deps!;
  if (!games.length) return;
  const g = focused();
  const blocked = d.h.unplayable(g);
  if (blocked) d.h.onUnplayable(d.displayTitle(g), blocked.detail);
  else d.h.onOpen(g.hash, saved.has(g.hash));
}

function setFocus(target: number): void {
  if (!games.length) return;
  pos = target;
  assign();
  applyRotation(true);
  updateDepth();
  updateCaption();
}

function wireOnce(): void {
  if (wired) return;
  wired = true;
  const stage = stageEl();

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

  const posPerPx = () => 1 / ((ringEl().offsetWidth || 220) * 0.9);

  stage.addEventListener('pointerdown', (ev) => {
    if (!games.length || ev.button !== 0) return;
    dragging = true;
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
    const now = performance.now();
    if (now > lastT) vel = (ev.clientX - lastX) / (now - lastT);
    lastX = ev.clientX;
    lastT = now;
    pos = startPos - dx * posPerPx();
    assign();
    applyRotation(false);
    updateDepth();
  });
  const release = (_ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
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

  new ResizeObserver(() => {
    if (!slots.length) return;
    layout();
    applyRotation(false);
  }).observe(stage);
}
