export interface GraphicLcd {
  width: number;
  height: number;
  bits: Uint8Array;
}

export function proconnDotGap(s: number): number {
  return s < 2 ? 0 : s < 4 ? 1 : 2;
}

export function proconnGlcdFit(size: number, width: number, height: number, lcdW: number, lcdH: number): number {
  const fit = Math.floor(Math.min(width / lcdW, height / lcdH));
  return Math.min(Math.max(1, Math.floor(size)), fit);
}

function rgbaWord(argb: number): number {
  const a = (argb >>> 24) & 0xff;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export function proconnGlcdPixels(
  lcd: GraphicLcd, size: number, on: number, off: number, bg: number,
): { width: number; height: number; data: Uint32Array } {
  const s = Math.max(1, Math.floor(size));
  const dot = s - proconnDotGap(s);
  const w = lcd.width * s;
  const h = lcd.height * s;
  const data = new Uint32Array(w * h);
  data.fill(rgbaWord(bg));
  const onW = rgbaWord(on);
  const offW = rgbaWord(off);
  const stride = lcd.width >> 3;
  for (let y = 0; y < lcd.height; y++) {
    for (let x = 0; x < lcd.width; x++) {
      const c = lcd.bits[y * stride + (x >> 3)] & (0x80 >> (x & 7)) ? onW : offW;
      for (let dy = 0; dy < dot; dy++) {
        const row = (y * s + dy) * w + x * s;
        for (let dx = 0; dx < dot; dx++) data[row + dx] = c;
      }
    }
  }
  return { width: w, height: h, data };
}
