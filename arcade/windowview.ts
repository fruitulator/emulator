
export const VIEW_DEPTH_M = 3;
export const VIEW_FIELD_DEG = 110;
export const VIEW_EYE_DEFAULT = { x: 0, y: 0, z: 3 };

export interface ViewParallax {
  repeat: [number, number];
  offset: [number, number];
}

export function viewParallax(
  eye: { x: number; y: number; z: number }, pane: { w: number; h: number }, aspect: number,
  depth = VIEW_DEPTH_M, fieldDeg = VIEW_FIELD_DEG,
): ViewParallax {
  const W = 2 * depth * Math.tan((fieldDeg * Math.PI) / 360);
  const H = W / aspect;
  let k = depth / Math.max(eye.z, 1e-3);
  k = Math.max(0, Math.min(k, Math.min(W / pane.w, H / pane.h) - 1));
  const ru = Math.min(1, (pane.w * (1 + k)) / W);
  const rv = Math.min(1, (pane.h * (1 + k)) / H);
  const slide = (r: number, e: number, span: number): number => {
    const centre = 0.5 - r / 2;
    const slack = (1 - r) / 2;
    if (slack <= 0) return 0;
    return centre + slack * Math.tanh((-k * e) / span / slack);
  };
  return { repeat: [ru, rv], offset: [slide(ru, eye.x, W), slide(rv, eye.y, H)] };
}
