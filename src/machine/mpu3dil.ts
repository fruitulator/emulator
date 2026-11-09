import { locateMpu3Coins, mpu3Coins, type Mpu3Coin } from './mpu3coins';

export type Mpu3DilEffect = 'coin' | 'change' | 'singleCoinLockout';

export interface Mpu3DilRead {
  index: number;
  effect: Mpu3DilEffect;
}

export function mpu3DilRow(dip1: number, dip2: number, strobe: number): number {
  const low = (v: number): number =>
    (((v & 1) << 7) | ((v & 2) << 5) | ((v & 4) << 3) | ((v & 8) << 1) | ((v & 0x10) >> 1) | ((v & 0x20) >> 3)) & 0xff;
  const high = (v: number): number => ((v & 0x80) >> 1) | ((v & 0x40) << 1);
  switch (strobe) {
    case 4: return low(dip1);
    case 5: return high(dip1);
    case 6: return low(dip2);
    default: return high(dip2);
  }
}

export function mpu3DilSwitchesOf(strobe: number, mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 16; i++) {
    const bit = mpu3DilRow(i < 8 ? 1 << i : 0, i < 8 ? 0 : 1 << (i & 7), strobe) & 0xfc;
    if (bit & mask) out.push(i);
  }
  return out;
}

const rdOf = (rom: Uint8Array) => (a: number): number => rom[0x8000 | (a & 0x7fff)]!;

const credits = (cs: readonly Mpu3Coin[]): string => JSON.stringify(cs.map((c) => [c.id, c.credits]));
const changes = (cs: readonly Mpu3Coin[]): string => JSON.stringify(cs.map((c) => [c.id, c.change]));

function singleCoinLockout(rom: Uint8Array, rows: number): number | null {
  const rd = rdOf(rom);
  const pat = [0x81, 0x50, 0x22, -1, 0x96, -1, 0x85, 0x08, 0x27, -1, 0xca, -1];
  const hits: number[] = [];
  outer: for (let a = 0x0800; a + pat.length <= 0x8000; a++) {
    for (let i = 0; i < pat.length; i++) if (pat[i]! >= 0 && rd(a + i) !== pat[i]) continue outer;
    hits.push(a);
  }
  if (hits.length !== 1) return null;
  const h = hits[0]!;
  const rel = (at: number): number => (at + 2 + ((rd(at + 1) << 24) >> 24)) & 0x7fff;
  if (rel(h + 2) !== h + 10 || rel(h + 8) < h + 12) return null;
  const strobe = rd(h + 5) - rows;
  if (strobe < 4 || strobe > 7) return null;
  const sw = mpu3DilSwitchesOf(strobe, 0x08);
  return sw.length === 1 ? sw[0]! : null;
}

export function readMpu3Dil(rom: Uint8Array): Mpu3DilRead[] {
  const code = locateMpu3Coins(rom);
  if ('refused' in code) return [];
  const effects = new Map<number, Mpu3DilEffect>();
  const coinsAt = (dip1: number, dip2: number): Mpu3Coin[] | null =>
    mpu3Coins(code, rom, (s) => mpu3DilRow(dip1, dip2, s));
  for (const base of [0x00, 0xff]) {
    const at = coinsAt(base, base);
    if (!at) continue;
    for (let i = 0; i < 16; i++) {
      const d1 = i < 8 ? base ^ (1 << i) : base;
      const d2 = i < 8 ? base : base ^ (1 << (i & 7));
      const flipped = coinsAt(d1, d2);
      if (!flipped) continue;
      if (credits(flipped) !== credits(at)) effects.set(i, 'coin');
      else if (changes(flipped) !== changes(at) && effects.get(i) !== 'coin') effects.set(i, 'change');
    }
  }
  const lock = singleCoinLockout(rom, code.rows);
  if (lock !== null) {
    if (effects.has(lock)) effects.delete(lock);
    else effects.set(lock, 'singleCoinLockout');
  }
  return [...effects].sort((a, b) => a[0] - b[0]).map(([index, effect]) => ({ index, effect }));
}
