
export const BFM_ALPHA_CHARSET: readonly number[] = [
  0xa626, 0xe027, 0x462e, 0x2205, 0x062e, 0xa205, 0xa005, 0x6225,
  0xe023, 0x060c, 0x2222, 0xa881, 0x2201, 0x20e3, 0x2863, 0x2227,
  0xe007, 0x2a27, 0xe807, 0xc225, 0x040c, 0x2223, 0x2091, 0x2833,
  0x08d0, 0x04c0, 0x0294, 0x2205, 0x0840, 0x0226, 0x0810, 0x0200,
  0x0000, 0xc290, 0x0009, 0xc62a, 0xc62d, 0x0000, 0x0000, 0x0080,
  0x0880, 0x0050, 0xccd8, 0xc408, 0x1000, 0xc000, 0x1000, 0x0090,
  0x22b7, 0x0408, 0xe206, 0xc226, 0xc023, 0xc225, 0xe225, 0x0026,
  0xe227, 0xc227, 0x0000, 0x0000, 0x0290, 0xc200, 0x0a40, 0x4406,
];

export const BFM_ALPHA_DEFAULT_OFF_LEVEL = 70;
export const BFM_ALPHA_DEFAULT_COLUMNS = 16;
export const BFM_ALPHA_DEFAULT_INK = 0xff00ff00;

const FLASH_SEGMENT = 8;

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface BfmAlphaLayers {
  segW: number;
  glyphs: Pixels;
  ghost: Pixels;
  segments: Pixels;
}

export function bfmAlphaLayers(
  strip: Pixels, ink: number, offLevel: number,
  make: (w: number, h: number) => Pixels,
): BfmAlphaLayers | null {
  const segW = strip.width >> 4;
  const h = strip.height;
  if (segW <= 0 || h <= 0) return null;
  const lit = (x: number, y: number): boolean => {
    const o = (y * strip.width + x) * 4;
    return strip.data[o] === 0xff && strip.data[o + 1] === 0xff && strip.data[o + 2] === 0xff;
  };
  const ir = (ink >>> 16) & 0xff, ig = (ink >>> 8) & 0xff, ib = ink & 0xff, ia = ink >>> 24;
  const put = (img: Pixels, x: number, y: number, r: number, g: number, b: number, a: number) => {
    const o = (y * img.width + x) * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a;
  };

  const segments = make(segW * 16, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < segW * 16; x++) if (lit(x, y)) put(segments, x, y, ir, ig, ib, ia);
  }

  const glyphs = make(segW * 64, h);
  for (let g = 0; g < 64; g++) {
    const pattern = BFM_ALPHA_CHARSET[g];
    if (!pattern) continue;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < segW; x++) {
        for (let s = 0; s < 16; s++) {
          if (pattern & (1 << s) && lit(s * segW + x, y)) {
            put(glyphs, g * segW + x, y, ir, ig, ib, ia);
            break;
          }
        }
      }
    }
  }

  const a = (Math.max(0, Math.min(255, offLevel)) * ia) / (255 * 255);
  const ghost = make(segW, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < segW; x++) {
      let on = false;
      for (let s = 0; s < 16 && !on; s++) on = s !== FLASH_SEGMENT && lit(s * segW + x, y);
      if (on) put(ghost, x, y, Math.round(ir * a), Math.round(ig * a), Math.round(ib * a), 0xff);
      else put(ghost, x, y, 0, 0, 0, 0xff);
    }
  }
  return { segW, glyphs, ghost, segments };
}

export type BfmAlphaCell =
  | { custom: false; glyph: number; punct: number }
  | { custom: true; pattern: number };

export function bfmAlphaCell(word: number): BfmAlphaCell {
  if (word & 0x10000) return { custom: true, pattern: word & 0xffff };
  const w = word === 0 || (word & 0x60000) !== 0 ? 0x20 : word;
  const p = (w & 0xff00) >> 8;
  return {
    custom: false,
    glyph: drawable(w & 0x3f),
    punct: p === 0x2c || p === 0x2e ? drawable(p) : -1,
  };
}

function drawable(g: number): number {
  return g + 1 < 64 ? g : -1;
}

export function bfmAlphaOrder(columns: number, reversed: boolean): number[] {
  const out: number[] = [];
  for (let p = 0; p < columns; p++) {
    const i = reversed ? p : columns - 1 - p;
    out.push(15 - i);
  }
  return out;
}
