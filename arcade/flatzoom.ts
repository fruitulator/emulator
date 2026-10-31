import type { PlayPointer } from '../web/play/pointer';

export const ZOOM_MAX = 8;
export const ZOOM_PER_UNIT = 0.0025;

export const clampZoom = (z: number): number => Math.max(1, Math.min(ZOOM_MAX, z));

export const panAbout = (pan: number, at: number, ratio: number): number => at - (at - pan) * ratio;

export function clampPan(pan: number, size: number, view: number): number {
  const most = Math.max(0, (size - view) / 2);
  return Math.max(-most, Math.min(most, pan));
}

export class FlatZoom {
  zoom = 1;
  private x = 0;
  private y = 0;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pan: { x: number; y: number; px: number; py: number } | null = null;
  private pinch: { d: number; zoom: number } | null = null;

  constructor(
    private readonly view: HTMLElement,
    private readonly pic: HTMLElement,
    private readonly canvas: HTMLElement,
    private readonly caps: PlayPointer<unknown>,
  ) {
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.moved(e));
    canvas.addEventListener('pointerup', (e) => this.end(e));
    canvas.addEventListener('pointercancel', (e) => this.end(e));
    canvas.addEventListener('lostpointercapture', (e) => this.end(e));
    view.addEventListener('wheel', (e) => {
      if (view.firstElementChild !== pic) return;
      e.preventDefault();
      const units = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      this.zoomTo(this.zoom * Math.exp(-units * ZOOM_PER_UNIT), e.clientX, e.clientY);
    }, { passive: false });
  }

  place(w: number, h: number, vw: number, vh: number): void {
    this.x = clampPan(this.x, w, vw);
    this.y = clampPan(this.y, h, vh);
    const t = this.x || this.y ? `translate(${this.x}px, ${this.y}px)` : '';
    if (this.pic.style.transform !== t) this.pic.style.transform = t;
  }

  private zoomTo(z: number, cx: number, cy: number): void {
    const next = clampZoom(z);
    if (next === this.zoom) return;
    const r = this.view.getBoundingClientRect();
    const ratio = next / this.zoom;
    this.x = panAbout(this.x, cx - (r.left + r.width / 2), ratio);
    this.y = panAbout(this.y, cy - (r.top + r.height / 2), ratio);
    this.zoom = next;
    this.pic.classList.toggle('wiz-zoomed', next > 1);
  }

  private spread(): { d: number; x: number; y: number } {
    const [a, b] = [...this.touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private startPan(p: { x: number; y: number }): void {
    this.pan = { x: p.x, y: p.y, px: this.x, py: this.y };
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && this.zoom === 1) { this.caps.down(e); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      this.caps.drop();
      this.pan = null;
      this.pinch = { d: this.spread().d, zoom: this.zoom };
    } else if (this.touches.size === 1) {
      this.startPan({ x: e.clientX, y: e.clientY });
      this.caps.begin(e);
    }
  }

  private moved(e: PointerEvent): void {
    if (!this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.caps.move(e) === 'held') return;
    if (this.pinch && this.touches.size >= 2) {
      const s = this.spread();
      this.zoomTo(this.pinch.zoom * (s.d / this.pinch.d), s.x, s.y);
      return;
    }
    if (!this.pan) return;
    this.x = this.pan.px + e.clientX - this.pan.x;
    this.y = this.pan.py + e.clientY - this.pan.y;
  }

  private end(e: PointerEvent): void {
    this.caps.up(e);
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    const rest = [...this.touches.values()][0];
    if (rest) this.startPan(rest); else this.pan = null;
  }
}
