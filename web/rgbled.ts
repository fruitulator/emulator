import { argbToCss } from './vfd';

export interface RgbLedShape {
  left: number; top: number; width: number; height: number;
  style: number; noOutline: boolean; noShadow: boolean;
}

export function rgbLedUnits(width: number): { unit: number; pen: number } {
  const unit = Math.min(6, Math.max(1, Math.trunc(width / 17)));
  return { unit, pen: Math.max(1, unit >> 1) };
}

export function paintRgbLed(
  ctx: CanvasRenderingContext2D, led: RgbLedShape, colour: number, lit: boolean,
): void {
  const css = argbToCss(colour);
  const { unit: u, pen } = rgbLedUnits(led.width);
  const W = led.width, H = led.height, X = led.left, Y = led.top;
  const px = (x: number, y: number, w: number, h: number, fill: string): void => {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = fill;
    ctx.fillRect(X + x, Y + y, w, h);
  };
  const polyline = (pts: [number, number][], fill: string): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      if (y0 === y1) {
        const a = Math.min(x0, x1 + (x1 > x0 ? -1 : 1)), b = Math.max(x0, x1 + (x1 > x0 ? -1 : 1));
        px(a, y0, b - a + 1, 1, fill);
      } else {
        const a = Math.min(y0, y1 + (y1 > y0 ? -1 : 1)), b = Math.max(y0, y1 + (y1 > y0 ? -1 : 1));
        px(x0, a, 1, b - a + 1, fill);
      }
    }
  };
  const fillRect = (l: number, t: number, r: number, b: number, fill: string): void =>
    px(Math.min(l, r), Math.min(t, b), Math.abs(r - l), Math.abs(b - t), fill);

  if (led.style === 2) {
    if (!led.noOutline) fillRect(0, 0, W, H, '#000000');
    fillRect(u, u, W - u, H - u, css);
    return;
  }

  if (led.style === 1) {
    px(u - 1, u - 1, W - u, H - u, css);
    polyline([[u - 1, u - 1], [W - 1, u - 1], [W - 1, H - 1], [u - 1, H - 1], [u - 1, u - 1]], '#000000');
    polyline([[3 * u - 1, 3 * u - 1], [W - 1 - 2 * u, 3 * u - 1], [W - 1 - 2 * u, H - 1 - 2 * u],
      [3 * u - 1, H - 1 - 2 * u], [3 * u - 1, 3 * u - 1]], '#000000');
    polyline([[2 * u - 1, H - u - 1], [2 * u - 1, 2 * u - 1], [W - 2 * u + 1, 2 * u - 1]], '#C0C0C0');
    polyline([[W - u - 1, 3 * u - 1], [W - u - 1, H - u - 1], [2 * u - 1, H - u - 1]], '#808080');
    fillRect(W - 4 * u, H - 4 * u, W - 6 * u, H - 5 * u, '#808080');
    fillRect(W - 7 * u, H - 4 * u, W - 9 * u, H - 5 * u, '#808080');
    fillRect(4 * u, 4 * u, 6 * u, 5 * u, '#FFFFFF');
    fillRect(7 * u, 4 * u, 9 * u, 5 * u, '#C0C0C0');
    return;
  }

  const cx = X + W / 2, cy = Y + H / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0, W / 2), Math.max(0, H / 2), 0, 0, Math.PI * 2);
  ctx.fillStyle = css;
  ctx.fill();
  if (!led.noOutline) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = lit || led.noShadow ? 1 : pen;
    ctx.stroke();
  }
  if (led.noShadow) return;
  const ax0 = 4 * u, ay0 = 4 * u, ax1 = W - 4 * u, ay1 = H - 4 * u;
  const rx = (ax1 - ax0) / 2, ry = (ay1 - ay0) / 2;
  if (rx <= 0 || ry <= 0) return;
  const ex = X + (ax0 + ax1) / 2, ey = Y + (ay0 + ay1) / 2;
  const angle = (x: number, y: number): number =>
    Math.atan2((Y + y - ey) / ry, (X + x - ex) / rx);
  const arc = (sx: number, sy: number, fx: number, fy: number, stroke: string): void => {
    ctx.beginPath();
    ctx.ellipse(ex, ey, rx, ry, 0, angle(sx, sy), angle(fx, fy), true);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = pen;
    ctx.stroke();
  };
  arc(W - 4 * u, H - 2 * u, W - 4 * u, H - 9 * u, '#808080');
  arc(8 * u, 0, 7 * u, 9 * u, '#FFFFFF');
  arc(8 * u, 0, 7 * u, 8 * u, '#C0C0C0');
}
