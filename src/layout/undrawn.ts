import { decryptFml, isEncryptedFml } from './fml';
import { hasTagMap, parseLayout, type ParsedComponent } from './fmlparse';

export const UNDRAWN_TYPES: ReadonlyMap<number, string> = new Map([
  [0x1b, 'border'],
  [0x1c, 'digit block'],
]);

const LINE_MAX_TYPES = 4;

function components(layout: Uint8Array | undefined): ParsedComponent[] {
  if (!layout || layout.length === 0) return [];
  try {
    return parseLayout(isEncryptedFml(layout) ? decryptFml(layout) : layout);
  } catch {
    return [];
  }
}

const LAMP_PICTURES: readonly string[] = [
  ...Array.from({ length: 12 }, (_, i) => `Sublamp${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `SublampMask${i + 1}`),
  'BrightmaskMain', 'BrightmaskMask', 'OffImage',
];

function pictureShows(c: ParsedComponent, purpose: string): boolean | null {
  const bin = c.images.get(purpose);
  if (!bin) return null;
  if (!c.values.get('Transparent')) return true;
  const d = c.value;
  let bm = -1;
  for (let i = 0; i < 16 && i < bin.len; i++) {
    if (d[bin.off + i] === 0x42 && d[bin.off + i + 1] === 0x4d) { bm = bin.off + i; break; }
  }
  if (bm < 0) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const dataOff = dv.getUint32(bm + 10, true);
  const w = dv.getInt32(bm + 18, true);
  const h0 = dv.getInt32(bm + 22, true);
  const bpp = dv.getUint16(bm + 28, true);
  if (bpp !== 32 || w <= 0 || h0 === 0) return true;
  const h = Math.abs(h0);
  const rowSize = ((w * bpp + 31) >> 5) << 2;
  const pix = bm + dataOff;
  if (pix + (h - 1) * rowSize + w * 4 > d.length) return true;
  for (let y = 0; y < h; y++) {
    const row = pix + y * rowSize;
    for (let x = 0; x < w; x++) if (d[row + x * 4 + 3]) return true;
  }
  return false;
}

function capPaintsNothing(c: ParsedComponent): boolean {
  if (c.values.get('ButtonNumber') === undefined) return false;
  let any = false;
  for (const p of LAMP_PICTURES) {
    const shows = pictureShows(c, p);
    if (shows === null) continue;
    if (shows) return false;
    any = true;
  }
  return any;
}

export function undrawnLayoutNotes(layout: Uint8Array | undefined): string[] {
  const counts = new Map<string, number>();
  const add = (label: string): void => { counts.set(label, (counts.get(label) ?? 0) + 1); };
  let blankCaps = 0;
  for (const c of components(layout)) {
    if (capPaintsNothing(c)) blankCaps++;
    const named = UNDRAWN_TYPES.get(c.type);
    if (named) add(`${named} (0x${c.type.toString(16)})`);
    else if (c.type === 0x2d && (c.values.get('LampsEnabled') ?? 0)) add('flip reel lamps (0x2d)');
    else if (!hasTagMap(c.type)) add(`unknown (0x${c.type.toString(16)})`);
  }
  const lines: string[] = [];
  if (counts.size) {
    const parts = [...counts].map(([label, n]) => `${label} ×${n}`);
    const shown = parts.slice(0, LINE_MAX_TYPES).join(', ');
    const more = parts.length > LINE_MAX_TYPES ? `, +${parts.length - LINE_MAX_TYPES} more` : '';
    lines.push(`this layout has parts that are not drawn: ${shown}${more}`);
  }
  if (blankCaps) {
    lines.push('this layout has buttons whose own pictures are fully transparent,'
      + ` so they cannot show their lamp: ×${blankCaps}`);
  }
  return lines;
}
