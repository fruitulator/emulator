export function multiplyImage(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, dx: number, dy: number, dw?: number, dh?: number): void;
export function multiplyImage(
  ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number },
  sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number,
): void;
export function multiplyImage(
  ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number },
  a: number, b: number, c?: number, d?: number, e?: number, f?: number, g?: number, h?: number,
): void {
  let sx = 0, sy = 0, sw = img.width, sh = img.height, dx = a, dy = b, dw = img.width, dh = img.height;
  if (e !== undefined && f !== undefined && g !== undefined && h !== undefined) {
    sx = a; sy = b; sw = c!; sh = d!; dx = e; dy = f; dw = g; dh = h;
  } else if (c !== undefined && d !== undefined) {
    dw = c; dh = d;
  }
  if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return;
  const pattern = ctx.createPattern(img, 'no-repeat');
  if (!pattern) return;
  const kx = dw / sw, ky = dh / sh;
  pattern.setTransform(new DOMMatrix([kx, 0, 0, ky, dx - sx * kx, dy - sy * ky]));
  const op = ctx.globalCompositeOperation;
  const fill = ctx.fillStyle;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = pattern;
  ctx.fillRect(dx, dy, dw, dh);
  ctx.fillStyle = fill;
  ctx.globalCompositeOperation = op;
}
