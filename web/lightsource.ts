
export function lightCombine(f: number, b: number): number {
  return Math.min(255, (b * (f * 4 + 0xff)) >> 8);
}

export function lightDodgeLevel(f: number): number {
  return Math.round((255 * 4 * f) / (255 + 4 * f));
}

export function colorDodge(s: number, b: number): number {
  if (b === 0) return 0;
  if (s >= 255) return 255;
  return Math.min(255, Math.round((b * 255) / (255 - s)));
}

interface Pixels { width: number; height: number; data: Uint8ClampedArray }

function blendOnto(dst: Pixels, src: Pixels, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    const dy = oy + y;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = ox + x;
      if (dx < 0 || dx >= dst.width) continue;
      const si = (y * src.width + x) * 4, di = (dy * dst.width + dx) * 4;
      const a = src.data[si + 3];
      for (let k = 0; k < 3; k++) {
        dst.data[di + k] = Math.round((src.data[si + k] * a + dst.data[di + k] * (255 - a)) / 255);
      }
    }
  }
}

export function lightSourceFace<I extends Pixels>(
  width: number, height: number, picture: Pixels | null, overlay: Pixels | null,
  make: (w: number, h: number) => I,
): I {
  const out = make(width, height);
  const d = out.data;
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  if (picture) blendOnto(out, picture, 0, 0);
  if (overlay) blendOnto(out, overlay, 0, 0);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lightDodgeLevel(d[i]);
    d[i + 1] = lightDodgeLevel(d[i + 1]);
    d[i + 2] = lightDodgeLevel(d[i + 2]);
  }
  return out;
}

export function drawLightSource(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  r: { left: number; top: number; width: number; height: number },
  face: CanvasImageSource,
): void {
  const op = ctx.globalCompositeOperation;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.globalCompositeOperation = 'color-dodge';
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(face, r.left, r.top, r.width, r.height);
  ctx.globalCompositeOperation = op;
  ctx.imageSmoothingEnabled = smooth;
}
