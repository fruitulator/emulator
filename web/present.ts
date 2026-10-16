
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
    plan: PresentPlan, tw: number, th: number): void {
    let from: CanvasImageSource = src;
    let x = sx;
    let y = sy;
    let w = sw;
    let h = sh;
    const n = plan.halvings.length;
    const inSteps = plan.superSample ? n : n - 1;
    for (let i = 0; i < inSteps; i++) {
      const { w: nw, h: nh } = plan.halvings[i];
      const step = this.steps[i] ??= document.createElement('canvas');
      if (step.width !== nw || step.height !== nh) {
        step.width = nw;
        step.height = nh;
      }
      smoothBlit(step.getContext('2d')!, from, x, y, w, h, nw, nh);
      from = step;
      x = 0;
      y = 0;
      w = nw;
      h = nh;
    }
    this.steps.length = Math.max(0, inSteps);
    if (!plan.superSample) {
      this.big = null;
      smoothBlit(dst, from, x, y, w, h, tw, th);
      return;
    }
    const big = this.big ??= document.createElement('canvas');
    if (big.width !== 2 * tw || big.height !== 2 * th) {
      big.width = 2 * tw;
      big.height = 2 * th;
    }
    smoothBlit(big.getContext('2d')!, from, x, y, w, h, 2 * tw, 2 * th);
    smoothBlit(dst, big, 0, 0, 2 * tw, 2 * th, tw, th);
  }

  free(): void {
    this.steps.length = 0;
    this.big = null;
  }
}

function smoothBlit(
  dst: CanvasRenderingContext2D, src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number,
): void {
  dst.imageSmoothingEnabled = true;
  dst.globalCompositeOperation = 'copy';
  dst.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
}
