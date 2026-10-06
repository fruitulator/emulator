
const SEG: Record<string, [number, number, number, number]> = {
  A: [0, 0, 1, 0],
  B: [1, 0, 1, 0.5],
  C: [1, 0.5, 1, 1],
  D: [0, 1, 1, 1],
  E: [0, 0.5, 0, 1],
  F: [0, 0, 0, 0.5],
  G1: [0, 0.5, 0.5, 0.5],
  G2: [0.5, 0.5, 1, 0.5],
  H: [0, 0, 0.5, 0.5],
  I: [0.5, 0, 0.5, 0.5],
  J: [1, 0, 0.5, 0.5],
  K: [0, 1, 0.5, 0.5],
  L: [0.5, 1, 0.5, 0.5],
  M: [1, 1, 0.5, 0.5],
};
const ALL = Object.keys(SEG);

const FONT: Record<string, string[]> = {
  ' ': [],
  '0': ['A', 'B', 'C', 'D', 'E', 'F', 'J', 'K'],
  '1': ['B', 'C', 'J'],
  '2': ['A', 'B', 'G1', 'G2', 'E', 'D'],
  '3': ['A', 'B', 'G2', 'C', 'D'],
  '4': ['F', 'G1', 'G2', 'B', 'C'],
  '5': ['A', 'F', 'G1', 'M', 'D'],
  '6': ['A', 'F', 'G1', 'G2', 'E', 'C', 'D'],
  '7': ['A', 'B', 'C'],
  '8': ['A', 'B', 'C', 'D', 'E', 'F', 'G1', 'G2'],
  '9': ['A', 'B', 'C', 'D', 'F', 'G1', 'G2'],
  A: ['A', 'B', 'C', 'E', 'F', 'G1', 'G2'],
  B: ['A', 'B', 'C', 'D', 'G2', 'I', 'L'],
  C: ['A', 'D', 'E', 'F'],
  D: ['A', 'B', 'C', 'D', 'I', 'L'],
  E: ['A', 'D', 'E', 'F', 'G1'],
  F: ['A', 'E', 'F', 'G1'],
  G: ['A', 'C', 'D', 'E', 'F', 'G2'],
  H: ['B', 'C', 'E', 'F', 'G1', 'G2'],
  I: ['A', 'D', 'I', 'L'],
  J: ['B', 'C', 'D', 'E'],
  K: ['E', 'F', 'G1', 'J', 'M'],
  L: ['D', 'E', 'F'],
  M: ['B', 'C', 'E', 'F', 'H', 'J'],
  N: ['B', 'C', 'E', 'F', 'H', 'M'],
  O: ['A', 'B', 'C', 'D', 'E', 'F'],
  P: ['A', 'B', 'E', 'F', 'G1', 'G2'],
  Q: ['A', 'B', 'C', 'D', 'E', 'F', 'M'],
  R: ['A', 'B', 'E', 'F', 'G1', 'G2', 'M'],
  S: ['A', 'F', 'G1', 'G2', 'C', 'D'],
  T: ['A', 'I', 'L'],
  U: ['B', 'C', 'D', 'E', 'F'],
  V: ['E', 'F', 'J', 'K'],
  W: ['B', 'C', 'E', 'F', 'K', 'M'],
  X: ['H', 'J', 'K', 'M'],
  Y: ['H', 'J', 'L'],
  Z: ['A', 'D', 'J', 'K'],
  '-': ['G1', 'G2'],
  '_': ['D'],
  '=': ['G1', 'G2', 'D'],
  '+': ['G1', 'G2', 'I', 'L'],
  '/': ['J', 'K'],
  '\\': ['H', 'M'],
  '!': ['I', 'L', 'B'],
  '.': ['L'],
  ',': ['K'],
  "'": ['I'],
  '"': ['I', 'B'],
  ':': ['I', 'L'],
  '*': ['G1', 'G2', 'H', 'I', 'J', 'K', 'L', 'M'],
  '?': ['A', 'B', 'G2', 'L'],
  '(': ['J', 'K'],
  ')': ['H', 'M'],
  '<': ['J', 'K'],
  '>': ['H', 'M'],
};

function drawPound(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + w * 0.82, y + h * 0.16);
  ctx.bezierCurveTo(x + w * 0.36, y - h * 0.06, x + w * 0.12, y + h * 0.34, x + w * 0.36, y + h * 0.58);
  ctx.lineTo(x + w * 0.36, y + h * 0.86);
  ctx.moveTo(x + w * 0.08, y + h * 0.52);
  ctx.lineTo(x + w * 0.7, y + h * 0.52);
  ctx.moveTo(x + w * 0.04, y + h);
  ctx.lineTo(x + w * 0.96, y + h);
  ctx.stroke();
}

export interface SegmentColours {
  on: string;
  off: string;
  bg: string;
}

export function argbToCss(argb: number): string {
  const a = (argb >>> 24) & 0xff;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

export function drawSegmentText(
  ctx: CanvasRenderingContext2D,
  text: string,
  n: number,
  left: number,
  top: number,
  width: number,
  height: number,
  colours?: SegmentColours,
): void {
  const on = colours?.on ?? '#39d0ff';
  const off = colours?.off ?? 'rgba(40,80,110,0.16)';
  ctx.fillStyle = colours?.bg ?? '#050505';
  ctx.fillRect(left, top, width, height);

  const gap = width / n;
  const cw = gap * 0.62;
  const ch = height * 0.72;
  const oy = top + (height - ch) / 2;
  const thick = Math.max(1.4, cw * 0.14);
  ctx.lineWidth = thick;
  ctx.lineCap = 'round';

  const stroke = (cell: string[], ox: number, isOn: boolean) => {
    ctx.strokeStyle = isOn ? on : off;
    ctx.beginPath();
    for (const s of cell) {
      const [x0, y0, x1, y1] = SEG[s];
      ctx.moveTo(ox + x0 * cw, oy + y0 * ch);
      ctx.lineTo(ox + x1 * cw, oy + y1 * ch);
    }
    ctx.stroke();
  };

  for (let i = 0; i < n; i++) {
    const ox = left + i * gap + (gap - cw) / 2;
    stroke(ALL, ox, false);
    const c = (text[i] ?? ' ').toUpperCase();
    if (c === '£') {
      ctx.strokeStyle = on;
      drawPound(ctx, ox, oy, cw, ch);
      continue;
    }
    const lit = FONT[c];
    if (lit && lit.length) stroke(lit, ox, true);
  }
}
