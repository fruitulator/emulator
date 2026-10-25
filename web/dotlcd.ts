
const FONT_HEX =
  '00005f000000 7e0909097e00 7f4949493600 3e4141412200 417f41413e00 7f4949494100 7f0909090100 3e4141493a00'
  + ' 7f0808087f00 00417f410000 2040413f0100 7f0814224100 7f4040404000 7f020c027f00 7f0408107f00 3e4141413e00'
  + ' 7f0909090600 3e4151617e00 7f0919294600 264949493200 01017f010100 3f4040403f00 1f2040201f00 3f4030403f00'
  + ' 631408146300 070870080700 615149454300 007f41410000 020408102000 0041417f0000 040201020400 404040404000'
  + ' 000000000000 00005f000000 000300030000 143e143e1400 042a7f2a1000 000000000000 000000000000 000004020100'
  + ' 001c22410000 0041221c0000 2a1c081c2a00 08083e080800 000000000040 080808080800 006060000000 601008040300'
  + ' 3e4141413e00 00427f400000 426151494600 224149493600 1814127f1000 274545453900 3c4a49483000 412111090700'
  + ' 364949493600 060949291e00 000000000000 000000000000 000000000000 001414140000 412214080000 020159050200'
  + ' 3e415d551e00 7e0909097e00 7f4949493600 3e4141412200 417f41413e00 7f4949494100 7f0909090100 3e4141493a00'
  + ' 7f0808087f00 00417f410000 2040413f0100 7f0814224100 7f4040404000 7f020c027f00 7f0408107f00 3e4141413e00'
  + ' 7f0909090600 3e4151617e00 7f0919294600 264949493200 01017f010100 3f4040403f00 1f2040201f00 3f4030403f00'
  + ' 631408146300 070870080700 615149454300 007f41410000 020408102000 0041417f0000 040201020400 404040404000'
  + ' 000000000000 205454547800 7f4844443800 384444442000 384444487f00 385454541800 087e09010200 0c5252523e00'
  + ' 7f0804047800 00447d400000 2040443d0000 7f1028440000 00417f400000 7c0478047800 7c0804047800 384444443800'
  + ' 7c1414140800 181414187c00 7c0804040800 485454542000 043f44402000 3c4040207c00 1c2040201c00 3c4030403c00'
  + ' 442810284400 0c5050503c00 4464544c4400 004022000000 000814224100 001414140000 412214080000 020159050200';

export const DOTLCD_FONT: Uint8Array = (() => {
  const out = new Uint8Array(144 * 6);
  FONT_HEX.split(' ').forEach((g, i) => {
    for (let k = 0; k < 6; k++) out[i * 6 + k] = parseInt(g.slice(k * 2, k * 2 + 2), 16);
  });
  return out;
})();

export interface DotLcdGeometry {
  xSize: number;
  ySize: number;
  digitSpacing: number;
  lineSpacing: number;
}

const DOT_SPACING = 0;

export function dotLcdSize(g: DotLcdGeometry): { width: number; height: number } {
  return {
    width: (6 * (g.xSize + DOT_SPACING) + g.digitSpacing) * 16 + 3,
    height: (g.ySize + DOT_SPACING) * 18 + g.lineSpacing + 6,
  };
}

export function dotLcdCell(g: DotLcdGeometry, i: number): { x: number; y: number } {
  return {
    x: 3 + (i % 16) * (6 * (g.xSize + DOT_SPACING) + g.digitSpacing),
    y: 3 + Math.floor(i / 16) * (g.ySize * 9 + g.lineSpacing),
  };
}

export type DotLcdFill = (x: number, y: number, w: number, h: number, argb: number) => void;

function paintGlyph(fill: DotLcdFill, g: DotLcdGeometry, on: number, off: number,
  code: number, ox: number, oy: number): void {
  const base = code * 6;
  const clear = DOTLCD_FONT[base + 5] ? null : off;
  const px = g.xSize + DOT_SPACING, py = g.ySize + DOT_SPACING;
  for (let col = 0; col < 6; col++) {
    const bits = DOTLCD_FONT[base + col];
    const x = ox + col * px;
    let y = oy + (col === 5 ? 1 : 0);
    for (let row = 0; row < 7; row++, y += py) {
      if ((bits >> row) & 1) fill(x, y, g.xSize, g.ySize, on);
      else if ((col < 5 || row === 6) && clear !== null) fill(x, y, g.xSize, g.ySize, clear);
    }
  }
}

export function dotLcdPaint(fill: DotLcdFill, g: DotLcdGeometry,
  colours: { on: number; off: number; bg: number }, cells?: ArrayLike<number>): void {
  const { width, height } = dotLcdSize(g);
  fill(0, 0, width, height, colours.bg);
  for (let i = 0; i < 32; i++) {
    const { x, y } = dotLcdCell(g, i);
    paintGlyph(fill, g, colours.on, colours.off, 0x20, x, y);
  }
  if (!cells) return;
  for (let i = 0; i < 32 && i < cells.length; i++) {
    const code = cells[i] & 0xff;
    if (code === 0x20 || code >= 0x90) continue;
    const { x, y } = dotLcdCell(g, i);
    paintGlyph(fill, g, colours.on, colours.off, code, x, y);
  }
}
