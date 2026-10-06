
export const UNROTATED_TYPES: ReadonlySet<number> = new Set([0x01, 0x06, 0x1b, 0x1f, 0x23, 0x28, 0x2f]);

export function drawnAngle(type: number, angle: number): number | undefined {
  if (!Number.isFinite(angle) || angle % 360 === 0 || UNROTATED_TYPES.has(type)) return undefined;
  return angle;
}

interface Box { left: number; top: number; width: number; height: number }

export function angledExtent<R extends Box>(r: R, angle: number | undefined): Box {
  if (!angle) return { left: r.left, top: r.top, width: r.width, height: r.height };
  const rad = (angle * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  const w = Math.max(r.width, r.width * c + r.height * s);
  const h = Math.max(r.height, r.width * s + r.height * c);
  return { left: r.left - (w - r.width) / 2, top: r.top - (h - r.height) / 2, width: w, height: h };
}

interface Turnable {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(rad: number): void;
}

export function withAngle(ctx: Turnable, r: Box, angle: number | undefined, paint: () => void): void {
  if (!angle) { paint(); return; }
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  try { paint(); } finally { ctx.restore(); }
}
