import type { CabLamp, Rect } from './dat';
import type { PlatformView } from './platform';
import { controlCaption, controlId, machineControls } from './keytable';
import { layoutPoint, type CanvasFit } from './cabhit';
import { str } from './i18n';

export interface KeyHint {
  id: string;
  keys: string[];
  at?: { x: number; y: number };
  lamp?: CabLamp<unknown>;
  label: string;
}

export type HintPlace = (h: KeyHint) => { x: number; y: number } | null;

export function canvasPlace(fit: CanvasFit): HintPlace {
  const o = layoutPoint(fit, 0, 0);
  return (h) => (h.at ? { x: (h.at.x - o.x) * o.scale, y: (h.at.y - o.y) * o.scale } : null);
}

function onCabinet(lp: Rect, content: Rect): boolean {
  if (!(lp.width > 0 && lp.height > 0)) return false;
  return lp.left < content.left + content.width && lp.left + lp.width > content.left
    && lp.top < content.top + content.height && lp.top + lp.height > content.top;
}

function drawsArt(lp: CabLamp<unknown>): boolean {
  return lp.states.length > 0 || !!lp.offState;
}

function placement(lamps: readonly CabLamp<unknown>[], content: Rect): CabLamp<unknown> | null {
  let best: CabLamp<unknown> | null = null;
  for (const lp of lamps) {
    if (!onCabinet(lp, content)) continue;
    if (!best) { best = lp; continue; }
    const a = drawsArt(lp), b = drawsArt(best);
    if (a !== b) { if (a) best = lp; continue; }
    const area = lp.width * lp.height, bestArea = best.width * best.height;
    if (a ? area < bestArea : area > bestArea) best = lp;
  }
  return best;
}

export function keyHints(
  lamps: readonly CabLamp<unknown>[],
  content: Rect,
  view: PlatformView,
  o: Parameters<typeof machineControls>[2] = {},
): KeyHint[] {
  const { rows, winner } = machineControls(lamps, view, o);
  const all = new Map<string, CabLamp<unknown>[]>();
  for (const lp of lamps) {
    const id = controlId(lp, view, o);
    if (id) all.set(id, [...(all.get(id) ?? []), lp]);
  }
  const out: KeyHint[] = [];
  for (const c of rows) {
    const keys = c.keys.filter((k) => winner.get(k) === c.id);
    if (!keys.length) continue;
    const best = placement(all.get(c.id) ?? c.lamps, content);
    out.push({
      id: c.id,
      keys,
      at: best ? { x: best.left + best.width / 2, y: best.top + best.height / 2 } : undefined,
      lamp: best ?? undefined,
      label: controlCaption(c, false) ?? '',
    });
  }
  return out;
}

export interface LabelBox { x: number; y: number; w: number; h: number }

export function separateLabels(boxes: LabelBox[], gap = 2, passes = 40): void {
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ox = (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x);
        const oy = (a.h + b.h) / 2 + gap - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) {
          const d = a.x <= b.x ? 1 : -1;
          a.x -= (d * ox) / 2;
          b.x += (d * ox) / 2;
        } else {
          const d = a.y <= b.y ? 1 : -1;
          a.y -= (d * oy) / 2;
          b.y += (d * oy) / 2;
        }
      }
    }
    if (!moved) return;
  }
}

function fillKeys(el: HTMLElement, keys: readonly string[]): void {
  el.replaceChildren();
  keys.forEach((k, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'key-sep';
      sep.textContent = '/';
      el.append(sep);
    }
    el.append(document.createTextNode(k));
  });
}

export class KeyHintLayer {
  private readonly el: HTMLDivElement;
  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'key-hints';
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
    host.append(this.el);
  }

  get shown(): boolean {
    return !this.el.hidden;
  }

  show(hints: readonly KeyHint[], place: HintPlace): void {
    this.el.replaceChildren();
    const host = (this.el.parentElement ?? this.el).getBoundingClientRect();
    const off: KeyHint[] = [];
    const placed: { tag: HTMLElement; x: number; y: number }[] = [];
    for (const h of hints) {
      const at = place(h);
      if (!at) {
        off.push(h);
        continue;
      }
      const tag = document.createElement('span');
      tag.className = 'key-hint';
      fillKeys(tag, h.keys);
      this.el.append(tag);
      placed.push({ tag, x: at.x - host.left, y: at.y - host.top });
    }
    if (off.length) {
      const box = document.createElement('div');
      box.className = 'key-hints-off';
      const cap = document.createElement('div');
      cap.className = 'key-hints-cap';
      cap.textContent = str('keyhints.not_on_the_cabinet');
      box.append(cap);
      for (const h of off) {
        const r = document.createElement('div');
        r.className = 'key-hints-row';
        const l = document.createElement('span');
        l.textContent = h.label;
        const k = document.createElement('span');
        k.className = 'key-hint inline';
        fillKeys(k, h.keys);
        r.append(l, k);
        box.append(r);
      }
      this.el.append(box);
    }
    this.el.hidden = false;
    const boxes = placed.map((p) => ({ x: p.x, y: p.y, w: p.tag.offsetWidth, h: p.tag.offsetHeight }));
    separateLabels(boxes);
    placed.forEach((p, i) => {
      p.tag.style.left = `${boxes[i].x}px`;
      p.tag.style.top = `${boxes[i].y}px`;
    });
  }

  hide(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.el.replaceChildren();
  }
}
