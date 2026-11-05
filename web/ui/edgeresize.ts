
export const EDGE_RESIZE_MIN_WINDOW = 600;
export const EDGE_RESIZE_MIN = 480;
export const EDGE_RESIZE_MARGIN = 24;
export const EDGE_RESIZE_STEP = 40;

export function edgeMax(windowWidth: number, defaultWidth: number): number {
  return Math.max(EDGE_RESIZE_MIN, Math.min(defaultWidth, windowWidth - EDGE_RESIZE_MARGIN));
}

export function edgeClamp(width: number, windowWidth: number, defaultWidth: number): number {
  return Math.min(edgeMax(windowWidth, defaultWidth), Math.max(EDGE_RESIZE_MIN, width));
}

export function parseEdgeWidth(stored: string | null): number | null {
  if (!stored) return null;
  const n = Number(stored);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface EdgeResizeOptions {
  storeKey: string;
  defaultWidth: number;
  label: string;
  onWidth(width: number | null, animate: boolean): void;
}

export class EdgeResize {
  readonly handle: HTMLDivElement;
  private wanted: number;

  constructor(private readonly opts: EdgeResizeOptions) {
    let stored: number | null = null;
    try {
      stored = parseEdgeWidth(localStorage.getItem(opts.storeKey));
    } catch {  }
    this.wanted = stored ?? opts.defaultWidth;

    const h = document.createElement('div');
    this.handle = h;
    h.className = 'edge-resize';
    h.tabIndex = 0;
    h.setAttribute('role', 'separator');
    h.setAttribute('aria-orientation', 'vertical');
    h.setAttribute('aria-label', opts.label);
    h.setAttribute('aria-valuemin', String(EDGE_RESIZE_MIN));

    let drag: { id: number; x: number; from: number } | null = null;
    h.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      h.setPointerCapture(ev.pointerId);
      h.classList.add('dragging');
      drag = { id: ev.pointerId, x: ev.clientX, from: this.width };
    });
    h.addEventListener('pointermove', (ev) => {
      if (drag?.id !== ev.pointerId) return;
      this.set(drag.from + drag.x - ev.clientX);
    });
    const end = (ev: PointerEvent): void => {
      if (drag?.id !== ev.pointerId) return;
      drag = null;
      h.classList.remove('dragging');
      this.store();
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
    h.addEventListener('dblclick', () => {
      this.wanted = opts.defaultWidth;
      this.store();
      this.apply(true);
    });
    h.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      ev.stopPropagation();
      this.set(this.width + (ev.key === 'ArrowLeft' ? EDGE_RESIZE_STEP : -EDGE_RESIZE_STEP));
      this.store();
    });
    window.addEventListener('resize', () => this.apply(false));
  }

  sync(): void {
    this.apply(false);
  }

  get width(): number {
    return edgeClamp(this.wanted, window.innerWidth, this.opts.defaultWidth);
  }

  get narrowed(): boolean {
    return window.innerWidth >= EDGE_RESIZE_MIN_WINDOW
      && this.width < edgeMax(window.innerWidth, this.opts.defaultWidth);
  }

  private set(width: number): void {
    this.wanted = edgeClamp(width, window.innerWidth, this.opts.defaultWidth);
    this.apply(false);
  }

  private store(): void {
    try {
      localStorage.setItem(this.opts.storeKey, String(this.wanted));
    } catch {  }
  }

  private apply(animate: boolean): void {
    if (window.innerWidth < EDGE_RESIZE_MIN_WINDOW) {
      this.opts.onWidth(null, false);
      return;
    }
    const w = this.width;
    this.handle.setAttribute('aria-valuemax', String(edgeMax(window.innerWidth, this.opts.defaultWidth)));
    this.handle.setAttribute('aria-valuenow', String(w));
    this.opts.onWidth(w, animate);
  }
}
