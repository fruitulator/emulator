
export interface AstraTableGetter {
  readonly at: number;
  readonly index: number;
  readonly index2: number | null;
  readonly table: number;
  readonly size: 1 | 2;
}

export interface AstraTokenPayout {
  readonly site: number;
  readonly enable: AstraTableGetter;
  readonly select: AstraTableGetter;
  readonly array: number;
}

const w16 = (b: Uint8Array, a: number): number => (a + 1 < b.length ? (b[a] << 8) | b[a + 1] : -1);
const l32 = (b: Uint8Array, a: number): number => (a + 3 < b.length ? ((b[a] << 24) | (b[a + 1] << 16) | (b[a + 2] << 8) | b[a + 3]) >>> 0 : -1);

export function parseAstraGetter(rom: Uint8Array, a: number): AstraTableGetter | null {
  if (w16(rom, a) !== 0x3039) return null;
  const index = l32(rom, a + 2);
  let p = a + 6;
  let index2: number | null = null;
  if (w16(rom, p) === 0xe748 && w16(rom, p + 2) === 0xd079) {
    index2 = l32(rom, p + 4);
    p += 8;
  }
  if (w16(rom, p) !== 0x207c) return null;
  const table = l32(rom, p + 2);
  p += 6;
  let size: 1 | 2;
  if (w16(rom, p) === 0x1030 && w16(rom, p + 2) === 0x0000) size = 1;
  else if (w16(rom, p) === 0x3030 && w16(rom, p + 2) === 0x0200) size = 2;
  else return null;
  if (w16(rom, p + 4) !== 0x4e75) return null;
  return { at: a, index, index2, table, size };
}

export function findAstraTokenPayout(rom: Uint8Array, limit = rom.length): AstraTokenPayout | null {
  const end = Math.min(limit, rom.length) - 8;
  for (let a = 0x400; a < end; a += 2) {
    const op = w16(rom, a);
    let next: number;
    if ((op & 0xfff8) === 0x0c00 && w16(rom, a + 2) === 0x0019) next = a + 4;
    else if ((op & 0xf1ff) === 0x7019 && (w16(rom, a + 2) & 0xf1f8) === 0xb080) next = a + 4;
    else continue;
    if (w16(rom, next) !== 0x6602 || (w16(rom, next + 2) & 0xf1ff) !== 0x7001) continue;
    let array = -1;
    for (let k = next + 4; k < next + 0x30; k += 2) {
      if (w16(rom, k) === 0x207c && w16(rom, k + 2) === 0x0040) { array = l32(rom, k + 2); break; }
    }
    if (array < 0) continue;
    const getters: AstraTableGetter[] = [];
    for (let k = Math.max(0, a - 0x30); k < a; k += 2) {
      if (w16(rom, k) !== 0x4eb9) continue;
      const g = parseAstraGetter(rom, l32(rom, k + 2));
      if (g) getters.push(g);
    }
    if (!getters.length) continue;
    return { site: a, enable: getters[0], select: getters[getters.length - 1], array };
  }
  return null;
}

export function evalAstraGetter(g: AstraTableGetter, rom: Uint8Array, ram: Uint8Array): number {
  const rw = (addr: number): number => (ram[addr & 0xffff] << 8) | ram[(addr + 1) & 0xffff];
  let i = rw(g.index);
  if (g.index2 !== null) i = ((i << 3) + rw(g.index2)) & 0xffff;
  if (i & 0x8000) return -1;
  return g.size === 1 ? (g.table + i < rom.length ? rom[g.table + i] : -1) : w16(rom, g.table + 2 * i);
}

export function astraTokenPence(p: AstraTokenPayout, rom: Uint8Array, ram: Uint8Array): number | null {
  if (evalAstraGetter(p.enable, rom, ram) <= 0) return null;
  const slot = evalAstraGetter(p.select, rom, ram) === 25 ? 1 : 0;
  const ra = (p.array + 4 * slot) & 0xffff;
  const entry = ((ram[ra] << 24) | (ram[ra + 1] << 16) | (ram[ra + 2] << 8) | ram[ra + 3]) >>> 0;
  const record = l32(rom, entry);
  if (record < 0 || record >= rom.length) return null;
  const pence = w16(rom, record);
  return pence > 0 && pence <= 1000 ? pence : null;
}
