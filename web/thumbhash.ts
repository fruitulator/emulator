
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

const W = 9;
const H = 8;

export function dHash64(px: Pixels): string {
  const { width, height, data } = px;
  const grey = new Float64Array(W * H);
  const area = new Float64Array(W * H);
  for (let y = 0; y < height; y++) {
    const cy = Math.min(H - 1, Math.floor((y * H) / height));
    for (let x = 0; x < width; x++) {
      const cx = Math.min(W - 1, Math.floor((x * W) / width));
      const i = (y * width + x) * 4;
      const a = data[i + 3] / 255;
      grey[cy * W + cx] += a * (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      area[cy * W + cx] += 1;
    }
  }
  for (let k = 0; k < grey.length; k++) if (area[k]) grey[k] /= area[k];
  let hex = '';
  for (let y = 0; y < H; y++) {
    let byte = 0;
    for (let x = 0; x < W - 1; x++) byte = (byte << 1) | (grey[y * W + x] > grey[y * W + x + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function hamming(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) { n += x & 1; x >>= 1; }
  }
  return n;
}

export async function hashThumbBytes(bytes: Uint8Array): Promise<string> {
  const type = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/webp';
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return dHash64(g.getImageData(0, 0, c.width, c.height));
}
