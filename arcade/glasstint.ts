import * as THREE from 'three';

export const TINT_PX = 16;
const EASE_S = 0.35;
const GREY_WEIGHT = 0.04;
const SAT_BOOST = 1.6;
const LIFT = 1.2;

export function tintOf(px: ArrayLike<number>): [number, number, number] {
  let r = 0, g = 0, b = 0, w = 0, lum = 0, n = 0;
  for (let i = 0; i + 3 < px.length; i += 4) {
    const a = px[i + 3] / 255;
    const pr = (px[i] / 255) * a, pg = (px[i + 1] / 255) * a, pb = (px[i + 2] / 255) * a;
    const hi = Math.max(pr, pg, pb), lo = Math.min(pr, pg, pb);
    const sat = hi > 0 ? (hi - lo) / hi : 0;
    const k = sat * sat * hi * hi + GREY_WEIGHT * hi;
    r += pr * k; g += pg * k; b += pb * k; w += k;
    lum += hi;
    n++;
  }
  if (!n || w <= 0) return [0, 0, 0];
  const mean = [r / w, g / w, b / w];
  const top = Math.max(...mean);
  if (top <= 0) return [0, 0, 0];
  const v = Math.min(1, LIFT * Math.sqrt(lum / n));
  return mean.map((c) => Math.round(Math.max(0, top - (top - c) * SAT_BOOST) / top * v * 255)) as [number, number, number];
}

let sampler: CanvasRenderingContext2D | null = null;

export class GlassTint {
  readonly texture: THREE.DataTexture;
  private readonly data = new Uint8Array([0, 0, 0, 255]);
  private target: [number, number, number] = [0, 0, 0];
  private shown: [number, number, number] = [0, 0, 0];
  paint = '';
  at = -Infinity;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, 1, 1, THREE.RGBAFormat);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  read(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, now: number): boolean {
    this.at = now;
    if (!(sw > 0 && sh > 0)) return false;
    if (!sampler) {
      const c = document.createElement('canvas');
      c.width = c.height = TINT_PX;
      sampler = c.getContext('2d', { willReadFrequently: true });
      if (!sampler) return false;
      sampler.imageSmoothingEnabled = true;
      sampler.imageSmoothingQuality = 'medium';
    }
    try {
      sampler.clearRect(0, 0, TINT_PX, TINT_PX);
      sampler.drawImage(src, sx, sy, sw, sh, 0, 0, TINT_PX, TINT_PX);
      this.target = tintOf(sampler.getImageData(0, 0, TINT_PX, TINT_PX).data);
      return true;
    } catch {
      return false;
    }
  }

  tick(dt: number): void {
    const k = 1 - Math.exp(-Math.max(0, dt) / EASE_S);
    let changed = false;
    for (let i = 0; i < 3; i++) {
      this.shown[i] += (this.target[i] - this.shown[i]) * k;
      const byte = Math.round(this.shown[i]);
      if (byte !== this.data[i]) { this.data[i] = byte; changed = true; }
    }
    if (changed) this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
