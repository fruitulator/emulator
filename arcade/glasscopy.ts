import * as THREE from 'three';

const COPY_PX = 256;

export class GlassCopy {
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  at = -Infinity;
  paint = '';
  dirty = true;

  constructor() {
    this.canvas.width = this.canvas.height = COPY_PX;
    this.g = this.canvas.getContext('2d')!;
    this.g.imageSmoothingQuality = 'low';
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  copy(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, now: number): void {
    this.g.drawImage(src, sx, sy, sw, sh, 0, 0, COPY_PX, COPY_PX);
    this.texture.needsUpdate = true;
    this.at = now;
    this.dirty = false;
  }

  dispose(): void { this.texture.dispose(); }
}
