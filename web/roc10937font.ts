import { ROC10937_CHARSET } from '../src/hw/s16lf01';
import {
  Seg, alphaNewGeom, drawAlphaNew, type AlphaNewStyle,
} from './alphanew';

const ROLE = [
  Seg.TopLeftBar, Seg.TopRightBar, Seg.UpperRight, Seg.LowerRight,
  Seg.BottomRightBar, Seg.BottomLeftBar, Seg.LowerLeft, Seg.UpperLeft,
  Seg.UpperCentre, Seg.UpperRightDiag, Seg.MiddleRight, Seg.LowerRightDiag,
  Seg.LowerCentre, Seg.LowerLeftDiag, Seg.MiddleLeft, Seg.UpperLeftDiag,
  Seg.Point, Seg.Comma,
];

export function roc10937Roles(mask: number, seg16: boolean): number {
  let out = 0;
  for (let bit = 0; bit < ROLE.length; bit++) {
    if (!(mask & (1 << bit))) continue;
    if (!seg16) {
      if (bit === 1 || bit === 4) continue;
      out |= 1 << (bit === 0 ? Seg.TopBar : bit === 5 ? Seg.BottomBar : ROLE[bit]);
      continue;
    }
    out |= 1 << ROLE[bit];
  }
  return out;
}

export function roc10937Glyph(code: number): number {
  return ROC10937_CHARSET[code & 0x3f] ?? 0;
}

export function drawRoc10937Text(
  ctx: CanvasRenderingContext2D,
  masks: number[],
  n: number,
  left: number,
  top: number,
  width: number,
  height: number,
  style: AlphaNewStyle,
  seg16 = true,
  duty = 31,
): void {
  const g = alphaNewGeom(style, n, width, height, seg16);
  drawAlphaNew(ctx, masks.map((m) => roc10937Roles(m, seg16)), g, style, left, top, duty);
}
