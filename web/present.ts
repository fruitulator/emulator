
export interface PresentPlan {
  halvings: { w: number; h: number }[];
  superSample: boolean;
}

export function uniformPlan(sw: number, sh: number, tw: number, smooth = true): PresentPlan {
  const halvings: { w: number; h: number }[] = [];
  if (!smooth) return { halvings, superSample: false };
  let w = sw;
  let h = sh;
  while (Math.ceil(w / 2) >= tw) {
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
    halvings.push({ w, h });
  }
  return { halvings, superSample: w > tw };
}

export function axisPlan(sw: number, sh: number, tw: number, th: number): PresentPlan {
  const halvings: { w: number; h: number }[] = [];
  let w = sw;
  let h = sh;
  for (;;) {
    const hx = Math.ceil(w / 2) >= tw;
    const hy = Math.ceil(h / 2) >= th;
    if (!hx && !hy) break;
    if (hx) w = Math.ceil(w / 2);
    if (hy) h = Math.ceil(h / 2);
    halvings.push({ w, h });
  }
  return { halvings, superSample: w > tw || h > th };
}

export function planSize(plan: PresentPlan, sw: number, sh: number, tw: number, th: number): { w: number; h: number } {
  if (plan.superSample) return { w: tw, h: th };
  return plan.halvings[plan.halvings.length - 1] ?? { w: sw, h: sh };
}

export class Presenter {
  private readonly steps: HTMLCanvasElement[] = [];
  private big: HTMLCanvasElement | null = null;

  run(dst: CanvasRenderingContext2D, src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number,
    plan: PresentPlan, tw: number, th: number, dirty?: readonly DirtyBox[] | null): void {
    let box: DirtyBox[] | null = dirty ? [...dirty] : null;
    let from: CanvasImageSource = src;
    let x = sx;
    let y = sy;
    let w = sw;
    let h = sh;
    const n = plan.halvings.length;
    const inSteps = plan.superSample ? n : n - 1;
    for (let i = 0; i < inSteps; i++) {
      const { w: nw, h: nh } = plan.halvings[i];
      let step = this.steps[i];
      if (!step) { step = this.steps[i] = document.createElement('canvas'); box = null; }
      if (step.width !== nw || step.height !== nh) {
        step.width = nw;
        step.height = nh;
        box = null;
      }
      box = blitBox(step.getContext('2d')!, from, x, y, w, h, nw, nh, box);
      from = step;
      x = 0;
      y = 0;
      w = nw;
      h = nh;
    }
    this.steps.length = Math.max(0, inSteps);
    if (!plan.superSample) {
      this.big = null;
      blitBox(dst, from, x, y, w, h, tw, th, box);
      return;
    }
    let big = this.big;
    if (!big) { big = this.big = document.createElement('canvas'); box = null; }
    if (big.width !== 2 * tw || big.height !== 2 * th) {
      big.width = 2 * tw;
      big.height = 2 * th;
      box = null;
    }
    box = blitBox(big.getContext('2d')!, from, x, y, w, h, 2 * tw, 2 * th, box);
    blitBox(dst, big, 0, 0, 2 * tw, 2 * th, tw, th, box);
  }

  free(): void {
    this.steps.length = 0;
    this.big = null;
  }
}

export interface DirtyBox { x0: number; y0: number; x1: number; y1: number }

export function reachedBox(b: DirtyBox, sw: number, sh: number, dw: number, dh: number): DirtyBox {
  const kx = dw / sw;
  const ky = dh / sh;
  return {
    x0: Math.max(0, Math.floor((b.x0 - 1) * kx) - 1),
    y0: Math.max(0, Math.floor((b.y0 - 1) * ky) - 1),
    x1: Math.min(dw, Math.ceil((b.x1 + 1) * kx) + 1),
    y1: Math.min(dh, Math.ceil((b.y1 + 1) * ky) + 1),
  };
}

const PARTIAL_MARGIN = 4;

export function mergeBoxes(boxes: DirtyBox[]): DirtyBox[] {
  const out = boxes.filter((b) => b.x1 > b.x0 && b.y1 > b.y0).map((b) => ({ ...b }));
  const area = (b: DirtyBox) => (b.x1 - b.x0) * (b.y1 - b.y0);
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const p = out[i], q = out[j];
        const u = { x0: Math.min(p.x0, q.x0), y0: Math.min(p.y0, q.y0), x1: Math.max(p.x1, q.x1), y1: Math.max(p.y1, q.y1) };
        if (area(u) <= (area(p) + area(q)) * 1.25) { out[i] = u; out.splice(j, 1); merged = true; break; }
      }
    }
  }
  return out;
}

function blitBox(
  dst: CanvasRenderingContext2D, src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number,
  boxes: DirtyBox[] | null,
): DirtyBox[] | null {
  if (!boxes) { smoothBlit(dst, src, sx, sy, sw, sh, dw, dh); return null; }
  const reached = mergeBoxes(boxes.map((b) => reachedBox(b, sw, sh, dw, dh)));
  let area = 0;
  for (const r of reached) area += (r.x1 - r.x0) * (r.y1 - r.y0);
  if (area > dw * dh * 0.6) { smoothBlit(dst, src, sx, sy, sw, sh, dw, dh); return null; }
  const kx = sw / dw;
  const ky = sh / dh;
  dst.imageSmoothingEnabled = true;
  for (const r of reached) {
    const ex0 = Math.max(0, r.x0 - PARTIAL_MARGIN);
    const ey0 = Math.max(0, r.y0 - PARTIAL_MARGIN);
    const ex1 = Math.min(dw, r.x1 + PARTIAL_MARGIN);
    const ey1 = Math.min(dh, r.y1 + PARTIAL_MARGIN);
    dst.save();
    dst.beginPath();
    dst.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    dst.clip();
    dst.globalCompositeOperation = 'source-over';
    dst.drawImage(src, sx + ex0 * kx, sy + ey0 * ky, (ex1 - ex0) * kx, (ey1 - ey0) * ky, ex0, ey0, ex1 - ex0, ey1 - ey0);
    dst.restore();
  }
  return reached;
}

function smoothBlit(
  dst: CanvasRenderingContext2D, src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number,
): void {
  dst.imageSmoothingEnabled = true;
  dst.globalCompositeOperation = 'copy';
  dst.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
}
