export const ROM_UNPLACED = 0x00;

export function placeRomPairs(
  files: readonly Uint8Array[],
  size: number,
  swap: 0 | 1,
  fill = ROM_UNPLACED,
): Uint8Array {
  if (files.length === 0) return new Uint8Array(0);
  if (files.length < 2) return files[0].slice();
  const stride = 2 * (size || (files.find((f) => f.length > 0)?.length ?? 0));
  let end = 0;
  files.forEach((f, i) => {
    if (!f.length) return;
    const at = stride * (i >> 1) + ((i ^ swap) & 1);
    end = Math.max(end, at + 2 * (f.length - 1) + 1);
  });
  const image = new Uint8Array(end).fill(fill);
  files.forEach((f, i) => {
    const at = stride * (i >> 1) + ((i ^ swap) & 1);
    for (let j = 0; j < f.length; j++) image[at + 2 * j] = f[j];
  });
  return image;
}

export interface FlatPlacement {
  readonly image: Uint8Array;
  readonly placed: number;
  readonly total: number;
}

export function placeRomFlat(
  files: readonly Uint8Array[],
  opts: { readonly min?: number; readonly fixed?: number; readonly max: number; readonly reverse: boolean },
): FlatPlacement {
  const { min = 0, fixed = 0, max, reverse } = opts;
  const image = new Uint8Array(max).fill(ROM_UNPLACED);
  let total = 0;
  for (const f of files) total += f.length;
  const eachFixed = fixed !== 0 && max < total;
  let off = 0;
  let idx = 0;
  let step = 1;
  if (reverse && files.length) {
    if (total < 0x10000) off = 0x10000 - total;
    idx = files.length - 1;
    step = -1;
  }
  let placed = 0;
  for (let k = 0; k < files.length && off < max; k++, idx += step) {
    const f = files[idx];
    if (!f.length) continue;
    let n = eachFixed ? fixed : f.length;
    if (off + n > max) n = Math.max(0, max - off);
    const put = Math.min(n, f.length);
    image.set(f.subarray(0, put), off);
    placed += put;
    if (n < min) {
      image.copyWithin(off + n, off, off + Math.min(n, Math.max(0, max - off - n)));
      off += n;
    }
    off += n;
  }
  return { image, placed, total };
}
