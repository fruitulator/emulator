
const RESPONSE_LEN = 30;

const IDENTITY = [0x12, 0x34, 0x42, 0x46, 0x47, 0x41] as const;

const CHANGEOPT = [...'CHANGEOPT'].map((c) => c.charCodeAt(0));

export function decipher(
  challenge: readonly number[], state: readonly number[], key: readonly number[], n: number,
): number[] {
  const s = state.slice(0, 8).map((b) => b & 0xff);
  while (s.length < 8) s.push(0);
  const out: number[] = [];
  let at = 0;
  for (let round = 0; round < n; round++) {
    const c = challenge[round < 15 ? round : 15] & 0xff;
    const plain = (c ^ s[at]) & 0xff;
    out.push(plain);
    s[at] = c;
    let v = s[at];
    if (v & 1) v |= 0x100;
    const sub = key[(v >> 1) & 15] + key[v >> 5];
    at = (at + 1) % 8;
    const swapped = ((plain << 4) | (plain >> 4)) & 0xff;
    s[at] = (s[at] ^ ((swapped + sub) & 0xff)) & 0xff;
  }
  return out;
}

export function mix(challenge: readonly number[], key: readonly number[]): number[] {
  const state = new Array<number>(8).fill(0);
  let at = 0;
  for (let round = 0; round < 115; round++) {
    const c = challenge[round < 15 ? round : 15] & 0xff;
    state[at] = (state[at] ^ c) & 0xff;

    let v = state[at];
    if (v & 1) v |= 0x100;
    v >>= 1;
    v = (key[(v >> 4) & 15] + key[v & 15]) & 0xff;

    const swapped = (((c << 4) & 0xf0) | ((c >> 4) & 0x0f)) & 0xff;
    v = (swapped + v) & 0xff;

    at = (at + 1) % 8;
    state[at] = (state[at] ^ v) & 0xff;
  }
  return state;
}

export class Sc5Security {
  static readonly ADDRESS = 0x12;

  private key: number[] = new Array(16).fill(0);

  private challenge: number[] = [];
  private state: number[] = new Array(8).fill(0);
  private readAt = 0;
  private receiving = false;
  private words: [number, number] = [0, 0];
  optionsCleared = false;

  setKey(key: readonly number[]): void {
    this.key = [...key];
  }

  setLayoutWords(first: number, second: number): void {
    this.words = [first >>> 0, second >>> 0];
    this.optionsCleared = false;
  }

  get layoutWords(): readonly [number, number] {
    return this.words;
  }

  reset(): void {
    this.challenge = [];
    this.state = new Array(8).fill(0);
    this.readAt = 0;
    this.receiving = false;
  }

  write(v: number): void {
    if (!this.receiving) return;
    this.challenge.push(v & 0xff);
    if (this.challenge.length === 16) {
      const plain = decipher(this.challenge, this.state, this.key, CHANGEOPT.length);
      if (plain.every((b, i) => b === CHANGEOPT[i])) {
        this.words = [0, 0];
        this.optionsCleared = true;
      }
      this.state = mix(this.challenge, this.key);
      this.challenge = [];
    }
  }

  responseByte(n: number): number {
    if (n < 0) return 0;
    if (n < 8) return this.state[n] & 0xff;
    if (n >= 12 && n < 18) return IDENTITY[n - 12];
    if (n >= 18 && n < 26) {
      const w = this.words[n < 22 ? 0 : 1];
      return (w >>> (8 * (3 - ((n - 18) & 3)))) & 0xff;
    }
    if (n === 29) return 0x2a;
    return 0;
  }

  read(): number {
    const v = this.responseByte(this.readAt);
    this.readAt = Math.min(this.readAt + 1, RESPONSE_LEN);
    return v;
  }

  select(write: boolean): void {
    this.receiving = write;
    if (write) this.challenge = [];
    else this.readAt = 0;
  }

  deselect(): void {
    this.receiving = false;
  }
}

export function findSecurityKey(rom: Uint8Array): number[] | null {
  for (let a = 0; a + 12 <= rom.length; a += 2) {
    if (rom[a] !== 0xe9 || rom[a + 1] !== 0x88) continue;
    if (rom[a + 2] !== 0x06 || rom[a + 3] !== 0x80) continue;
    if (rom[a + 8] !== 0x2f || rom[a + 9] !== 0x00) continue;
    if (rom[a + 10] !== 0x2f || rom[a + 11] !== 0x0a) continue;
    const base =
      ((rom[a + 4] << 24) | (rom[a + 5] << 16) | (rom[a + 6] << 8) | rom[a + 7]) >>> 0;
    if (base + 16 > rom.length) continue;
    return Array.from(rom.subarray(base, base + 16));
  }
  return null;
}
