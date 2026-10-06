
const PI = Math.PI;

export const MFME_BAND_SUPERSAMPLE = 4;

export function drumVisibleSymbols(
  rheight: number, bandHeight: number, stops: number,
): number {
  if (!(stops > 0)) return 0;
  const halfDrum = stops / 2;
  if (!(rheight > 0) || !(bandHeight > 0)) return halfDrum;
  const c = MFME_BAND_SUPERSAMPLE * bandHeight;
  const diameter = Math.fround(c / PI);
  const angle = Math.fround(rheight / diameter);
  const chord = Math.fround(Math.sin(angle) * diameter);
  if (!(chord > 0)) return halfDrum;
  const visible = Math.trunc(Math.fround(chord * 2)) / 100;
  return visible > halfDrum ? halfDrum : visible;
}

export function drumScreenRadius(innerH: number, visible: number, stops: number): number {
  const half = Math.sin((PI * visible) / stops);
  if (!(half > 0)) return Infinity;
  return Math.fround(innerH / 2 / half);
}

export function drumBandRowOffset(
  y: number, innerH: number, visible: number, stops: number,
): number {
  return drumRowMap(innerH, visible, stops)(y);
}

export function drumRowMap(
  innerH: number, visible: number, stops: number,
): (y: number) => number {
  const r = drumScreenRadius(innerH, visible, stops);
  if (!Number.isFinite(r)) return () => 0;
  const half = innerH / 2;
  const rowsPerRadian = stops / (2 * PI);
  return (y) => Math.asin(Math.max(-1, Math.min(1, (y - half) / r))) * rowsPerRadian;
}

export interface WrapPiece { d: number; dn: number; c: number; s: number; sn: number }

export function wrapPieces(
  d0: number, d1: number, u0: number, len: number, period: number, cell: number,
): WrapPiece[] {
  const out: WrapPiece[] = [];
  if (!(d1 > d0) || !(len > 0) || !(cell > 0) || !(period >= cell)) return out;
  const rate = len / (d1 - d0);
  const uAt = (x: number): number => u0 + (x - d0) * rate;
  const cells = Math.max(1, Math.round(period / cell));
  const j0 = Math.floor(u0 / cell);
  const jLast = Math.floor((u0 + len) / cell - 1e-9);
  let xs = d0;
  for (let j = j0; j <= jLast && xs < d1; j++) {
    const cellStart = j * cell;
    const cellEnd = cellStart + cell;
    const xe = j === jLast ? d1 : Math.max(xs, Math.min(d1, Math.round(d0 + (cellEnd - u0) / rate)));
    if (xe > xs) {
      const from = Math.max(cellStart, Math.min(cellEnd, uAt(xs)));
      const to = Math.max(cellStart, Math.min(cellEnd, uAt(xe)));
      out.push({ d: xs, dn: xe - xs, c: ((j % cells) + cells) % cells, s: from - cellStart, sn: to - from });
    }
    xs = xe;
  }
  return out;
}

export interface DrumBandPiece { sy: number; sh: number; dy: number; dh: number }

export function drumBandSlices(
  height: number, slices: number, centreRow: number, rowAt: (y: number) => number,
  stops: number, symH: number,
): DrumBandPiece[] {
  const out: DrumBandPiece[] = [];
  const bandH = stops * symH;
  for (let i = 0; i < slices; i++) {
    const y0 = Math.round((i * height) / slices);
    const y1 = Math.round(((i + 1) * height) / slices);
    if (y1 <= y0) continue;
    const srcH = (rowAt(y1) - rowAt(y0)) * symH;
    if (!(srcH > 0)) continue;
    const r0 = centreRow + rowAt(y0);
    const sy = (((r0 % stops) + stops) % stops) * symH;
    for (const p of wrapPieces(y0, y1, sy, srcH, bandH, bandH)) {
      out.push({ sy: p.s, sh: p.sn, dy: p.d, dh: p.dn });
    }
  }
  return out;
}
