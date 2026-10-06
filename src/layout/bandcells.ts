
const SLACK = 2;
const QUIET = 0.2;
const MIN_CELL_PX = 12;

export interface BandPixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

function rowSpread(img: BandPixels): number[] {
  const out: number[] = [];
  for (let y = 0; y < img.height; y++) {
    let s = 0; let s2 = 0;
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      const l = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
      s += l; s2 += l * l;
    }
    const m = s / img.width;
    out.push(Math.sqrt(Math.max(0, s2 / img.width - m * m)));
  }
  return out;
}

function quietBoundaries(spread: number[], n: number, limit: number): number {
  const h = spread.length;
  let quiet = 0;
  for (let k = 0; k < n; k++) {
    const y0 = Math.round((k * h) / n);
    let min = Infinity;
    for (let d = -SLACK; d <= SLACK; d++) min = Math.min(min, spread[((y0 + d) % h + h) % h]);
    if (min <= limit) quiet++;
  }
  return quiet;
}

export function bandArtCells(img: BandPixels, stops: number): number | undefined {
  if (!(stops > 0) || img.height < 2 * MIN_CELL_PX || img.width < 1) return undefined;
  const spread = rowSpread(img);
  const sorted = spread.slice().sort((a, b) => a - b);
  const busy = sorted[Math.floor(sorted.length * 0.9)];
  if (!(busy > 0)) return undefined;
  const limit = busy * QUIET;
  if (quietBoundaries(spread, stops, limit) * 2 >= stops) return undefined;
  for (let n = Math.floor(img.height / MIN_CELL_PX); n >= 2; n--) {
    if (stops % n === 0) continue;
    if (quietBoundaries(spread, n, limit) === n) return n;
  }
  return undefined;
}
