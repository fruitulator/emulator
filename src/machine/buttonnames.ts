
export interface NamedCap {
  readonly role: string;
  readonly label: string;
}

interface RoutineShape {
  readonly words: readonly (readonly [number, number])[];
  readonly start: number;
  readonly end: number;
  readonly countAtEnd: boolean;
}

const SHAPES: readonly RoutineShape[] = [
  {
    words: [[0, 0x48e7], [1, 0x3020], [2, 0x322f], [3, 0x0010], [4, 0x227c],
      [7, 0x4242], [8, 0x2449], [9, 0x3639]],
    start: 5, end: 10, countAtEnd: false,
  },
  {
    words: [[0, 0x4fef], [1, 0xfff0], [2, 0x48d7], [3, 0x003c], [4, 0x4242],
      [5, 0x7800], [6, 0x3839], [9, 0x7a00], [10, 0x3a2f], [11, 0x0016],
      [12, 0x7201], [13, 0x6024], [14, 0x2003], [15, 0xe788], [16, 0x41f9],
      [19, 0xd1c0], [20, 0x7000], [21, 0x3010], [22, 0xba80], [23, 0x660e]],
    start: 17, end: 7, countAtEnd: true,
  },
];

export function roleOfSwitchName(name: string): string {
  const n = name.trim().toUpperCase();
  if (/^(CN\/|CAN\/)?COL/.test(n)) return 'collect';
  if (/^CANC/.test(n)) return 'cancel';
  if (/^START/.test(n)) return 'start';
  if (/^EXCH/.test(n)) return 'exchange';
  const hold = /^HOLD ?([123])$/.exec(n);
  if (hold) return `hold${hold[1]}`;
  return '';
}

function image(roms: readonly Uint8Array[], oddFirst: boolean): Uint8Array {
  const pairs: [Uint8Array, Uint8Array][] = [];
  for (let k = 0; k + 1 < roms.length; k += 2) {
    const a = roms[k]!, b = roms[k + 1]!;
    pairs.push(oddFirst ? [b, a] : [a, b]);
  }
  const size = pairs.reduce((s, [e, o]) => s + 2 * Math.min(e.length, o.length), 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const [even, odd] of pairs) {
    const n = Math.min(even.length, odd.length);
    for (let i = 0; i < n; i++) { out[at + 2 * i] = even[i]!; out[at + 2 * i + 1] = odd[i]!; }
    at += 2 * n;
  }
  return out;
}

const MOTHERBOARD_PORT = 16;

function namesIn(img: Uint8Array): Map<number, NamedCap> | undefined {
  const w = (i: number) => (img[i]! << 8) | img[i + 1]!;
  const l = (i: number) => ((w(i) << 16) | w(i + 2)) >>> 0;
  for (const shape of SHAPES) {
    const lead = shape.words[0]![1];
    const span = 2 * (Math.max(...shape.words.map(([k]) => k), shape.start, shape.end) + 2);
    for (let i = 0; i + span <= img.length; i += 2) {
      if (w(i) !== lead) continue;
      if (!shape.words.every(([k, v]) => w(i + 2 * k) === v)) continue;
      const start = l(i + 2 * shape.start), end = l(i + 2 * shape.end);
      if (!(end > start) || end + 2 > img.length) continue;
      if (shape.countAtEnd && w(end) * 8 !== end - start) continue;
      const got = recordsIn(img, start, end);
      if (got) return got;
      return undefined;
    }
  }
  return undefined;
}

function recordsIn(img: Uint8Array, start: number, end: number): Map<number, NamedCap> | undefined {
  const w = (i: number) => (img[i]! << 8) | img[i + 1]!;
  const l = (i: number) => ((w(i) << 16) | w(i + 2)) >>> 0;
  const out = new Map<number, NamedCap>();
  for (let j = start; j + 8 <= end; j += 8) {
    const portpos = w(j);
    const port = portpos & 0x1f, pos = portpos >> 5;
    if (pos >= 8) continue;
    if (port >= MOTHERBOARD_PORT) continue;
    const at = l(j + 4);
    let name = '';
    for (let k = at; k < at + 6 && k < img.length; k++) {
      const c = img[k]!;
      if (c === 0 || c === 0xff) break;
      if (c < 0x20 || c >= 0x7f) { name = ''; break; }
      name += String.fromCharCode(c);
    }
    name = name.trim();
    const id = port * 8 + pos;
    if (name && !out.has(id)) out.set(id, { role: roleOfSwitchName(name), label: name });
  }
  return out.size ? out : undefined;
}

export function readSwitchNames(roms: readonly Uint8Array[]): ReadonlyMap<number, NamedCap> | undefined {
  if (!roms.length) return undefined;
  const images = roms.length >= 2 ? [image(roms, true), image(roms, false)] : [...roms];
  for (const img of images) {
    const got = namesIn(img);
    if (got) return got;
  }
  return undefined;
}
