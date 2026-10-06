import { Seg } from './alphanew';
import { bd1Glyph, bd1Roles } from './bd1font';
import { roc10937Glyph, roc10937Roles } from './roc10937font';

export const CELL_CUSTOM = 0x10000;

const TOP_HALVES = (1 << Seg.TopLeftBar) | (1 << Seg.TopRightBar);
const BOTTOM_HALVES = (1 << Seg.BottomLeftBar) | (1 << Seg.BottomRightBar);

export function foldBars(roles: number): number {
  const top = roles & TOP_HALVES;
  const bottom = roles & BOTTOM_HALVES;
  const lone = (top !== 0 && top !== TOP_HALVES) || (bottom !== 0 && bottom !== BOTTOM_HALVES);
  if (lone) return roles;
  let out = roles;
  if (top) out = (out & ~TOP_HALVES) | (1 << Seg.TopBar);
  if (bottom) out = (out & ~BOTTOM_HALVES) | (1 << Seg.BottomBar);
  return out;
}

export function alphaCellRoles(word: number, charset: number | undefined, seg16: boolean): number {
  if (word & CELL_CUSTOM) return bd1Roles(word & 0xffff);
  const code = word & 0x7f;
  let roles = 0;
  if (code >= 0x20) {
    roles = charset === 2
      ? bd1Roles(bd1Glyph(code))
      : roc10937Roles(roc10937Glyph(code), seg16);
    if (seg16 && charset !== 2) roles = foldBars(roles);
  }
  const punct = (word >> 8) & 0xff;
  if (punct === 0x2e) roles |= 1 << Seg.Point;
  else if (punct === 0x2c) roles |= (1 << Seg.Point) | (1 << Seg.Comma);
  return roles;
}
