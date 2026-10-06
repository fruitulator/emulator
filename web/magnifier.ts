
import { layoutPoint, type CanvasFit } from './cabhit';

export const MAG_MIN = 1.5;
export const MAG_MAX = 6;
export const MAG_DEFAULT = 2.5;

export const LENS_RADIUS = 90;

export const POP_MS = 180;

export const MAGNIFIER_ZOOM_STORE = 'fruitulator.magnifierZoom';

export const HOVER_POINTER_QUERY = '(any-hover: hover) and (any-pointer: fine)';

export function hasHoverPointer(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(HOVER_POINTER_QUERY).matches;
  } catch {
    return true;
  }
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function clampMagnification(z: number): number {
  if (Number.isNaN(z)) return MAG_DEFAULT;
  return Math.min(MAG_MAX, Math.max(MAG_MIN, z));
}

export function storedMagnification(): number {
  try {
    const raw = store()?.getItem(MAGNIFIER_ZOOM_STORE);
    if (raw === null || raw === undefined) return MAG_DEFAULT;
    const trimmed = raw.trim();
    if (trimmed === '') return MAG_DEFAULT;
    const n = Number(trimmed);
    return Number.isFinite(n) ? clampMagnification(n) : MAG_DEFAULT;
  } catch {
    return MAG_DEFAULT;
  }
}

let magnification = storedMagnification();

export function magnifierZoom(): number {
  return magnification;
}

export function setMagnifierZoom(z: number): void {
  magnification = clampMagnification(z);
  try {
    store()?.setItem(MAGNIFIER_ZOOM_STORE, String(magnification));
  } catch {
  }
}

export function reloadMagnifierZoom(): void {
  magnification = storedMagnification();
}

export const WHEEL_ZOOM_K = 0.0012;

export const WHEEL_DETENT = 2 * 120 * WHEEL_ZOOM_K;

export function wheelPixels(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY)) return 0;
  if (deltaMode === 1) return deltaY * 40;
  if (deltaMode === 2) return deltaY * 800;
  return deltaY;
}

export interface WheelResult {
  readonly on: boolean;
  readonly zoom: number;
  readonly travel: number;
  readonly handled: boolean;
}

export function wheelStep(
  on: boolean,
  zoom: number,
  travel: number,
  pixels: number,
): WheelResult {
  const step = -pixels * WHEEL_ZOOM_K;
  if (!Number.isFinite(step) || step === 0) {
    return { on, zoom: clampMagnification(zoom), travel, handled: false };
  }
  const carried = Number.isFinite(travel) ? travel : 0;

  if (!on) {
    if (step < 0) return { on, zoom: clampMagnification(zoom), travel: 0, handled: false };
    const t = Math.max(0, carried) + step;
    if (t >= WHEEL_DETENT) return { on: true, zoom: MAG_MIN, travel: 0, handled: true };
    return { on: false, zoom: clampMagnification(zoom), travel: t, handled: true };
  }

  const next = clampMagnification(zoom) * Math.exp(step);
  if (next >= MAG_MIN) return { on: true, zoom: clampMagnification(next), travel: 0, handled: true };
  const t = Math.min(0, carried) + Math.log(next / MAG_MIN);
  if (t <= -WHEEL_DETENT) return { on: false, zoom: MAG_MIN, travel: 0, handled: true };
  return { on: true, zoom: MAG_MIN, travel: t, handled: true };
}

export interface LensSource {
  readonly sx: number;
  readonly sy: number;
  readonly size: number;
  readonly scale: number;
}

export function lensSource(
  fit: CanvasFit,
  clientX: number,
  clientY: number,
  radius: number,
  magnificationAt: number,
): LensSource {
  const { x, y, scale } = layoutPoint(fit, clientX, clientY);
  const size = (2 * radius) / (scale * magnificationAt);
  return {
    sx: x - fit.content.left - size / 2,
    sy: y - fit.content.top - size / 2,
    size,
    scale,
  };
}

export interface LensSubject {
  readonly canvas: HTMLCanvasElement;
  readonly screen: HTMLCanvasElement;
  readonly content: { readonly left: number; readonly top: number } | null;
}

export class Magnifier {
  readonly el: HTMLCanvasElement;
  private readonly lensCtx: CanvasRenderingContext2D;
  private on = false;
  private at: { x: number; y: number } | null = null;
  private backing = 0;
  private popping: Animation | null = null;

  constructor(
    private readonly stage: HTMLElement,
    private readonly subject: LensSubject,
    private readonly reducedMotion: () => boolean = () => false,
  ) {
    this.el = document.createElement('canvas');
    this.el.id = 'lens';
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
    this.lensCtx = this.el.getContext('2d')!;
    stage.append(this.el);
  }

  get active(): boolean {
    return this.on;
  }

  setActive(next: boolean): void {
    if (next === this.on) return;
    this.on = next;
    if (next) {
      this.popping?.cancel();
      this.popping = null;
      return;
    }
    this.pop();
  }

  private pop(): void {
    this.popping?.cancel();
    this.popping = null;
    if (this.el.hidden || this.reducedMotion() || typeof this.el.animate !== 'function') {
      this.hide();
      return;
    }
    const base = this.el.style.transform;
    const anim = this.el.animate([
      { transform: `${base} scale(1)`, opacity: 1, easing: 'cubic-bezier(0.2, 0, 0.2, 1)' },
      { transform: `${base} scale(1.14)`, opacity: 1, offset: 0.4, easing: 'cubic-bezier(0.6, 0, 0.9, 0.4)' },
      { transform: `${base} scale(0.18)`, opacity: 0 },
    ], { duration: POP_MS, fill: 'forwards' });
    this.popping = anim;
    anim.onfinish = () => {
      if (this.popping !== anim) return;
      this.popping = null;
      this.hide();
      anim.cancel();
    };
    anim.oncancel = () => { if (this.popping === anim) this.popping = null; };
  }

  moveTo(clientX: number, clientY: number): void {
    this.at = { x: clientX, y: clientY };
  }

  hide(): void {
    this.at = null;
    if (this.popping) return;
    if (!this.el.hidden) this.el.hidden = true;
  }

  present(): void {
    const { canvas, screen, content } = this.subject;
    if (!this.on || !this.at || !content || this.stage.hidden) {
      this.hide();
      return;
    }
    const rect = screen.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
      this.hide();
      return;
    }
    const R = LENS_RADIUS;
    const { sx, sy, size } = lensSource(
      { rect, canvas: { width: canvas.width, height: canvas.height }, content },
      this.at.x, this.at.y, R, magnification,
    );

    const dpr = window.devicePixelRatio || 1;
    const backing = Math.round(2 * R * dpr);
    if (this.backing !== backing) {
      this.backing = backing;
      this.el.width = backing;
      this.el.height = backing;
      this.el.style.width = `${2 * R}px`;
      this.el.style.height = `${2 * R}px`;
    }

    const c = this.lensCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.save();
    c.beginPath();
    c.arc(R, R, R, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#0a0a0a';
    c.fillRect(0, 0, 2 * R, 2 * R);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(canvas, sx, sy, size, size, 0, 0, 2 * R, 2 * R);
    c.restore();

    c.beginPath();
    c.arc(R, R, R - 0.75, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    c.lineWidth = 1.5;
    c.stroke();

    const box = this.stage.getBoundingClientRect();
    const left = this.at.x - box.left - R;
    const top = this.at.y - box.top - R;
    this.el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    if (this.el.hidden) this.el.hidden = false;
  }
}
