import {
  Seg, alphaNewGeom, drawAlphaNew, type AlphaNewStyle,
} from './alphanew';

const BD1_CHARSET: number[] = [
  0xa626, 0xe027, 0x462e, 0x2205, 0x062e, 0xa205, 0xa005, 0x6225,
  0xe023, 0x060c, 0x2222, 0xa881, 0x2201, 0x20e3, 0x2863, 0x2227,
  0xe007, 0x2a27, 0xe807, 0xc225, 0x040c, 0x2223, 0x2091, 0x2833,
  0x08d0, 0x04c0, 0x0294, 0x2205, 0x0840, 0x0226, 0x0810, 0x0200,
  0x0000, 0xc290, 0x0009, 0xc62a, 0xc62d, 0x0100, 0x0000, 0x0080,
  0x0880, 0x0050, 0xccd8, 0xc408, 0x1000, 0xc000, 0x1000, 0x0090,
  0x22b7, 0x0408, 0xe206, 0xc226, 0xc023, 0xc225, 0xe225, 0x0026,
  0xe227, 0xc227, 0xffff, 0x0000, 0x0290, 0xc200, 0x0a40, 0x4406,
];

const ROLE: (number | null)[] = [
  Seg.UpperLeft, Seg.UpperRight, Seg.TopBar, Seg.UpperCentre,
  Seg.LowerLeftDiag, Seg.LowerRight, Seg.UpperLeftDiag, Seg.UpperRightDiag,
  null, Seg.BottomBar, Seg.LowerCentre, Seg.LowerRightDiag,
  Seg.Point, Seg.LowerLeft, Seg.MiddleRight, Seg.MiddleLeft,
];

export function bd1Roles(mask: number): number {
  let out = 0;
  for (let bit = 0; bit < ROLE.length; bit++) {
    const role = ROLE[bit];
    if (role !== null && mask & (1 << bit)) out |= 1 << role;
  }
  return out;
}

export function bd1Glyph(code: number): number {
  return BD1_CHARSET[code & 0x3f] ?? 0;
}

export function drawBd1Text(
  ctx: CanvasRenderingContext2D,
  codes: number[],
  n: number,
  left: number,
  top: number,
  width: number,
  height: number,
  style: AlphaNewStyle,
  duty = 31,
): void {
  const masks = codes.map((c) => (c < 0x20 ? 0 : bd1Roles(bd1Glyph(c))));
  drawAlphaNew(ctx, masks, alphaNewGeom(style, n, width, height, false), style, left, top, duty);
}
