import { type CropView, fitView, pan, region, resize, scaleAt, zoomBy, zoomFraction, zoomTo } from './cropgeom';

export interface Cropper {
  view: HTMLElement;
  slider: HTMLInputElement;
  render(size: number, fill?: string): HTMLCanvasElement;
  destroy(): void;
}

export interface CropperOptions {
  out: number;
  zoomLabel: string;
  round?: boolean;
}

const SLIDER_MAX = 1000;

export async function openCropper(file: Blob, o: CropperOptions): Promise<Cropper> {
  const bmp = await createImageBitmap(file);
  if (!bmp.width || !bmp.height) { bmp.close(); throw new Error('the picture is empty'); }

  const view = document.createElement('div');
  view.className = o.round ? 'ui-crop ui-crop-round' : 'ui-crop';
  view.tabIndex = 0;
  const canvas = document.createElement('canvas');
  const mask = document.createElement('div');
  mask.className = 'ui-crop-mask';
  view.append(canvas, mask);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'ui-crop-zoom';
  slider.min = '0';
  slider.max = String(SLIDER_MAX);
  slider.step = '1';
  slider.value = '0';
  slider.setAttribute('aria-label', o.zoomLabel);

  let v: CropView = fitView(bmp.width, bmp.height, 300, o.out);
  let frame = 0;
  const draw = (): void => {
    frame = 0;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const side = Math.max(1, Math.round(v.view * dpr));
    if (canvas.width !== side || canvas.height !== side) { canvas.width = side; canvas.height = side; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, side, side);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, v.x * dpr, v.y * dpr, v.w * v.scale * dpr, v.h * v.scale * dpr);
    slider.value = String(Math.round(zoomFraction(v) * SLIDER_MAX));
  };
  const update = (next: CropView): void => {
    v = next;
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const measure = (): void => {
    const side = view.clientWidth;
    if (side > 0 && side !== v.view) update(resize(v, side));
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
  ro?.observe(view);
  measure();
  update(v);

  const pointers = new Map<number, { x: number; y: number }>();
  const local = (e: PointerEvent): { x: number; y: number } => {
    const r = view.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    view.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    view.classList.add('dragging');
  };
  const onMove = (e: PointerEvent): void => {
    const was = pointers.get(e.pointerId);
    if (!was) return;
    const now = local(e);
    if (pointers.size === 1) {
      update(pan(v, now.x - was.x, now.y - was.y));
    } else {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(was.x - other.x, was.y - other.y) || 1;
      const d1 = Math.hypot(now.x - other.x, now.y - other.y) || 1;
      const c0 = { x: (was.x + other.x) / 2, y: (was.y + other.y) / 2 };
      const c1 = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
      update(pan(zoomBy(v, d1 / d0, c0.x, c0.y), c1.x - c0.x, c1.y - c0.y));
    }
    pointers.set(e.pointerId, now);
  };
  const onUp = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (!pointers.size) view.classList.remove('dragging');
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const step = e.deltaMode === 1 ? 0.06 : e.deltaMode === 2 ? 0.6 : 0.0018;
    const p = local(e as unknown as PointerEvent);
    update(zoomBy(v, Math.exp(-e.deltaY * step), p.x, p.y));
  };
  const onKey = (e: KeyboardEvent): void => {
    const c = v.view / 2;
    let next: CropView | null = null;
    switch (e.key) {
      case 'ArrowLeft': next = pan(v, -10, 0); break;
      case 'ArrowRight': next = pan(v, 10, 0); break;
      case 'ArrowUp': next = pan(v, 0, -10); break;
      case 'ArrowDown': next = pan(v, 0, 10); break;
      case '+': case '=': next = zoomBy(v, 1.15, c, c); break;
      case '-': case '_': next = zoomBy(v, 1 / 1.15, c, c); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    update(next);
  };
  const onSlide = (): void => {
    const c = v.view / 2;
    update(zoomTo(v, scaleAt(v, Number(slider.value) / SLIDER_MAX), c, c));
  };
  const onSliderKey = (e: KeyboardEvent): void => { if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation(); };
  view.addEventListener('pointerdown', onDown);
  view.addEventListener('pointermove', onMove);
  view.addEventListener('pointerup', onUp);
  view.addEventListener('pointercancel', onUp);
  view.addEventListener('wheel', onWheel, { passive: false });
  view.addEventListener('keydown', onKey);
  slider.addEventListener('input', onSlide);
  slider.addEventListener('keydown', onSliderKey);

  return {
    view, slider,
    render(size, fill) {
      const out = document.createElement('canvas');
      out.width = size;
      out.height = size;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, size, size); }
      ctx.imageSmoothingQuality = 'high';
      const r = region(v);
      ctx.drawImage(bmp, r.sx, r.sy, r.side, r.side, 0, 0, size, size);
      return out;
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      ro?.disconnect();
      view.remove();
      slider.remove();
      bmp.close();
    },
  };
}
