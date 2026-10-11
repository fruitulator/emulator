export interface CropView {
  w: number; h: number;
  view: number;
  scale: number;
  x: number; y: number;
  out: number;
}

export const fitScale = (w: number, h: number, view: number): number => view / Math.min(w, h);

export const zoomTop = (w: number, h: number, out: number): number => Math.min(10, Math.max(4, Math.min(w, h) / out));

export const minScale = (v: CropView): number => fitScale(v.w, v.h, v.view);
export const maxScale = (v: CropView): number => minScale(v) * zoomTop(v.w, v.h, v.out);

export function fitView(w: number, h: number, view: number, out: number): CropView {
  const scale = fitScale(w, h, view);
  return { w, h, view, scale, x: (view - w * scale) / 2, y: (view - h * scale) / 2, out };
}

export function clamp(v: CropView): CropView {
  const scale = Math.min(maxScale(v), Math.max(minScale(v), v.scale));
  const sw = v.w * scale;
  const sh = v.h * scale;
  return {
    ...v, scale,
    x: Math.min(0, Math.max(v.view - sw, v.x)),
    y: Math.min(0, Math.max(v.view - sh, v.y)),
  };
}

export const pan = (v: CropView, dx: number, dy: number): CropView => clamp({ ...v, x: v.x + dx, y: v.y + dy });

export function zoomTo(v: CropView, scale: number, cx: number, cy: number): CropView {
  const s = Math.min(maxScale(v), Math.max(minScale(v), scale));
  const k = s / v.scale;
  return clamp({ ...v, scale: s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
}

export const zoomBy = (v: CropView, factor: number, cx: number, cy: number): CropView => zoomTo(v, v.scale * factor, cx, cy);

export function zoomFraction(v: CropView): number {
  const lo = Math.log(minScale(v));
  const hi = Math.log(maxScale(v));
  return hi > lo ? Math.min(1, Math.max(0, (Math.log(v.scale) - lo) / (hi - lo))) : 0;
}

export function scaleAt(v: CropView, t: number): number {
  const lo = minScale(v);
  return lo * Math.pow(maxScale(v) / lo, Math.min(1, Math.max(0, t)));
}

export function resize(v: CropView, view: number): CropView {
  if (!(view > 0) || view === v.view) return v;
  const k = view / v.view;
  return clamp({ ...v, view, scale: v.scale * k, x: v.x * k, y: v.y * k });
}

export function region(v: CropView): { sx: number; sy: number; side: number } {
  return { sx: -v.x / v.scale + 0, sy: -v.y / v.scale + 0, side: v.view / v.scale };
}
