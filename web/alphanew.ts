
export const Seg = {
  TopBar: 0,
  UpperRight: 1,
  LowerRight: 2,
  BottomBar: 3,
  LowerLeft: 4,
  UpperLeft: 5,
  MiddleLeft: 6,
  MiddleRight: 7,
  UpperLeftDiag: 8,
  UpperCentre: 9,
  UpperRightDiag: 10,
  LowerRightDiag: 11,
  LowerCentre: 12,
  LowerLeftDiag: 13,
  Point: 14,
  TopLeftBar: 15,
  TopRightBar: 16,
  BottomRightBar: 17,
  BottomLeftBar: 18,
  Comma: 19,
} as const;

export interface AlphaNewGeom {
  columns: number;
  width: number;
  height: number;
  thickness: number;
  spacing: number;
  hSpacing: number;
  vSpacing: number;
  slant: number;
  centre: number;
  chop: number;
  seg16: boolean;
}

export type Pt = readonly [number, number];
export interface Dot { readonly x: number; readonly y: number; readonly r: number }

export interface AlphaNewCell {
  cellW: number;
  margin: number;
  left: number; top: number; right: number; bottom: number;
  xC: number; yM: number;
}

export function alphaNewCell(g: AlphaNewGeom): AlphaNewCell {
  const cellW = Math.trunc(g.width / g.columns);
  const margin = Math.trunc((g.width - cellW * g.columns) / 2);
  const h = g.height & 1 ? g.height : g.height - 1;
  const left = g.hSpacing / 2;
  const top = g.vSpacing / 2;
  const right = cellW - g.hSpacing / 2;
  const bottom = h - g.vSpacing / 2;
  return {
    cellW, margin, left, top, right, bottom,
    xC: ((left + right) * g.centre) / 100,
    yM: (bottom + top) / 2,
  };
}

export function alphaNewPolygons(g: AlphaNewGeom): (Pt[] | null)[] {
  const c = alphaNewCell(g);
  const { left: L, top: T, right: R, bottom: B, xC, yM } = c;
  const Th = g.thickness;
  const H = Th / 2;
  const S = g.spacing / 2;
  const ch = (g.chop * Th) / 100;
  const c2 = ch / 2;
  const notch = g.height > 0x12;
  const tip = H >= 1;
  const tan = Math.tan((Math.PI * g.slant) / 180);
  const p = (x: number, y: number): Pt => [x + (B - y) * tan, y];

  const out: (Pt[] | null)[] = new Array(20).fill(null);

  out[Seg.TopBar] = [
    p(L + S + ch, T), p(L + S + c2, T + c2), p(L + Th + S, T + Th),
    ...(notch ? [p(xC - H - S, T + Th), p(xC - S, T + H), p(xC + S, T + H), p(xC + H + S, T + Th)] : []),
    p(R - Th - S, T + Th), p(R - S - c2, T + c2), p(R - S - ch, T),
  ];
  out[Seg.UpperRight] = [
    p(R, yM - H - S), p(R - H, yM - S), p(R - Th, yM - H - S),
    p(R - Th, T + Th + S), p(R - c2, T + S + c2), p(R, T + S + ch),
  ];
  out[Seg.LowerRight] = [
    p(R, B - S - ch), p(R - c2, B - S - c2), p(R - Th, B - Th - S),
    p(R - Th, yM + H + S), p(R - H, yM + S), p(R, yM + H + S),
  ];
  out[Seg.BottomBar] = [
    p(L + Th + S, B - Th), p(L + S + c2, B - c2), p(L + S + ch, B),
    p(R - S - ch, B), p(R - S - c2, B - c2), p(R - Th - S, B - Th),
    ...(notch ? [p(xC + H + S, B - Th), p(xC + S, B - H), p(xC - S, B - H), p(xC - H - S, B - Th)] : []),
  ];
  out[Seg.LowerLeft] = [
    p(L, yM + H + S), p(L + H, yM + S), p(L + Th, yM + H + S),
    p(L + Th, B - Th - S), p(L + c2, B - S - c2), p(L, B - S - ch),
  ];
  out[Seg.UpperLeft] = [
    p(L, T + S + ch), p(L + c2, T + S + c2), p(L + Th, T + Th + S),
    p(L + Th, yM - H - S), p(L + H, yM - S), p(L, yM - H - S),
  ];
  out[Seg.MiddleLeft] = [
    p(L + H + S, yM), p(L + Th + S, yM - H), p(xC - H - S, yM - H),
    p(xC - S, yM), p(xC - H - S, yM + H), p(L + Th + S, yM + H),
  ];
  out[Seg.MiddleRight] = [
    p(xC + S, yM), p(xC + H + S, yM - H), p(R - Th - S, yM - H),
    p(R - H - S, yM), p(R - Th - S, yM + H), p(xC + H + S, yM + H),
  ];
  out[Seg.UpperLeftDiag] = [
    p(L + Th + S, T + Th + S), p(L + Th + H + S, T + Th + S),
    p(xC - H - S, yM - Th - Th - S), p(xC - H - S, yM - H - S),
    p(xC - Th - S, yM - H - S), p(L + Th + S, T + Th + Th + H + S),
  ];
  out[Seg.UpperCentre] = [
    ...(tip ? [p(xC, T + H + S)] : []),
    p(xC, T + Th + S), p(xC + H, T + Th + S), p(xC + H, yM - H - S),
    p(xC, yM - S), p(xC - H, yM - H - S), p(xC - H, T + Th + S),
  ];
  out[Seg.UpperRightDiag] = [
    p(R - Th - H - S, T + Th + S), p(R - Th - S, T + Th + S),
    p(R - Th - S, T + Th + Th + H + S), p(xC + Th + S, yM - H - S),
    p(xC + H + S, yM - H - S), p(xC + H + S, yM - Th - Th - S),
  ];
  out[Seg.LowerRightDiag] = [
    p(xC + H + S, yM + H + S), p(xC + Th + S, yM + H + S),
    p(R - Th - S, B - Th - Th - H - S), p(R - Th - S, B - Th - S),
    p(R - Th - H - S, B - Th - S), p(xC + H + S, yM + Th + Th + S),
  ];
  out[Seg.LowerCentre] = [
    p(xC, yM + S), p(xC + H, yM + H + S), p(xC + H, B - Th - S),
    ...(tip ? [p(xC, B - H - S)] : []),
    p(xC, B - Th - S), p(xC - H, B - Th - S), p(xC - H, yM + H + S),
  ];
  out[Seg.LowerLeftDiag] = [
    p(L + Th + S, B - Th - S), p(L + Th + S, B - Th - Th - H - S),
    p(xC - Th - S, yM + H + S), p(xC - H - S, yM + H + S),
    p(xC - H - S, yM + Th + Th + S), p(L + Th + H + S, B - Th - S),
  ];
  out[Seg.TopLeftBar] = [
    p(L + S + ch, T), p(L + S + c2, T + c2), p(L + Th + S, T + Th),
    p(xC - H - S, T + Th), p(xC - S, T + H), p(xC - S, T),
  ];
  out[Seg.TopRightBar] = [
    p(xC + S, T), p(xC + S, T + H), p(xC + H + S, T + Th),
    p(R - Th - S, T + Th), p(R - S - c2, T + c2), p(R - S - ch, T),
  ];
  out[Seg.BottomRightBar] = [
    p(xC + H + S, B - Th), p(xC + S, B - H), p(xC + S, B),
    p(R - S - ch, B), p(R - S - c2, B - c2), p(R - Th - S, B - Th),
  ];
  out[Seg.BottomLeftBar] = [
    p(L + Th + S, B - Th), p(xC - H - S, B - Th), p(xC - S, B - H),
    p(xC - S, B), p(L + S + ch, B), p(L + S + c2, B - c2),
  ];
  return out;
}

export function alphaNewDots(g: AlphaNewGeom): { point: Dot; comma: Dot } {
  const { right: R, bottom: B } = alphaNewCell(g);
  const r = Math.max(0.5, g.thickness / 2);
  return { point: { x: R + r, y: B - r, r }, comma: { x: R, y: B, r } };
}

export interface AlphaNewColours { on: string; off: string; bg: string }

const INTENSITY = [
  0, 39, 70, 95, 110, 125, 135, 145, 169, 175, 181, 187, 193, 198, 203, 208,
  213, 218, 222, 226, 230, 234, 237, 240, 243, 246, 248, 250, 252, 253, 254, 255,
];

export function alphaNewIntensity(duty: number): number {
  return INTENSITY[Math.max(0, Math.min(31, Math.trunc(duty)))] / 255;
}

interface Built {
  sig: string;
  cell: AlphaNewCell;
  ghost: Path2D;
  byMask: Map<number, Path2D>;
  polys: (Pt[] | null)[];
  dots: { point: Dot; comma: Dot };
}
let built: Built | null = null;

function sigOf(g: AlphaNewGeom): string {
  return [g.columns, g.width, g.height, g.thickness, g.spacing, g.hSpacing,
    g.vSpacing, g.slant, g.centre, g.chop, g.seg16 ? 1 : 0].join(',');
}

function trace(path: Path2D, poly: Pt[]): void {
  path.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) path.lineTo(poly[i][0], poly[i][1]);
  path.closePath();
}

function build(g: AlphaNewGeom): Built {
  const sig = sigOf(g);
  if (built?.sig === sig) return built;
  const polys = alphaNewPolygons(g);
  const dots = alphaNewDots(g);
  const ghost = new Path2D();
  for (const poly of polys) if (poly) trace(ghost, poly);
  for (const d of [dots.point, dots.comma]) {
    ghost.moveTo(d.x + d.r, d.y);
    ghost.arc(d.x, d.y, d.r, 0, Math.PI * 2);
  }
  built = { sig, cell: alphaNewCell(g), ghost, byMask: new Map(), polys, dots };
  return built;
}

function maskPath(b: Built, mask: number): Path2D {
  let path = b.byMask.get(mask);
  if (path) return path;
  path = new Path2D();
  for (let s = 0; s < 20; s++) {
    if (!(mask & (1 << s))) continue;
    const poly = b.polys[s];
    if (poly) { trace(path, poly); continue; }
    const d = s === Seg.Point ? b.dots.point : b.dots.comma;
    path.moveTo(d.x + d.r, d.y);
    path.arc(d.x, d.y, d.r, 0, Math.PI * 2);
  }
  b.byMask.set(mask, path);
  return path;
}

export function drawAlphaNew(
  ctx: CanvasRenderingContext2D,
  masks: number[],
  g: AlphaNewGeom,
  colours: AlphaNewColours,
  left: number,
  top: number,
  duty = 31,
): void {
  const b = build(g);
  const lit = alphaNewIntensity(duty);
  ctx.save();
  ctx.fillStyle = colours.bg;
  ctx.fillRect(left, top, g.width, g.height);
  for (let i = 0; i < g.columns; i++) {
    const ox = left + b.cell.margin + i * b.cell.cellW;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, top, b.cell.cellW, g.height);
    ctx.clip();
    ctx.translate(ox, top);
    ctx.fillStyle = colours.off;
    ctx.fill(b.ghost);
    const mask = masks[i] ?? 0;
    if (mask && lit > 0) {
      ctx.globalAlpha = lit;
      ctx.fillStyle = colours.on;
      ctx.fill(maskPath(b, mask));
    }
    ctx.restore();
  }
  ctx.restore();
}

export interface AlphaNewStyle extends AlphaNewColours {
  thickness: number;
  spacing: number;
  hSpacing: number;
  vSpacing: number;
  slant: number;
  centre: number;
  chop: number;
}

export function alphaNewGeom(
  style: AlphaNewStyle, columns: number, width: number, height: number, seg16: boolean,
): AlphaNewGeom {
  const cellW = Math.trunc(width / columns);
  const guard = (v: number, limit: number, fallback: number) => (v < limit ? v : fallback);
  return {
    columns, width, height, seg16,
    thickness: guard(style.thickness, cellW / 2, 2),
    spacing: guard(style.spacing, cellW / 2, 0),
    hSpacing: guard(style.hSpacing, cellW, 5),
    vSpacing: guard(style.vSpacing, height, 4),
    slant: style.slant, centre: style.centre, chop: style.chop,
  };
}
