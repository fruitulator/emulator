export const VIEW_RADIUS_M = 20;
export const VIEW_DISTANCE_M: Partial<Record<string, number>> = {
  oldtown: 15,
  carpark: 11,
  harbour: 48,
  square: 60,
};
export interface ViewLayer {
  texture: string;
  distance: number;
  crop: { topDeg: number };
}
export const VIEW_LAYERS: Partial<Record<string, { layers: ViewLayer[] }>> = {
  harbour: { layers: [{ texture: 'harbour-near.webp', distance: 3.5, crop: { topDeg: -5.36 } }] },
};
export const VIEW_ARC_DEG = 180;
export const VIEW_ELEV_DEG = 45;
export const VIEW_REACH_DEG = 72;
export const VIEW_HORIZON_Y = 1.6;
export const VIEW_LEVEL = 0.6;
export const VIEW_EXTERIOR: Partial<Record<string, 'brick' | 'render'>> = {
  square: 'brick', oldtown: 'brick', carpark: 'render', harbour: 'render',
};
export const VIEW_EXTERIOR_LEVEL = 0.16;
export const VIEW_CONTRAST = 0.88;
export const VIEW_MID = 0.04;
export const VIEW_HAZE = 0.07;
export const VIEW_MIP_BIAS = 0;

export function viewBackdrop(
  radius = VIEW_RADIUS_M, arcDeg = VIEW_ARC_DEG, elevDeg = VIEW_ELEV_DEG, reachDeg = VIEW_REACH_DEG,
  cols = 48, rows = 24, topDeg?: number,
): { position: Float32Array; uv: Float32Array; index: Uint32Array } {
  const rad = Math.PI / 180;
  const position = new Float32Array((cols + 1) * (rows + 1) * 3);
  const uv = new Float32Array((cols + 1) * (rows + 1) * 2);
  const hi = topDeg ?? reachDeg;
  const vTop = topDeg ?? elevDeg;
  let p = 0, q = 0;
  for (let j = 0; j <= rows; j++) {
    const elev = -reachDeg + ((hi + reachDeg) * j) / rows;
    const y = radius * Math.tan(elev * rad);
    const v = Math.min(1, Math.max(0, (elev + elevDeg) / (vTop + elevDeg)));
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const a = (u - 0.5) * arcDeg * rad;
      position[p++] = radius * Math.sin(a);
      position[p++] = y;
      position[p++] = -radius * Math.cos(a);
      uv[q++] = u;
      uv[q++] = v;
    }
  }
  const index = new Uint32Array(cols * rows * 6);
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, d = a + cols + 1, c = d + 1;
      index.set([a, b, d, b, c, d], k);
      k += 6;
    }
  }
  return { position, uv, index };
}
