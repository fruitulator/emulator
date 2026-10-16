import type { Cabinet, FrameReel, ReelBand } from '../dat';
import { str } from '../i18n';
import { reelWindowSymbols } from './peek';

const GAP = 6;
const PAD = 8;
const BAND_MAX = 40;
const BAND_MIN = 32;
const WHOLE_MAX = 96;
const LABEL_H = 20;
const WHOLE_GAP = 14;
const WHOLE_PAD = 16;
const CELL_GAP = 3;
const WHOLE_MARGIN_Y = 12;
const SHRINK = 0.1;

export interface Box { left: number; top: number; width: number; height: number }

export type BandMode = 'rows' | 'columns' | 'whole';

export interface BandsLayout {
  mode: BandMode;
  screen: Box;
  boxes: Box[];
  noRoom?: Box;
  labels?: Box[];
  card?: Box;
}

export function bandsLayout(
  stage: { width: number; height: number }, layout: { width: number; height: number },
  count: number, touch: boolean, fill: boolean,
  wholeCap?: (colH: number) => number,
): BandsLayout {
  const sw = stage.width;
  const sh = stage.height;
  const mode: BandMode = !touch ? 'whole' : sh >= sw ? 'rows' : 'columns';
  const k0 = Math.min(1, sw / layout.width, sh / layout.height);
  if (mode === 'rows') {
    const need = (r: number): number => count * r + (count - 1) * GAP + 2 * PAD;
    const fitted = lengthFor(need, sh - layout.height * k0, layout.height * k0);
    if (!fitted) return noRoomRows(sw, sh, layout, k0, fill);
    const { size, shrink } = fitted;
    const k = k0 * (1 - shrink);
    const h = fill ? sh - need(size) : layout.height * k;
    const w = fill ? sw : layout.width * k;
    const screen = { left: (sw - w) / 2, top: 0, width: w, height: h };
    const top0 = h + Math.max(PAD, (sh - h - need(size)) / 2 + PAD);
    const boxes = Array.from({ length: count }, (_, i) => ({
      left: PAD, top: top0 + i * (size + GAP), width: sw - 2 * PAD, height: size,
    }));
    return { mode, screen, boxes };
  }
  const per = mode === 'columns' ? Math.ceil(count / 2) : count;
  const sides = mode === 'columns' && count > 1 ? 2 : 1;
  const whole = mode === 'whole';
  const gap = whole ? WHOLE_GAP : GAP;
  const pad = whole ? WHOLE_PAD : PAD;
  const side = (c: number): number => per * c + (per - 1) * gap + 2 * pad;
  const need = (c: number): number => sides * side(c);
  const colTop = whole ? WHOLE_MARGIN_Y + pad / 2 + LABEL_H : pad;
  const colH = whole ? sh - WHOLE_MARGIN_Y - pad / 2 - colTop : sh - pad - colTop;
  const max = whole ? Math.max(BAND_MIN, Math.min(WHOLE_MAX, Math.floor(wholeCap?.(colH) ?? WHOLE_MAX))) : BAND_MAX;
  const fitted = lengthFor(need, sw - layout.width * k0, layout.width * k0, max);
  if (!fitted) {
    const w = layout.width * k0;
    const h = layout.height * k0;
    return {
      mode,
      screen: fill ? { left: 0, top: 0, width: sw, height: sh } : { left: (sw - w) / 2, top: (sh - h) / 2, width: w, height: h },
      boxes: [],
    };
  }
  const { size, shrink } = fitted;
  const k = k0 * (1 - shrink);
  const w = fill ? sw - need(size) : layout.width * k;
  const h = fill ? sh : layout.height * k;
  const spare = sw - w - need(size);
  const left = sides === 2 ? side(size) + spare / 2 : Math.max(0, spare / 2);
  const screen = { left, top: (sh - h) / 2, width: w, height: h };
  const boxes: Box[] = [];
  for (let i = 0; i < count; i++) {
    const onRight = sides === 1 || i >= per;
    const j = onRight && sides === 2 ? i - per : i;
    const x0 = onRight ? left + w + pad : left - side(size) + pad;
    boxes.push({ left: x0 + j * (size + gap), top: colTop, width: size, height: colH });
  }
  if (!whole || boxes.length === 0) return { mode, screen, boxes };
  const labels = boxes.map((b) => ({ left: b.left, top: colTop - LABEL_H, width: b.width, height: LABEL_H }));
  const x0 = Math.min(...boxes.map((b) => b.left)) - pad / 2;
  const x1 = Math.max(...boxes.map((b) => b.left + b.width)) + pad / 2;
  return {
    mode, screen, boxes, labels,
    card: { left: x0, top: WHOLE_MARGIN_Y, width: x1 - x0, height: sh - 2 * WHOLE_MARGIN_Y },
  };
}

function lengthFor(
  need: (size: number) => number, spare: number, machine: number, max = BAND_MAX,
): { size: number; shrink: number } | null {
  if (spare >= need(max)) return { size: max, shrink: 0 };
  if (spare >= need(BAND_MIN)) {
    const per = need(BAND_MIN + 1) - need(BAND_MIN);
    return { size: BAND_MIN + Math.floor((spare - need(BAND_MIN)) / per), shrink: 0 };
  }
  const short = need(BAND_MIN) - spare;
  return machine > 0 && short <= SHRINK * machine
    ? { size: BAND_MIN, shrink: short / machine }
    : null;
}

function noRoomRows(
  sw: number, sh: number, layout: { width: number; height: number }, k0: number, fill: boolean,
): BandsLayout {
  const line = 28;
  const w = fill ? sw : layout.width * k0;
  const h = fill ? sh - line : layout.height * k0;
  const spare = sh - h;
  if (spare < line) {
    return { mode: 'rows', screen: { left: (sw - w) / 2, top: (sh - h) / 2, width: w, height: fill ? sh : h }, boxes: [] };
  }
  return {
    mode: 'rows',
    screen: { left: (sw - w) / 2, top: 0, width: w, height: h },
    boxes: [],
    noRoom: { left: PAD, top: h, width: sw - 2 * PAD, height: spare },
  };
}

export interface BandSource {
  key: object;
  reel: number;
  stops: number;
  window: number;
  aspect: number;
  draw(ctx: CanvasRenderingContext2D, k: number, x: number, y: number, w: number, h: number): void;
}

export interface NoBand { reel: number; none: true }

type Img = CanvasImageSource & { width: number; height: number };

export function bandSources(cab: Cabinet<unknown>): (BandSource | NoBand)[] {
  const out: { at: BandPlace; src: BandSource | NoBand }[] = [];
  for (const reel of cab.reels) out.push({ at: reel, src: fromBand(reel as ReelBand<unknown>) });
  for (const fr of cab.frameReels ?? []) out.push({ at: fr, src: fromFrames(fr as FrameReel<unknown>) });
  return bandOrder(out.map((o) => o.at)).map((i, n) => ({ ...out[i].src, reel: n + 1 }));
}

export interface BandPlace { left?: number; top?: number; width?: number; height?: number; machineIndex: number }

export function bandOrder(places: readonly BandPlace[]): number[] {
  const size = (p: BandPlace): string => `${Math.round(p.width ?? 0)}x${Math.round(p.height ?? 0)}`;
  const counts = new Map<string, number>();
  for (const p of places) counts.set(size(p), (counts.get(size(p)) ?? 0) + 1);
  let main: string | undefined;
  let most = 1;
  for (const [k, n] of counts) if (n > most) { main = k; most = n; }
  const idx = places.map((_, i) => i);
  const isMain = (i: number): boolean => main === undefined || size(places[i]) === main;
  const x = (i: number): number => places[i].left ?? 0;
  const y = (i: number): number => places[i].top ?? 0;
  return idx.sort((a, b) => {
    const ma = isMain(a), mb = isMain(b);
    if (ma !== mb) return ma ? -1 : 1;
    const d = ma ? x(a) - x(b) || y(a) - y(b) : y(a) - y(b) || x(a) - x(b);
    return d || places[a].machineIndex - places[b].machineIndex;
  });
}

function fromBand(reel: ReelBand<unknown>): BandSource | NoBand {
  const img = reel.canvas as Img | null | undefined;
  const stops = reel.stops || 0;
  if (reel.disc || !img || !(img.width > 0 && img.height > 0) || stops < 1) {
    return { reel: reel.machineIndex + 1, none: true };
  }
  const cells = reel.artCells && reel.artCells > 0 ? reel.artCells : stops;
  const across = !!reel.stripHorizontal;
  const cw = across ? img.width / cells : img.width;
  const ch = across ? img.height : img.height / cells;
  return {
    key: reel,
    reel: reel.machineIndex + 1,
    stops,
    window: Math.max(1, Math.round(reelWindowSymbols(reel as Parameters<typeof reelWindowSymbols>[0]))),
    aspect: cw / ch,
    draw(ctx, k, x, y, w, h) {
      const a = Math.floor((k * cells) / stops) % cells;
      ctx.drawImage(img, across ? a * cw : 0, across ? 0 : a * ch, cw, ch, x, y, w, h);
    },
  };
}

function fromFrames(fr: FrameReel<unknown>): BandSource | NoBand {
  const frames = fr.frames as (Img | null | undefined)[];
  const first = frames.find((f) => f && f.width > 0 && f.height > 0);
  if (!first || fr.stops < 1) return { reel: fr.machineIndex + 1, none: true };
  return {
    key: fr,
    reel: fr.machineIndex + 1,
    stops: fr.stops,
    window: 1,
    aspect: first.width / first.height,
    draw(ctx, k, x, y, w, h) {
      const img = frames[k];
      if (img) ctx.drawImage(img, x, y, w, h);
    },
  };
}

const wrap = (k: number, n: number): number => ((k % n) + n) % n;

const DIM_LIGHT = 0.4;
const DIM_SATURATE = 0;
export const DIM_OUTSIDE = true;

function naturalPitch(src: BandSource, mode: BandMode, w: number, h: number): number {
  return mode === 'rows'
    ? Math.max(h * 0.6, Math.min(h * 2, h * src.aspect))
    : Math.max(w * 0.5, Math.min(w * 1.6, w / src.aspect));
}

export function sharedPitch(srcs: readonly BandSource[], mode: BandMode, w: number, h: number): number | undefined {
  if (srcs.length === 0) return undefined;
  if (mode === 'whole') return Math.min(...srcs.map((s) => Math.min(naturalPitch(s, mode, w, h), h / s.stops)));
  const main = srcs.reduce((a, b) => (b.window > a.window ? b : a));
  return naturalPitch(main, mode, w, h);
}

function dim(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  if (!(w > 0 && h > 0)) return;
  ctx.save();
  if (DIM_SATURATE > 0) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = 1 - DIM_SATURATE;
    ctx.fillStyle = '#808080';
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1 - DIM_LIGHT;
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

export function outside(lo: number, hi: number, keep: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let at = lo;
  for (const [a, b] of [...keep].sort((p, q) => p[0] - q[0])) {
    if (b <= at || a >= hi) continue;
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < hi) out.push([at, hi]);
  return out;
}

function cell(
  ctx: CanvasRenderingContext2D, src: BandSource, k: number, x: number, y: number, w: number, h: number,
  badge = false,
): void {
  const dw = Math.min(w, h * src.aspect);
  const dh = dw / src.aspect;
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
  src.draw(ctx, k, dx, dy, dw, dh);
  if (badge) stopBadge(ctx, k + 1, dx + dw, dy, Math.min(dw, dh));
}

function stopBadge(ctx: CanvasRenderingContext2D, n: number, right: number, top: number, cellSize: number): void {
  const s = Math.max(11, Math.min(22, Math.round(cellSize * 0.34)));
  const w = n >= 10 ? Math.round(s * 1.45) : s;
  const x = right - w - 2, y = top + 2;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillRect(x, y, w, s);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = `bold ${Math.round(s * 0.72)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x + w / 2, y + s / 2 + 0.5);
  ctx.restore();
}

export function paintBand(
  ctx: CanvasRenderingContext2D, src: BandSource, row: number, mode: BandMode,
  w: number, h: number, pitch?: number, dimOutside = DIM_OUTSIDE, badges = false, scroll = false,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1d1d1d';
  ctx.fillRect(0, 0, w, h);
  const n = src.stops;
  const win = Math.min(src.window, n);
  if (mode === 'rows') {
    const cw = pitch ?? naturalPitch(src, mode, w, h);
    const cx = w / 2;
    const half = Math.ceil(w / cw / 2) + 1;
    const base = Math.round(row);
    for (let k = base - half; k <= base + half; k++) {
      cell(ctx, src, wrap(k, n), cx + (k - row) * cw - cw / 2, 0, cw, h, badges);
    }
    for (const [a, b] of outside(0, w, [[cx - (win * cw) / 2, cx + (win * cw) / 2]])) if (dimOutside) dim(ctx, a, 0, b - a, h);
    return;
  }
  if (mode === 'columns') {
    const ch = pitch ?? naturalPitch(src, mode, w, h);
    const cy = h / 2;
    const half = Math.ceil(h / ch / 2) + 1;
    const base = Math.round(row);
    for (let k = base - half; k <= base + half; k++) {
      cell(ctx, src, wrap(k, n), 0, cy + (k - row) * ch - ch / 2, w, ch, badges);
    }
    for (const [a, b] of outside(0, h, [[cy - (win * ch) / 2, cy + (win * ch) / 2]])) if (dimOutside) dim(ctx, 0, a, w, b - a);
    return;
  }
  const size = Math.min(pitch ?? naturalPitch(src, mode, w, h), h / n);
  const cw = Math.min(w, size * src.aspect);
  const x0 = (w - cw) / 2;
  const y0 = (h - n * size) / 2;
  const inner = Math.max(1, size - CELL_GAP);
  if (scroll) {
    const cy = h / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, cw, n * size);
    ctx.clip();
    const lo = Math.floor(row - n / 2) - 1;
    for (let k = lo; k <= lo + n + 2; k++) {
      src.draw(ctx, wrap(k, n), x0, cy + (k - row - 0.5) * size + CELL_GAP / 2, cw, inner);
    }
    ctx.restore();
    const half = (win * size) / 2;
    for (const [a, b] of outside(y0, y0 + n * size, [[cy - half, cy + half]])) if (dimOutside) dim(ctx, x0, a, cw, b - a);
    return;
  }
  for (let k = 0; k < n; k++) src.draw(ctx, k, x0, y0 + k * size + CELL_GAP / 2, cw, inner);
  const top = y0 + (wrap(row, n) + 0.5 - win / 2) * size;
  const keep = [-n * size, 0, n * size].map((off): [number, number] => [top + off, top + off + win * size]);
  for (const [a, b] of outside(y0, y0 + n * size, keep)) if (dimOutside) dim(ctx, x0, a, cw, b - a);
  if (badges) for (let k = 0; k < n; k++) stopBadge(ctx, k + 1, x0 + cw, y0 + k * size + CELL_GAP / 2, Math.min(cw, inner));
}

export interface ReelBands {
  sync(cab: Cabinet<unknown> | null): void;
  readonly count: number;
  row(key: object, row: number): void;
  place(layout: BandsLayout | null): void;
  paint(): void;
  wholeCap(colH: number): number;
}

export function winLineMarks(
  boxes: readonly Box[], mode: 'rows' | 'columns', gap = GAP,
): { x: number; y: number; dir: 'up' | 'down' | 'left' | 'right' }[] {
  if (boxes.length === 0) return [];
  if (mode === 'rows') {
    const a = boxes[0];
    const b = boxes[boxes.length - 1];
    return [
      { x: a.left + a.width / 2, y: a.top, dir: 'down' },
      { x: b.left + b.width / 2, y: b.top + b.height, dir: 'up' },
    ];
  }
  const out: { x: number; y: number; dir: 'left' | 'right' }[] = [];
  let start = boxes[0];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const next = boxes[i + 1];
    if (next && Math.abs(next.left - (b.left + b.width + gap)) < 0.5) continue;
    out.push({ x: start.left, y: start.top + start.height / 2, dir: 'right' });
    out.push({ x: b.left + b.width, y: b.top + b.height / 2, dir: 'left' });
    if (next) start = next;
  }
  return out;
}

export function createReelBands(stage: HTMLElement): ReelBands {
  const root = document.createElement('div');
  root.className = 'reel-bands';
  root.hidden = true;
  stage.append(root);
  let cab: Cabinet<unknown> | null = null;
  let sources: (BandSource | NoBand)[] = [];
  const rows = new WeakMap<object, number>();
  let shown: { src: BandSource; canvas: HTMLCanvasElement; mode: BandMode; pitch?: number; drawn: number | null }[] = [];

  const at = (el: HTMLElement, b: Box): void => {
    el.style.left = `${b.left}px`;
    el.style.top = `${b.top}px`;
    el.style.width = `${b.width}px`;
    el.style.height = `${b.height}px`;
  };

  return {
    sync(next) {
      if (next === cab) return;
      cab = next;
      sources = next ? bandSources(next) : [];
      shown = [];
      root.replaceChildren();
    },
    get count() { return sources.length; },
    row(key, row) { rows.set(key, row); },
    place(layout) {
      root.replaceChildren();
      shown = [];
      root.hidden = !layout;
      if (!layout) return;
      if (layout.noRoom) {
        const note = document.createElement('div');
        note.className = 'reel-bands-note';
        note.textContent = str('bands.no_room_for_the_reel_bands');
        at(note, layout.noRoom);
        root.append(note);
        return;
      }
      const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
      if (layout.card) {
        const cardEl = document.createElement('div');
        cardEl.className = 'reel-bands-card';
        at(cardEl, layout.card);
        root.append(cardEl);
      }
      layout.labels?.forEach((b, i) => {
        const src = sources[i];
        if (!src) return;
        const label = document.createElement('div');
        label.className = 'reel-bands-label';
        label.textContent = str('play.bands.reel_n', { 0: src.reel });
        at(label, b);
        root.append(label);
      });
      layout.boxes.forEach((b, i) => {
        const src = sources[i];
        if (!src) return;
        if ('none' in src) {
          const note = document.createElement('div');
          note.className = 'reel-bands-none';
          note.textContent = str('bands.reel_n_no_band', { 0: src.reel });
          at(note, b);
          root.append(note);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.className = 'reel-band';
        canvas.width = Math.max(1, Math.round(b.width * dpr));
        canvas.height = Math.max(1, Math.round(b.height * dpr));
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', str('bands.reel_n_band', { 0: src.reel }));
        at(canvas, b);
        root.append(canvas);
        shown.push({ src, canvas, mode: layout.mode, drawn: null });
      });
      const first = shown[0];
      if (first) {
        const pitch = sharedPitch(shown.map((s) => s.src), layout.mode, first.canvas.width, first.canvas.height);
        for (const s of shown) s.pitch = pitch;
      }
      {
        const marks = layout.mode === 'whole'
          ? winLineMarks(layout.boxes, 'columns', WHOLE_GAP)
          : winLineMarks(layout.boxes, layout.mode);
        for (const m of marks) {
          const mark = document.createElement('div');
          mark.className = `reel-bands-mark ${m.dir}`;
          mark.style.left = `${m.x}px`;
          mark.style.top = `${m.y}px`;
          root.append(mark);
        }
      }
      this.paint();
    },
    paint() {
      for (const s of shown) {
        const row = rows.get(s.src.key);
        if (row === undefined || row === s.drawn) continue;
        const ctx = s.canvas.getContext('2d');
        if (!ctx) continue;
        ctx.imageSmoothingEnabled = true;
        paintBand(ctx, s.src, row, s.mode, s.canvas.width, s.canvas.height, s.pitch, DIM_OUTSIDE, false, true);
        s.drawn = row;
      }
    },
    wholeCap(colH) {
      const caps = sources.flatMap((s) => ('none' in s ? [] : [(colH / s.stops) * s.aspect]));
      return caps.length ? Math.min(...caps) : WHOLE_MAX;
    },
  };
}
