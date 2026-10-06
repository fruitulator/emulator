
const MASK_BELOW = 100;

export function alphaMaskAndColour(img: ImageData, ink: number): void {
  const r = (ink >>> 16) & 0xff;
  const g = (ink >>> 8) & 0xff;
  const b = ink & 0xff;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < MASK_BELOW && d[i + 1] < MASK_BELOW && d[i + 2] < MASK_BELOW) {
      d[i + 3] = 0;
      continue;
    }
    if (d[i] === 0xff && d[i + 1] === 0xff && d[i + 2] === 0xff) {
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 0xff;
    }
  }
}

export function alphaGenerateOff(
  atlas: ImageData,
  glyphW: number,
  offBrightness: number,
  make: (w: number, h: number) => ImageData,
): ImageData | null {
  const x0 = glyphW * 0x1f;
  if (glyphW <= 0 || x0 + glyphW > atlas.width) return null;
  const out = make(glyphW, atlas.height);
  const a = Math.max(0, Math.min(255, offBrightness));
  for (let y = 0; y < atlas.height; y++) {
    for (let x = 0; x < glyphW; x++) {
      const s = (y * atlas.width + x0 + x) * 4;
      const t = (y * glyphW + x) * 4;
      if (atlas.data[s] || atlas.data[s + 1] || atlas.data[s + 2]) {
        out.data[t] = 0xff; out.data[t + 1] = 0xff; out.data[t + 2] = 0xff;
        out.data[t + 3] = a;
      }
    }
  }
  return out;
}

export const ALPHA_DEFAULT_INK = 0xff00ff00;
export const ALPHA_DEFAULT_OFF_BRIGHTNESS = 80;

export function atlasGlyph(code: number): number {
  if (code < 0x20 || code > 0x5f) return -1;
  return (code - 0x41 + 64) % 64;
}

const ALPHA_INTENSITY = [
  15, 39, 70, 95, 110, 125, 135, 145, 169, 175, 181, 187, 193, 198, 203, 208,
  213, 218, 222, 226, 230, 234, 237, 240, 243, 246, 248, 250, 252, 253, 254, 255,
];

export function alphaAtlasIntensity(duty: number): number {
  return ALPHA_INTENSITY[Math.max(0, Math.min(31, Math.trunc(duty)))] / 255;
}
