
export interface CeilingRoom { W: number; D: number; cx: number; cz: number }

export const TILE_M = 0.6;
export const DARK_PANEL_M = 1.2;
export const BEAM_W = 0.18;
export const BEAM_D = 0.24;
export const BEAM_EVERY_M = 1.1;
export const PLATE_M = 0.15;
export const COFFER_M = 1.1;
export const BAND_M = 0.3;

export function tileGrid(r: CeilingRoom): { nx: number; nz: number; x0: number; z0: number } {
  const nx = Math.floor(r.W / TILE_M), nz = Math.floor(r.D / TILE_M);
  return { nx, nz, x0: r.cx - (nx * TILE_M) / 2, z0: r.cz - (nz * TILE_M) / 2 };
}

export function beamLayout(r: CeilingRoom): { acrossX: boolean; at: number[] } {
  const acrossX = r.W <= r.D;
  const run = acrossX ? r.D : r.W;
  const min = acrossX ? r.cz - r.D / 2 : r.cx - r.W / 2;
  const n = Math.max(1, Math.round(run / BEAM_EVERY_M));
  return { acrossX, at: Array.from({ length: n }, (_, i) => min + (run * (i + 0.5)) / n) };
}

export function cofferLayout(r: CeilingRoom): { ix0: number; iz0: number; ix1: number; iz1: number; nx: number; nz: number; px: number; pz: number } {
  const ix0 = r.cx - r.W / 2 + BAND_M, ix1 = r.cx + r.W / 2 - BAND_M;
  const iz0 = r.cz - r.D / 2 + BAND_M, iz1 = r.cz + r.D / 2 - BAND_M;
  const nx = Math.max(1, Math.round((ix1 - ix0) / COFFER_M)), nz = Math.max(1, Math.round((iz1 - iz0) / COFFER_M));
  return { ix0, iz0, ix1, iz1, nx, nz, px: (ix1 - ix0) / nx, pz: (iz1 - iz0) / nz };
}
