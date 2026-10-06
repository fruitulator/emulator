
export interface BcosDevice {
  id: number;
  level: number;
  cls: number;
  ord: number;
  stride: number;
  bit: number;
  kind: number;
}

export interface BcosBank {
  cls: number;
  base: number;
  stride: number;
  width: number;
  kind: number;
  ord: number;
}

export interface BcosLampMap {
  table: number;
  phase: number;
  banks: BcosBank[];
}

const u16 = (rom: Uint8Array, a: number): number => (rom[a] << 8) | rom[a + 1];
const u32 = (rom: Uint8Array, a: number): number =>
  ((rom[a] << 24) | (rom[a + 1] << 16) | (rom[a + 2] << 8) | rom[a + 3]) >>> 0;

export function findDeviceTable(rom: Uint8Array): number {
  for (let p = 0; p + 64 * 20 <= rom.length; p += 2) {
    if (u16(rom, p + 14) !== 0x8001 || u16(rom, p + 12) !== 9) continue;
    const cls = u32(rom, p + 4);
    const base = u32(rom, p);
    if (base >>> 16 !== 0xffff || cls === 0 || cls + 16 > rom.length) continue;
    let ok = true;
    for (let i = 0; i < 64 && ok; i++) {
      const e = p + i * 20;
      ok = u32(rom, e + 4) === cls && u16(rom, e + 12) === 9
        && u16(rom, e + 14) === (((0x80 >> (i & 7)) << 8) | 1)
        && u32(rom, e) === ((base + (i >> 3)) >>> 0);
    }
    if (ok) return p;
  }
  return -1;
}

export function findLampPhase(rom: Uint8Array): number {
  let found = -1;
  for (let a = 0; a + 10 <= rom.length; a += 2) {
    if (u16(rom, a) !== 0x5278) continue;
    const addr = u16(rom, a + 2);
    if (u16(rom, a + 4) !== 0x0278 || u16(rom, a + 6) !== 0x0003
      || u16(rom, a + 8) !== addr) continue;
    const ram = 0xff0000 | addr;
    if (found >= 0 && found !== ram) return -1;
    found = ram;
  }
  return found;
}

function device(rom: Uint8Array, table: number, id: number): BcosDevice {
  const e = table + id * 20;
  const w = u16(rom, e + 14);
  return {
    id,
    level: u32(rom, e) & 0xffffff,
    cls: u32(rom, e + 4),
    ord: u32(rom, e + 8) | 0,
    stride: u16(rom, e + 12),
    bit: w >> 8,
    kind: w & 0xff,
  };
}

const MAX_ID = 0x300;

export function bcosLampMap(rom: Uint8Array): BcosLampMap | null {
  const table = findDeviceTable(rom);
  const phase = findLampPhase(rom);
  if (table < 0 || phase < 0) return null;
  const byClass = new Map<number, BcosBank & { levels: Set<number> }>();
  for (let id = 0; id < MAX_ID; id++) {
    const d = device(rom, table, id);
    if (d.kind !== 1 && d.kind !== 2) continue;
    if (d.cls === 0 || d.cls >= rom.length) continue;
    if (d.level >>> 16 !== 0xff || d.stride === 0) continue;
    let b = byClass.get(d.cls);
    if (!b) {
      b = { cls: d.cls, base: d.level, stride: d.stride, width: 0, kind: d.kind,
        ord: d.ord, levels: new Set() };
      byClass.set(d.cls, b);
    }
    b.base = Math.min(b.base, d.level);
    b.ord = Math.min(b.ord, d.ord);
    b.levels.add(d.level);
  }
  const banks = [...byClass.values()]
    .map((b) => ({ cls: b.cls, base: b.base, stride: b.stride, width: b.levels.size,
      kind: b.kind, ord: b.ord }))
    .sort((a, b) => a.cls - b.cls);
  return { table, phase, banks };
}

export interface Mpu5LampBanks {
  phase: number;
  asic: number;
  cabinet: number;
  zone: number;
  digits: number;
  reelLights: number;
}

export function mpu5LampBanks(rom: Uint8Array): Mpu5LampBanks | null {
  const map = bcosLampMap(rom);
  if (!map) return null;
  const pick = (kind: number, ord: number, width: number, stride: number) =>
    map.banks.filter((b) => b.kind === kind && b.ord === ord && b.width === width
      && b.stride === stride);
  const mux = pick(1, 8, 8, 9).sort((a, b) => a.base - b.base);
  return {
    phase: map.phase,
    asic: pick(1, 0, 8, 9)[0]?.base ?? 0,
    cabinet: mux[0]?.base ?? 0,
    zone: mux[1]?.base ?? 0,
    digits: pick(2, 8, 8, 9)[0]?.base ?? 0,
    reelLights: pick(1, 24, 3, 4)[0]?.base ?? 0,
  };
}

export function bcosNameMap(rom: Uint8Array): Map<number, string> | null {
  const nameAt = (a: number): string | null => {
    if (a <= 0 || a >= rom.length) return null;
    let s = '';
    for (let i = a; i < rom.length && i < a + 32; i++) {
      const c = rom[i];
      if (c === 0) return s.length >= 2 ? s : null;
      if (c < 0x20 || c > 0x7e) return null;
      s += String.fromCharCode(c);
    }
    return null;
  };
  let best = -1;
  let bestLen = 0;
  for (let p = 0; p + 6 <= rom.length; p += 2) {
    let n = 0;
    while (p + (n + 1) * 6 <= rom.length && nameAt(u32(rom, p + n * 6 + 2)) !== null) n++;
    if (n > bestLen) { best = p; bestLen = n; }
    if (n > 0) p += n * 6 - 2;
  }
  if (bestLen < 64) return null;
  const out = new Map<number, string>();
  for (let i = 0; i < bestLen; i++) {
    const e = best + i * 6;
    const id = u16(rom, e);
    if (!out.has(id)) out.set(id, nameAt(u32(rom, e + 2))!);
  }
  return out;
}

export interface Mpu5MatrixSwitch {
  name: string;
  number: number;
}

export function mpu5MatrixSwitches(rom: Uint8Array): Mpu5MatrixSwitch[] | null {
  const table = findDeviceTable(rom);
  if (table < 0) return null;
  const names = bcosNameMap(rom);
  if (!names) return null;
  const scan: { id: number; level: number; bit: number }[] = [];
  for (let id = 0; id < MAX_ID && table + (id + 1) * 20 <= rom.length; id++) {
    const e = table + id * 20;
    const level = u32(rom, e);
    if (level >>> 16 !== 0xffff || rom[e + 15] !== 3) continue;
    if (u32(rom, e + 4) !== ((level + 8) >>> 0) || u32(rom, e + 8) !== ((level - 8) >>> 0)) continue;
    scan.push({ id, level, bit: rom[e + 14] });
  }
  if (!scan.length) return null;
  const row0 = Math.min(...scan.map((d) => d.level));
  const out: Mpu5MatrixSwitch[] = [];
  for (const d of scan) {
    const row = d.level - row0;
    const b = [0x10, 0x20, 0x40, 0x80].indexOf(d.bit);
    const name = names.get(d.id);
    if (row > 3 || b < 0 || !name) continue;
    out.push({ name, number: row * 8 + b });
  }
  return out.sort((a, b) => a.number - b.number);
}
