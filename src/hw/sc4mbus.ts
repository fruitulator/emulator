import type { Eeprom24c } from './eeprom';

export type SecurityKey = Uint8Array;

export function securityReply(challenge: Uint8Array, key: SecurityKey): Uint8Array {
  const out = new Uint8Array(8);
  let b = 0;
  for (let i = 0; i < 0x73; i++) {
    const c = challenge[Math.min(i, 15)];
    out[b] ^= c;
    let t = out[b];
    if (t & 1) t |= 0x100;
    t = (t >> 1) & 0xff;
    const d = (((c >> 4) | (c << 4)) + key[t & 15] + key[t >> 4]) & 0xff;
    b = (b + 1) & 7;
    out[b] ^= d;
  }
  return out;
}

export function findSecurityKey(rom: Uint8Array): SecurityKey | null {
  for (const fn of scrambleEntries(rom)) {
    for (let a = 0; a + 6 <= rom.length; a += 2) {
      const jsr = rom[a] === 0x4e && rom[a + 1] === 0xb9 && be32(rom, a + 2) === fn;
      const bsr = rom[a] === 0x61 && rom[a + 1] === 0x00 && a + 2 + be16s(rom, a + 2) === fn;
      const bsrS = rom[a] === 0x61 && rom[a + 1] !== 0x00 && rom[a + 1] !== 0xff
        && a + 2 + ((rom[a + 1] << 24) >> 24) === fn;
      if (!jsr && !bsr && !bsrS) continue;
      const key = keyFromTable(rom, a) ?? keyFromArgument(rom, a);
      if (key) return key;
    }
  }
  return null;
}

function scrambleEntries(rom: Uint8Array): number[] {
  const out: number[] = [];
  for (let a = 0; a + 2 <= rom.length; a += 2) {
    if ((rom[a] & 0xf1) !== 0x70 || rom[a + 1] !== 0x73) continue;
    let fn = -1;
    for (let e = a; e >= Math.max(0, a - 0x100); e -= 2) {
      if (rom[e] === 0x48 && rom[e + 1] === 0xe7) { fn = e; break; }
    }
    if (fn < 0 || out.includes(fn)) continue;
    if (hasNineBitRotate(rom, fn, Math.min(rom.length, a + 0x100))) out.push(fn);
  }
  return out;
}

function hasNineBitRotate(rom: Uint8Array, from: number, to: number): boolean {
  for (let x = from; x + 10 <= to; x += 2) {
    if (rom[x] === 0x08 && (rom[x + 1] & 0xf8) === 0x00 && rom[x + 2] === 0 && rom[x + 3] === 0
      && rom[x + 4] === 0x67 && rom[x + 5] === 0x04
      && rom[x + 6] === 0x00 && (rom[x + 7] & 0xf8) === 0x40 && rom[x + 8] === 0x01 && rom[x + 9] === 0x00) {
      return true;
    }
  }
  return false;
}

function keyFromTable(rom: Uint8Array, call: number): SecurityKey | null {
  for (let t = Math.max(0, call - 0x30); t < call; t += 2) {
    if ((rom[t] & 0xf1) !== 0x20 || rom[t + 1] !== 0x7c) continue;
    const table = be32(rom, t + 2);
    for (let c = call; c < Math.min(rom.length - 6, call + 0x60); c += 2) {
      if ((rom[c] & 0xf1) !== 0xb0 || rom[c + 1] !== 0x79) continue;
      const countAt = be32(rom, c + 2);
      const count = countAt + 2 <= rom.length ? (rom[countAt] << 8) | rom[countAt + 1] : 0;
      if (count >= 1 && table + 16 <= rom.length && countAt === table + 16 * count) {
        return rom.slice(table, table + 16);
      }
    }
  }
  return null;
}

function keyFromArgument(rom: Uint8Array, call: number): SecurityKey | null {
  for (let p = call - 6; p >= Math.max(0, call - 0x18); p -= 2) {
    if (rom[p] !== 0x48 || rom[p + 1] !== 0x79) continue;
    const key = be32(rom, p + 2);
    if (key + 16 <= rom.length) return rom.slice(key, key + 16);
  }
  return null;
}

export class Sc4SecurityChip {
  key: SecurityKey = new Uint8Array(16);
  readonly challenge = new Uint8Array(16);
  reply: Uint8Array = new Uint8Array(8);

  write(addr: number, v: number): void {
    if (addr >= 0x12 && addr < 0x22) this.challenge[addr - 0x12] = v;
    if (addr === 0x21) this.reply = securityReply(this.challenge, this.key);
  }

  read(addr: number): number {
    const a = addr - 0x12;
    if (a >= 0 && a < 8) return this.reply[a];
    if (a === 0xc) return 0x02;
    if (a === 0xd) return 0xd7;
    return 0;
  }
}

const bcd = (n: number): number => ((Math.trunc(n / 10) << 4) | (n % 10)) & 0xff;

export class Pcf8583 {
  control = 0;
  pointer = 0;
  readonly ram = new Uint8Array(256);
  now: () => Date = () => new Date();

  private pinnedAt: number | null = null;
  private pinnedCycles = 0;
  private pinnedHz = 1;

  pin(at: Date | null, hz: number): void {
    this.pinnedAt = at === null ? null : at.getTime();
    this.pinnedCycles = 0;
    this.pinnedHz = Math.max(1, hz);
  }

  tick(cycles: number): void {
    if (this.pinnedAt !== null) this.pinnedCycles += cycles;
  }

  rtcReads = 0;

  private stamp(): Date {
    this.rtcReads++;
    if (this.pinnedAt === null) return this.now();
    return new Date(this.pinnedAt + Math.floor((this.pinnedCycles * 1000) / this.pinnedHz));
  }

  write(addr: number, v: number): void {
    if (addr === 0xa2) {
      this.pointer = v & 0xff;
      return;
    }
    switch (this.pointer) {
      case 0: this.control = v; break;
      case 1: case 2: case 3: case 4: case 5: case 6: case 7: case 8: break;
      case 9: {
        const year = v & 0x7f ? (this.stamp().getFullYear() - 1996) & 0xff : 0;
        this.ram[9] = year | (v & 0x80);
        break;
      }
      default: this.ram[this.pointer] = v;
    }
    this.pointer = (this.pointer + 1) & 0xff;
  }

  read(): number {
    const d = this.stamp();
    const masked = (this.control & 0x08) !== 0;
    let v: number;
    switch (this.pointer) {
      case 0: v = this.control; break;
      case 1: v = d.getMilliseconds() & 0xff; break;
      case 2: v = bcd(d.getSeconds()); break;
      case 3: v = bcd(d.getMinutes()); break;
      case 4: v = bcd(d.getHours()); break;
      case 5: v = bcd(d.getDate()) | (masked ? 0 : (this.ram[9] & 3) << 6); break;
      case 6: v = bcd(d.getMonth() + 1) | (masked ? 0 : (d.getDay() << 5) & 0xff); break;
      case 7: case 8: v = 0; break;
      default: v = this.ram[this.pointer];
    }
    this.pointer = (this.pointer + 1) & 0xff;
    return v & 0xff;
  }
}

export class Sc4Mbus {
  readonly security = new Sc4SecurityChip();
  readonly rtc = new Pcf8583();

  private awaitingSelect = false;
  private device = 0;
  private address = 0;

  readonly store = new Uint8Array(0x2000);
  private storePtr = 0;

  constructor(private readonly eeprom: Eeprom24c) {}

  loadStore(image: Uint8Array): void {
    this.store.fill(0);
    this.store.set(image.subarray(0, this.store.length));
  }

  private ours(): boolean {
    return this.device === 0x12 || this.device === 0xa2 || this.device === 0xa8;
  }

  start(): void {
    this.awaitingSelect = true;
    this.eeprom.start();
  }

  stop(): void {
    this.awaitingSelect = false;
    this.eeprom.stop();
  }

  write(v: number): void {
    if (this.awaitingSelect) {
      this.awaitingSelect = false;
      this.device = v & 0xfe;
      this.address = this.device;
      if (!this.ours()) this.eeprom.write(v);
      return;
    }
    if (this.device === 0x12) this.security.write(this.address, v);
    else if (this.device === 0xa2) this.rtc.write(this.address, v);
    else if (this.device === 0xa8) this.storeWrite(this.address, v);
    else this.eeprom.write(v);
    this.address = (this.address + 1) & 0xffff;
  }

  private storeWrite(address: number, v: number): void {
    if (address === 0xa8) this.storePtr = (v & 0xff) << 8;
    else if (address === 0xa9) this.storePtr = (this.storePtr & 0x1f00) | (v & 0xff);
    else {
      this.store[this.storePtr & 0x1fff] = v & 0xff;
      this.storePtr = (this.storePtr & 0x1fe0) | ((this.storePtr + 1) & 0x1f);
    }
  }

  read(): number {
    let v: number;
    if (this.device === 0x12) v = this.security.read(this.address);
    else if (this.device === 0xa2) v = this.rtc.read();
    else if (this.device === 0xa8) {
      v = this.store[this.storePtr & 0x1fff];
      this.storePtr = (this.storePtr + 1) & 0x1fff;
    } else v = this.eeprom.read();
    this.address = (this.address + 1) & 0xffff;
    return v;
  }
}

const be32 = (b: Uint8Array, a: number): number =>
  ((b[a] << 24) | (b[a + 1] << 16) | (b[a + 2] << 8) | b[a + 3]) >>> 0;

const be16s = (b: Uint8Array, a: number): number => ((b[a] << 8) | b[a + 1]) << 16 >> 16;
