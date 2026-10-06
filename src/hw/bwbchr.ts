
const BWB_SEQUENCE = Uint8Array.from([0x00, 0x04, 0x04, 0x0c, 0x0c, 0x1c, 0x14, 0x2c, 0x5c, 0x2c]);

const BWB_CALL_INDEX = Uint8Array.from([6, 0, 7, 0, 8, 0, 7, 0, 0, 8]);

export class BwbCharacteriser {
  readonly character: Uint8Array;
  private call = 0;
  private seq = 0;
  private matched = false;
  private done = false;
  private zeros = 0;
  private learnAt = 0;
  private readonly learned = new Uint8Array(5);
  private rng = 0x2545f491;

  constructor(character: Uint8Array) {
    this.character = new Uint8Array(72);
    this.character.set(character.subarray(0, 72));
  }

  write(val: number): void {
    const call = val & 0xff;
    const ch = this.character;
    this.call = call;
    this.matched = false;
    if (call === ch[BWB_CALL_INDEX[this.seq]]) {
      this.matched = true;
      return;
    }
    this.seq = 0;
    if (call === 0) {
      this.zeros = (this.zeros + 1) & 0xff;
      return;
    }
    if (this.zeros === 6) {
      this.zeros = 0;
      this.learned[this.learnAt] = call;
      this.learnAt++;
      if (ch[this.learnAt] === 0) ch[this.learnAt] = call;
      if (this.learnAt === 5) {
        this.zeros = 0;
        this.learnAt = 0;
      }
    } else {
      this.zeros = 0;
      this.learnAt = 0;
    }
  }

  read(): number {
    const random = this.random() & 0xfc;
    if (this.matched) {
      const v = BWB_SEQUENCE[this.seq++];
      if (this.seq === 10) {
        this.done = true;
        this.seq = 0;
      }
      return v;
    }
    const ch = this.character;
    const c = this.call;
    const c9 = ch[9];
    if (c === ch[1]) return (((c9 ^ 0xff) << 6) | 0x3c) & 0xff;
    if (c === ch[2]) return (c9 ^ 0xff) & 0xfc;
    if (c === ch[3] || c === ch[4] || c === ch[5]) return 0xfc;
    return random;
  }

  private random(): number {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng & 0xff;
  }

  debugState(): { call: number; seq: number; matched: boolean; done: boolean; zeros: number } {
    return { call: this.call, seq: this.seq, matched: this.matched, done: this.done, zeros: this.zeros };
  }
}

const PAT_CMPA = Uint8Array.from([0x86, 0xfc, 0xa4, 0x49, 0xa1, 0x89]);
const PAT_EOR_A = Uint8Array.from([0x86, 0x40, 0xb4]);
const PAT_EOR_B = Uint8Array.from([0x27, 0x02, 0x86, 0xff, 0x2a, 0x01, 0x5c, 0xc8]);

function matchAt(rom: Uint8Array, at: number, pat: Uint8Array): boolean {
  if (at + pat.length > rom.length) return false;
  for (let i = 0; i < pat.length; i++) if (rom[at + i] !== pat[i]) return false;
  return true;
}

export interface BwbRomKeys {
  keys: { common: number; other: [number, number, number] } | null;
  c9: number | null;
}

export function findBwbKeys(image: Uint8Array): BwbRomKeys {
  let table = -1;
  let offset = 0;
  let c9: number | null = null;
  for (let at = 0x1000; at <= image.length - 0x10; at++) {
    if (table < 0 && matchAt(image, at, BWB_SEQUENCE)) table = at;
    if (offset === 0 && matchAt(image, at, PAT_CMPA)) offset = (image[at + 6] << 8) | image[at + 7];
    if (c9 === null && matchAt(image, at, PAT_EOR_A) && matchAt(image, at + 5, PAT_EOR_B)) {
      c9 = (image[at + 13] ^ 0x64) & 0xff;
    }
    if (table >= 0 && offset !== 0 && c9 !== null) break;
  }
  let keys: BwbRomKeys['keys'] = null;
  if (table >= 0 && offset !== 0) {
    const k = table - offset;
    const b = (i: number) => image[k + i];
    if (k >= 1 && k + 8 < image.length) {
      const c = b(0);
      if (c === b(2) && c === b(4) && c === b(6) && c === b(7) && b(1) === b(5) && b(3) === b(8)) {
        keys = { common: c, other: [b(-1), b(1), b(3)] };
      }
    }
  }
  return { keys, c9 };
}

export function bwbCharacterFor(
  stored: Uint8Array | null,
  image: Uint8Array,
): { character: Uint8Array; source: 'layout' | 'rom' | 'none' } {
  const character = new Uint8Array(72);
  if (stored) character.set(stored.subarray(0, 72));
  if (character[0] !== 0) return { character, source: 'layout' };
  const found = findBwbKeys(image);
  if (found.c9 !== null) character[9] = found.c9;
  if (!found.keys) return { character, source: 'none' };
  character[0] = found.keys.common;
  character[6] = found.keys.other[0];
  character[7] = found.keys.other[1];
  character[8] = found.keys.other[2];
  return { character, source: 'rom' };
}
