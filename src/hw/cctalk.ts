
import { bnvDecodeFrame, bnvEncodeFrame, crc16, type BnvKey } from './cctalkbnv';
import { desEcb } from './des';
import { HopperJitter } from './hopper';

export const CC = {
  ACK: 0x00,
  RESET: 0x01,
  REQUEST_COMMS_REVISION: 0x04,
  STORE_ENCRYPTION_CODE: 0x88,
  SWITCH_ENCRYPTION_CODE: 0x89,
  READ_BUFFERED_BILL_EVENTS: 0x9f,
  REQUEST_BILL_ID: 0x9d,
  REQUEST_BILL_POSITION: 0x9b,
  REQUEST_COUNTRY_SCALING_FACTOR: 0x9c,
  MODIFY_BILL_OPERATING_MODE: 0x99,
  REQUEST_BILL_OPERATING_MODE: 0x98,
  REQUEST_CURRENCY_REVISION: 0x91,
  REQUEST_INHIBIT_STATUS: 0xe6,
  REQUEST_MASTER_INHIBIT_STATUS: 0xe3,
  ROUTE_BILL: 0x9a,
  PUMP_RNG: 0xa1,
  TEST_HOPPER: 0xa3,
  MODIFY_VARIABLE_SET: 0xa5,
  HOPPER_STATUS: 0xa6,
  DISPENSE: 0xa7,
  EMERGENCY_STOP: 0xac,
  REQUEST_BUILD_CODE: 0xc0,
  REQUEST_DEFAULT_SORTER_PATH: 0xbc,
  MODIFY_DEFAULT_SORTER_PATH: 0xbd,
  REQUEST_SORTER_PATHS: 0xd1,
  MODIFY_SORTER_PATHS: 0xd2,
  REQUEST_SORTER_OVERRIDE: 0xdd,
  MODIFY_SORTER_OVERRIDE: 0xde,
  MODIFY_MASTER_INHIBIT: 0xe4,
  READ_BUFFERED_CREDIT: 0xe5,
  MODIFY_INHIBIT: 0xe7,
  PERFORM_SELF_CHECK: 0xe8,
  REQUEST_SERIAL: 0xf2,
  REQUEST_SOFTWARE_REVISION: 0xf1,
  REQUEST_PRODUCT_CODE: 0xf4,
  REQUEST_ENCRYPTION_SUPPORT: 0x6f,
  SWITCH_ENCRYPTION_KEY: 0x6e,
  READ_ENCRYPTED_MECH_EVENTS: 0x70,
  READ_ENCRYPTED_BILL_EVENTS: 0x70,
  READ_ENCRYPTED_MONETARY_ID: 0x6c,
  REQUEST_EQUIPMENT_CATEGORY: 0xf5,
  REQUEST_MANUFACTURER: 0xf6,
  REQUEST_VARIABLE_SET: 0xf7,
  REQUEST_STATUS: 0xf8,
  SIMPLE_POLL: 0xfe,
  ADDRESS_CHANGE: 0xfb,
  ADDRESS_RANDOM: 0xfa,
  REQUEST_POLLING_PRIORITY: 0xf9,
  REQUEST_COIN_ID: 0xb8,
  REQUEST_HOPPER_COIN: 0xab,
  ENABLE_HOPPER: 0xa4,
  REQUEST_HOPPER_DISPENSE_COUNT: 0xa8,
  REQUEST_CIPHER_KEY: 0xa0,
  REQUEST_ENCRYPTED_HOPPER_STATUS: 0x6d,
  REQUEST_ADDRESS_MODE: 0xa9,
  REQUEST_PAYOUT_STATUS: 0xd9,
  READ_DATA_BLOCK: 0xd7,
  WRITE_DATA_BLOCK: 0xd6,
} as const;

const CC_ACK = CC.ACK;

export interface CcTalkDevice {
  readonly model: string;
  reply(header: number, data: readonly number[]): number[] | null;
  reset(): void;
  decodeFrame?(raw: readonly number[]): { header: number; data: number[] } | null;
  encodeFrame?(dest: number, data: readonly number[]): number[];
  readonly des?: DesKey;
  address?: number;
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

export function encryptionSupport(protocolLevel: 0 | 1, desFitted: boolean): number[] {
  return [protocolLevel, desFitted ? 0x65 : 0x00, 0x18, 0x40, 0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

function sealEvents(
  key: readonly number[], random: () => number, counter: number,
  buffer: readonly (readonly number[])[], challenge: number,
): number[] {
  const ev = (i: number): readonly number[] => buffer[i] ?? [0, 0];
  const body = [
    random() & 0xff, counter, ...ev(0), ...ev(1),
    challenge & 0xff, random() & 0xff, ...ev(2), ...ev(3), ...ev(4),
  ];
  const crc = crc16(body);
  return desEcb(key, [crc & 0xff, ...body, (crc >> 8) & 0xff], false);
}

export class DesKey {
  key: number[] | null = null;

  switchKey(data: readonly number[]): number[] | null {
    if (!this.key || data.length < 16) return null;
    const plain = desEcb(this.key, data.slice(0, 16), true);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 8; i++) { a.push(plain[2 * i]); b.push(plain[2 * i + 1]); }
    if (!a.every((x, i) => x === this.key![i])) return null;
    if (!a.every((x, i) => x === b[i])) this.key = b;
    return [];
  }
}

export function inhibitLampWord(enabled: boolean, mask: number): number {
  if (!enabled) return 0x8000;
  const m = mask & 0xffff;
  return m | (m === 0 ? 0x8000 : 0);
}

export class Sr5iMech implements CcTalkDevice {
  static readonly snapshotConfig: readonly string[] = ['address', 'model', 'v20Type', 'bnvKey', 'currency'];

  bnvKey: BnvKey = [...JcmEba.DEFAULT_KEY];

  readonly model = 'SR5i';

  private events = 0;
  private buffer: [number, number][] = [];
  private enciphered = false;

  readonly des = new DesKey();

  desFitted = true;

  address = 2;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.events = 0;
    this.reported = 0;
    this.buffer = [];
    this.enciphered = false;
    this.secure = false;
    this.master = 1;
    this.inhibit = 0;
    this.defaultPath = 4;
    this.onLampWord?.(this.lampWord);
  }

  onLampWord?: (word: number) => void;

  private master = 1;
  private inhibit = 0;
  private defaultPath = 4;
  private sorterOverride = 0;
  private sorterPaths: number[] = new Array<number>(17 * 4).fill(0);

  private get enabled(): boolean {
    return this.master !== 0;
  }

  get lampWord(): number {
    return inhibitLampWord(this.enabled, this.inhibit);
  }

  insert(channel: number): boolean {
    const ch = channel & 0xff;
    const bit = 1 << ((ch - 1) & 31);
    if (!this.enabled) { this.push(0, 2); return false; }
    if ((this.inhibit & bit) === 0) { this.push(0, (ch + 0x7f) & 0xff); return false; }
    const slot = Math.min(ch, 16) * 4;
    this.push(ch, this.sorterPaths[slot + ((this.sorterOverride & bit) === 0 ? 1 : 0)] ?? 0);
    return true;
  }

  refuses(channel: number): boolean {
    return !this.enabled || (this.inhibit & (1 << ((channel - 1) & 31))) === 0;
  }

  onCredit?: (channel: number) => void;
  private reported = 0;

  private deliver(): void {
    const fresh = Math.min((this.events - this.reported) & 0xff, this.buffer.length);
    this.reported = this.events;
    for (let i = fresh - 1; i >= 0; i--) {
      const code = this.buffer[i]?.[0] ?? 0;
      if (code) this.onCredit?.(code);
    }
  }

  static channelPence(channel: number, currency = 0): number | null {
    const m = /^GB(\d{3})/.exec(Sr5iMech.coinIdOf(currency, channel));
    return m ? Number(m[1]) : null;
  }

  pence(channel: number): number | null {
    return Sr5iMech.channelPence(channel, this.currency);
  }

  static coinIdOf(currency: number, channel: number): string {
    const set = Sr5iMech.COIN_TABLES[currency] ?? Sr5iMech.COIN_TABLES[0]!;
    return set[channel - 1] ?? '......';
  }

  currency = 0;

  random: () => number = () => {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    return (this.seed >>> 16) & 0xff;
  };
  private seed = 0x2a6e;

  private encryptedEvents(challenge: number): number[] | null {
    if (!this.des.key) return null;
    return sealEvents(this.des.key, this.random, this.events, this.buffer, challenge);
  }

  push(code: number, path: number): void {
    this.buffer.unshift([code & 0xff, path & 0xff]);
    this.buffer.length = Math.min(this.buffer.length, 5);
    this.events = (this.events + 1) & 0xff;
  }

  decodeFrame(raw: readonly number[]): { header: number; data: number[] } | null {
    const len = raw[1] ?? 0;
    if (raw[2] === 1) {
      let s = 0;
      for (const x of raw) s = (s + x) & 0xff;
      if (s === 0 && (!this.secure || raw[3] === CC.REQUEST_ENCRYPTION_SUPPORT)) {
        this.enciphered = false;
        return { header: raw[3] ?? 0, data: [...raw.slice(4, 4 + len)] };
      }
    }
    if (!this.secure) return null;
    const m = bnvDecodeFrame(this.bnvKey, raw);
    if (m) this.enciphered = true;
    return m;
  }

  private secure = false;

  encodeFrame(dest: number, data: readonly number[]): number[] {
    let frame: number[];
    if (this.enciphered) frame = bnvEncodeFrame(this.bnvKey, dest, 0, data);
    else {
      const b = [dest, data.length, this.address, 0, ...data];
      let s = 0;
      for (const x of b) s = (s + x) & 0xff;
      frame = [...b, (0x100 - s) & 0xff];
    }
    if (this.pendingKey) { this.bnvKey = this.pendingKey; this.pendingKey = null; }
    return frame;
  }

  private pendingKey: BnvKey | null = null;

  static readonly COIN_IDS: readonly string[] =
    ['GB100B', 'GB050B', 'GB020A', 'GB010B', 'TK477A', 'GB200A', 'GB005A'];

  static readonly COIN_TABLES: readonly (readonly string[])[] = [
    Sr5iMech.COIN_IDS,
    ['GB100A', 'GB050B', 'GB020A', 'GB010B', '......', 'GB200A', 'GB005A', '......', 'TK477A', 'TK558A', 'TK724A'],
    ['EU005A', 'EU010A', 'EU020A', 'EU050A'],
  ];

  reply(header: number, data: readonly number[] = []): number[] | null {
    switch (header) {
      case CC.REQUEST_MANUFACTURER:
        return ascii('Money Controls');
      case CC.REQUEST_EQUIPMENT_CATEGORY:
        return ascii('Coin Acceptor');
      case CC.REQUEST_PRODUCT_CODE:
        return ascii('SR5i');
      case CC.REQUEST_POLLING_PRIORITY:
        return [2, 20];
      case CC.REQUEST_COIN_ID: {
        const ch = data[0] ?? 0;
        return ascii(Sr5iMech.coinIdOf(this.currency, ch));
      }
      case CC.READ_BUFFERED_CREDIT: {
        const events: number[] = [];
        for (let i = 0; i < 5; i++) {
          events.push(this.buffer[i]?.[0] ?? 0, this.buffer[i]?.[1] ?? 0);
        }
        const reply = [this.events, ...events];
        this.deliver();
        if (this.events === 0) this.push(0, 2);
        return reply;
      }
      case CC.REQUEST_ENCRYPTION_SUPPORT:
        this.secure = true;
        return encryptionSupport(1, this.desFitted);
      case CC.REQUEST_SOFTWARE_REVISION:
        return ascii('CRS-F1-V1.09');
      case CC.REQUEST_SERIAL:
        return [0x62, 0x11, 0x12];
      case CC.SWITCH_ENCRYPTION_KEY:
        this.enciphered = true;
        return this.des.switchKey(data);
      case CC.READ_ENCRYPTED_MECH_EVENTS: {
        const sealed = this.encryptedEvents(data[0] ?? 0);
        if (sealed) this.deliver();
        return sealed;
      }
      case CC.PERFORM_SELF_CHECK:
        return [0];
      case CC.SWITCH_ENCRYPTION_CODE:
        this.pendingKey = bnvKeyDigits(data);
        return [];
      case CC.MODIFY_MASTER_INHIBIT:
        this.master = data[0] ?? 0;
        this.onLampWord?.(this.lampWord);
        return [];
      case CC.REQUEST_MASTER_INHIBIT_STATUS:
        return [this.master & 0xff];
      case CC.REQUEST_DEFAULT_SORTER_PATH:
        return [this.defaultPath];
      case CC.MODIFY_DEFAULT_SORTER_PATH:
        this.defaultPath = data[0] ?? 0;
        return [];
      case CC.REQUEST_SORTER_PATHS: {
        const slot = Math.min(data[0] ?? 0, 16) * 4;
        return this.sorterPaths.slice(slot, slot + 4);
      }
      case CC.MODIFY_SORTER_PATHS: {
        const slot = Math.min(data[0] ?? 0, 16) * 4;
        for (let i = 1; i < data.length && i <= 4; i++) this.sorterPaths[slot + i - 1] = data[i] & 0xff;
        return [];
      }
      case CC.REQUEST_SORTER_OVERRIDE:
        return [this.sorterOverride];
      case CC.MODIFY_SORTER_OVERRIDE:
        this.sorterOverride = data[0] ?? 0;
        return [];
      case CC.MODIFY_INHIBIT:
        this.inhibit = (data[0] ?? 0) | ((data[1] ?? 0) << 8);
        this.onLampWord?.(this.lampWord);
        return [];
      default:
        return [];
    }
  }
}

export function bnvKeyDigits(data: readonly number[]): BnvKey {
  const d = (i: number) => data[i] ?? 0;
  return [d(0) & 15, d(0) >> 4, d(1) & 15, d(1) >> 4, d(2) & 15, d(2) >> 4];
}

const pairSwap = (b: number): number => ((b & 0xaa) >> 1) | ((b & 0x55) << 1);

export function v20Scramble1(key: readonly number[], count: number): number[] {
  const k = [...key];
  const xor = (start: number, n: number, x: number) => {
    for (let i = start; i < start + n; i++) k[i] ^= x;
  };
  const inv = (...ix: number[]) => { for (const i of ix) k[i] ^= 0xff; };
  const swap = (a: number, b: number) => { const t = k[a]; k[a] = k[b]; k[b] = t; };
  const bits = (...ix: number[]) => { for (const i of ix) k[i] = pairSwap(k[i]); };
  const exchange = (a: number, b: number, n: number) => {
    const old = k[a];
    const mask = (1 << n) - 1;
    k[a] = ((k[a] << n) | (mask & (k[b] >> (8 - n)))) & 0xff;
    k[b] = ((k[b] << n) | ((old >> (8 - n)) & mask)) & 0xff;
  };
  const exchanges = (n: number) => {
    exchange(6, 1, n); exchange(7, 4, n); exchange(3, 0, n); exchange(2, 5, n);
  };
  const rotate = (n: number) => {
    const hi = k.map((b) => (b >> n) & ((1 << (8 - n)) - 1));
    for (let i = 0; i < 8; i++) k[i] = ((k[i] << (8 - n)) | hi[(i + 1) & 7]) & 0xff;
  };
  xor(0, 8, pairSwap(count & 0xff));
  xor(5, 1, 0xa5); xor(0, 1, 0x84);
  exchanges(5);
  xor(3, 1, 0x02); xor(2, 1, 0x90);
  bits(3);
  exchanges(2);
  inv(7, 0, 5);
  swap(7, 1); swap(2, 0); swap(0, 7); swap(3, 5); swap(0, 1); swap(5, 4);
  inv(1, 6);
  swap(7, 1); swap(2, 0); swap(0, 7); swap(3, 5); swap(7, 3); swap(2, 1);
  xor(1, 1, 0xf2); xor(3, 1, 0x02); xor(2, 1, 0x90);
  rotate(3);
  swap(3, 4); swap(0, 6); swap(0, 1); swap(4, 5);
  xor(6, 1, 0x33); xor(5, 1, 0xa5); xor(0, 1, 0x84);
  inv(0, 5, 1, 6, 2, 3);
  rotate(2);
  exchanges(6);
  rotate(3);
  inv(7, 4, 0, 5, 2, 3);
  bits(3, 2, 7, 6);
  rotate(2);
  bits(3, 5, 0, 6);
  return k;
}

export function v20Scramble2(key: readonly number[], count: number): number[] {
  const k = [...key];
  const x = (0x104 - (count & 0xff)) & 0xff;
  for (let i = 0; i < 8; i++) k[i] ^= x;
  const lfsr = (n: number) => {
    for (let r = 0; r < n; r++) {
      let carry = ((k[5] >> 7) ^ (k[0] >> 3) ^ (k[3] >> 6) ^ (k[7] >> 7)) & 1;
      for (let i = 0; i < 8; i++) {
        const old = k[i];
        k[i] = ((k[i] << 1) & 0xfe) | carry;
        carry = old >> 7;
      }
    }
  };
  const rot16 = (n: number) => {
    const r = (w: number) => { for (let i = 0; i < n; i++) w = ((w << 1) | (w >> 15)) & 0xffff; return w; };
    const a = r((k[0] << 8) | k[3]);
    const b = r((k[1] << 8) | k[6]);
    const c = r((k[5] << 8) | k[2]);
    const d = r((k[4] << 8) | k[7]);
    k[0] = a >> 8; k[3] = a & 0xff;
    k[1] = b >> 8; k[6] = b & 0xff;
    k[5] = c >> 8; k[2] = c & 0xff;
    k[4] = d >> 8; k[7] = d & 0xff;
  };
  const swap = (p: number, q: number) => { const t = k[p]; k[p] = k[q]; k[q] = t; };
  const inv = (...ix: number[]) => { for (const i of ix) k[i] ^= 0xff; };
  const rot64 = (n: number) => {
    for (let r = 0; r < n; r++) {
      const top = k[0] >> 7;
      for (let i = 0; i < 8; i++) k[i] = ((k[i] << 1) & 0xff) | (i < 7 ? k[i + 1] >> 7 : top);
    }
  };
  const bits = (...ix: number[]) => { for (const i of ix) k[i] = pairSwap(k[i]); };
  lfsr(0x1f);
  rot16(5);
  swap(1, 7); swap(2, 0); swap(0, 7); swap(3, 5); swap(1, 0); swap(4, 5);
  rot16(4);
  swap(3, 4); swap(6, 0); swap(3, 7); swap(1, 2); swap(1, 0); swap(4, 5);
  inv(7, 4, 0, 5, 2, 3);
  rot64(5);
  rot16(2);
  bits(1, 4, 3, 2, 7, 5, 0);
  swap(1, 7); swap(2, 0); swap(0, 7); swap(3, 5); swap(1, 0); swap(4, 5);
  bits(6);
  rot16(2);
  bits(3, 2, 7, 5, 0);
  inv(7, 4, 2, 3);
  bits(2, 7);
  lfsr(0x29);
  rot64(6);
  inv(7, 2, 3);
  swap(1, 7); swap(2, 0); swap(3, 4); swap(6, 0); swap(1, 0); swap(4, 5);
  lfsr(0x1b);
  bits(6);
  return k;
}

export class Sch2Hopper implements CcTalkDevice {
  static readonly snapshotConfig: readonly string[] = ['address', 'model', 'v20Type', 'bnvKey'];

  readonly model: string = 'SCH 2';

  protected events = 0;
  protected remaining = 0;
  protected paid = 0;
  protected v20Type = 1;
  address = 3;

  protected get serial(): number[] {
    const n = 0x121140 + (this.address & 0xff);
    return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
  }
  protected status = 0x80;
  protected status2 = 0;
  protected lifetime = 0;
  protected blocks = new Uint8Array(256 * 8);
  desFitted = true;
  trustedBox = false;
  protected trusted = false;
  coin = 'GB100A';
  onPaid?: () => void;

  protected period = 100_000;
  protected timer = 0;
  protected coinOut = false;

  protected seed = 0x5ce1;
  protected random = (): number => {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    return (this.seed >>> 16) & 0xff;
  };

  protected cipherKey: number[] = Array.from({ length: 8 }, () => this.random());

  protected rollCipherKey(): void {
    this.cipherKey = Array.from({ length: 8 }, () => this.random());
  }

  setPeriod(cycles: number): void {
    this.period = cycles;
  }

  get timing(): boolean {
    return this.timer > 0;
  }

  eventIn(): number {
    return this.timer > 0 ? this.timer : Infinity;
  }

  readonly jitter = new HopperJitter();

  private gap(period: number): number {
    return period * this.jitter.next();
  }

  tick(cycles: number): void {
    if (this.timer <= 0) return;
    this.timer -= cycles;
    if (this.timer > 0) return;
    const period = this.period;
    if (!this.coinOut) {
      this.coinOut = true;
      this.timer += Math.floor(period / 8);
      this.remaining = (this.remaining - 1) & 0xff;
      this.lifetime++;
      this.paid = (this.paid + 1) & 0xff;
      this.onPaid?.();
      return;
    }
    this.coinOut = false;
    if (this.remaining !== 0) this.timer += this.gap(period);
    else this.timer = 0;
  }

  protected dispense(data: readonly number[]): number[] | null {
    const n = data.length;
    if (n === 0) return null;
    if (this.trusted) return null;
    const count = data[n - 1];
    let proof = data.slice(0, n - 1);
    let key = this.cipherKey;
    if (n === 9) {
      const des = this.desProof(proof, count);
      if (des) proof = des;
      else if (this.v20Type === 1 || this.v20Type === 3) key = v20Scramble1(key, count);
      else if (this.v20Type === 2) key = v20Scramble2(key, count);
    } else if (n === 4) {
      this.cipherKey = [...this.serial, ...this.cipherKey.slice(3)];
      key = this.cipherKey;
    } else if (n - 1 > 8) {
      return null;
    }
    const ok = proof.every((b, i) => b === key[i]);
    if (n === 9) this.rollCipherKey();
    if (!ok) return null;
    this.events = this.events === 0xff ? 1 : this.events + 1;
    this.remaining = count;
    if (count >= 2 && this.status2 & 0x02) return null;
    this.paid = 0;
    if (count !== 0) this.timer = this.gap(this.period);
    return [this.events];
  }

  protected desProof(_proof: number[], _count: number): number[] | null {
    return null;
  }

  get dispensing(): boolean {
    return this.remaining > 0;
  }

  get dispensed(): number {
    return this.lifetime;
  }

  reset(): void {
    this.events = 0;
    this.remaining = 0;
    this.paid = 0;
    this.status = 0x80;
    this.status2 = 0;
    this.timer = 0;
    this.coinOut = false;
    this.trusted = this.trustedBox;
    this.rollCipherKey();
  }

  reply(header: number, data: readonly number[]): number[] | null {
    switch (header) {
      case CC.REQUEST_PRODUCT_CODE:
        return ascii('SCH2');
      case CC.REQUEST_EQUIPMENT_CATEGORY:
        return ascii('Payout');
      case CC.REQUEST_SERIAL:
        return [...this.serial];
      case CC.REQUEST_SOFTWARE_REVISION:
        return ascii('SCH2-V2.3J');
      case CC.ENABLE_HOPPER:
        this.status = (this.status & 0x7f) | (data[0] === 0xa5 ? 0 : 0x80);
        return [];
      case CC.MODIFY_VARIABLE_SET:
        if (data.length >= 4 && this.status2 === 0) this.status2 = data[3] ? 0x02 : 0;
        return [];
      case CC.REQUEST_MANUFACTURER:
        return ascii('Money Controls');
      case CC.REQUEST_VARIABLE_SET:
        return [0x22, 0x00, 0x10, 0x00, 0xbc, 0x00];
      case CC.TEST_HOPPER:
        return [this.status, this.status2];
      case CC.EMERGENCY_STOP:
        this.timer = 0;
        this.coinOut = false;
        return [this.remaining];
      case CC.REQUEST_CIPHER_KEY:
        return [...this.cipherKey];
      case CC.REQUEST_ADDRESS_MODE:
        return [0x4a];
      case CC.REQUEST_PAYOUT_STATUS:
        return [0x30];
      case CC.REQUEST_HOPPER_COIN:
        return ascii(this.coin);
      case CC.REQUEST_HOPPER_DISPENSE_COUNT:
        return [this.lifetime & 0xff, (this.lifetime >> 8) & 0xff, (this.lifetime >> 16) & 0xff];
      case CC.DISPENSE:
        return this.dispense(data);
      case CC.HOPPER_STATUS:
        return [this.events, this.remaining, this.paid, 0];
      case CC.WRITE_DATA_BLOCK: {
        const at = (data[0] ?? 0) * 8;
        data.slice(1).forEach((b, i) => { if (at + i < this.blocks.length) this.blocks[at + i] = b; });
        return [];
      }
      case CC.READ_DATA_BLOCK: {
        const at = (data[0] ?? 0) * 8;
        return [...this.blocks.subarray(at, at + 8)];
      }
      default:
        return [];
    }
  }
}

export class Sch5Hopper extends Sch2Hopper {
  override readonly model: string = 'SCH 5';

  readonly des = new DesKey();

  bnvKey: BnvKey = [...JcmEba.DEFAULT_KEY];

  private enciphered = false;

  private get desLive(): boolean {
    return this.desFitted && this.des.key !== null;
  }

  protected override v20Type = 3;

  protected override desProof(proof: number[], count: number): number[] | null {
    if (!this.desLive) return null;
    return desEcb(this.des.key!, proof, true).map((b) => b ^ count);
  }

  override reset(): void {
    super.reset();
    this.enciphered = false;
  }

  decodeFrame(raw: readonly number[]): { header: number; data: number[] } | null {
    const len = raw[1] ?? 0;
    if (raw[2] === 1) {
      let s = 0;
      for (const x of raw) s = (s + x) & 0xff;
      if (s === 0) {
        this.enciphered = false;
        return { header: raw[3] ?? 0, data: [...raw.slice(4, 4 + len)] };
      }
    }
    const m = bnvDecodeFrame(this.bnvKey, raw);
    if (m) this.enciphered = true;
    return m;
  }

  private pendingKey: BnvKey | null = null;

  encodeFrame(dest: number, data: readonly number[]): number[] {
    let frame: number[];
    if (this.enciphered) frame = bnvEncodeFrame(this.bnvKey, dest, 0, data);
    else {
      const b = [dest, data.length, this.address, 0, ...data];
      let s = 0;
      for (const x of b) s = (s + x) & 0xff;
      frame = [...b, (0x100 - s) & 0xff];
    }
    if (this.pendingKey) { this.bnvKey = this.pendingKey; this.pendingKey = null; }
    return frame;
  }

  override reply(header: number, data: readonly number[]): number[] | null {
    switch (header) {
      case CC.REQUEST_PRODUCT_CODE:
        return ascii('SCH5');
      case CC.REQUEST_SOFTWARE_REVISION:
        return ascii('SCH5-V2.3J');
      case CC.REQUEST_SERIAL:
        return [...this.serial];
      case CC.REQUEST_ENCRYPTION_SUPPORT:
        return encryptionSupport(0, this.desFitted);
      case CC.SWITCH_ENCRYPTION_KEY:
        return this.des.switchKey(data);
      case CC.SWITCH_ENCRYPTION_CODE:
        this.pendingKey = bnvKeyDigits(data);
        return [];
      case CC.REQUEST_CIPHER_KEY:
        return this.desLive ? desEcb(this.des.key!, this.cipherKey, false) : [...this.cipherKey];
      case CC.REQUEST_ENCRYPTED_HOPPER_STATUS: {
        if (!this.des.key) return null;
        const body = [
          data[0] ?? 0, this.events, this.remaining, this.paid, 0, this.random(),
          data[1] ?? 0, data[2] ?? 0, this.status, this.status2, 0, 0x30, this.random(), this.random(),
        ];
        const crc = crc16(body);
        return desEcb(this.des.key, [crc & 0xff, ...body, (crc >> 8) & 0xff], false);
      }
      case CC.TEST_HOPPER:
        return [this.status, this.status2, 0x00];
      default:
        return super.reply(header, data);
    }
  }
}

export class Sch3Hopper extends Sch5Hopper {
  override readonly model: string = 'SCH 3';

  protected override v20Type = 2;

  override reply(header: number, data: readonly number[]): number[] | null {
    switch (header) {
      case CC.REQUEST_PRODUCT_CODE:
        return ascii('SCH3');
      case CC.REQUEST_SOFTWARE_REVISION:
        return ascii('SCH3-V2.3');
      case CC.TEST_HOPPER:
        return [this.status, this.status2];
      default:
        return super.reply(header, data);
    }
  }
}

export class JcmEba implements CcTalkDevice {
  static readonly snapshotConfig: readonly string[] = ['address', 'model', 'v20Type'];

  readonly model = 'JCM EBA';

  static readonly DEFAULT_KEY: BnvKey = Object.freeze([1, 2, 3, 4, 5, 6]);

  private stored: BnvKey = [...JcmEba.DEFAULT_KEY];
  private key: BnvKey = [...JcmEba.DEFAULT_KEY];
  private pending: BnvKey | null = null;

  private events = 0;

  private buffer: [number, number][] = [];
  private enabled = false;
  private inhibit = 0;
  get lampWord(): number {
    return inhibitLampWord(this.enabled, this.inhibit);
  }
  onLampWord?: (word: number) => void;
  private mode = 2;
  private get escrow(): boolean { return (this.mode & 2) !== 0; }
  private held = 0;

  onStacked?: (type: number) => void;

  private push(a: number, b: number): void {
    this.buffer.unshift([a & 0xff, b & 0xff]);
    this.buffer.length = Math.min(this.buffer.length, 5);
    this.events = (this.events + 1) & 0xff;
    if (this.events === 0) this.events = 1;
    if (b === 0 && a !== 0) this.onStacked?.(a);
  }

  static billPence(type: number): number | null {
    const m = /^GB(\d{4})/.exec(GB_BILLS[type] ?? '');
    return m ? Number(m[1]) * JcmEba.SCALE : null;
  }

  private static readonly SCALE = 100;

  insertNote(type: number): 'stacked' | 'escrow' | 'busy' | 'inhibited' | 'unprogrammed' {
    if (this.held) return 'busy';
    if (!this.enabled || (this.inhibit & (1 << ((type - 1) & 31))) === 0) return 'inhibited';
    if (JcmEba.billPence(type) === null) return 'unprogrammed';
    if (this.escrow) {
      this.held = type;
      this.push(type, 1);
      return 'escrow';
    }
    this.push(type, 0);
    return 'stacked';
  }

  readonly des = new DesKey();

  desFitted = true;

  address = 0x28;

  random: () => number = () => {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    return (this.seed >>> 16) & 0xff;
  };
  private seed = 0x51d3;

  reset(): void {
    this.key = [...this.stored];
    this.pending = null;
    this.events = 0;
    this.buffer = [];
    this.enabled = false;
    this.inhibit = 0;
    this.mode = 2;
    this.held = 0;
    this.onLampWord?.(this.lampWord);
  }

  private monetaryId(position: number, challenge: number): number[] | null {
    if (!this.des.key) return null;
    const id = ascii(GB_BILLS[position] ?? '');
    const body = id.length
      ? [position, 0x23, id[0], id[1], 2, 0, challenge, this.random() & 0xff, ...id.slice(2), 0x31]
      : [position, 0x2e, 0x2e, 0x2e, 0, 0, challenge, this.random() & 0xff, 0x2e, 0x2e, 0x2e, 0x2e, 0x2e, 0x2e];
    const crc = crc16(body.map((b) => b & 0xff));
    return desEcb(this.des.key, [crc & 0xff, ...body, (crc >> 8) & 0xff], false);
  }

  setStoredKey(key: BnvKey): void {
    this.stored = [...key];
    this.key = [...key];
    this.pending = null;
  }

  private plain = false;

  decodeFrame(raw: readonly number[]): { header: number; data: number[] } | null {
    const len = raw[1] ?? 0;
    if (raw[2] === 1) {
      let s = 0;
      for (const x of raw) s = (s + x) & 0xff;
      if (s === 0) {
        this.plain = true;
        return { header: raw[3] ?? 0, data: [...raw.slice(4, 4 + len)] };
      }
    }
    this.plain = false;
    return bnvDecodeFrame(this.key, raw);
  }

  encodeFrame(dest: number, data: readonly number[]): number[] {
    if (this.plain) {
      this.plain = false;
      const b = [dest, data.length, this.address, CC_ACK, ...data];
      let s = 0;
      for (const x of b) s = (s + x) & 0xff;
      return [...b, (0x100 - s) & 0xff];
    }
    const frame = bnvEncodeFrame(this.key, dest, CC_ACK, data);
    if (this.pending) { this.key = this.pending; this.pending = null; }
    return frame;
  }

  private static digits(data: readonly number[]): BnvKey {
    return [data[0] & 15, data[0] >> 4, data[1] & 15, data[1] >> 4, data[2] & 15, data[2] >> 4];
  }

  reply(header: number, data: readonly number[]): number[] | null {
    switch (header) {
      case CC.STORE_ENCRYPTION_CODE:
        this.stored = [...this.key];
        return [];
      case CC.SWITCH_ENCRYPTION_CODE:
        this.pending = JcmEba.digits(data);
        return [];
      case CC.RESET:
        this.reset();
        return [];
      case CC.REQUEST_EQUIPMENT_CATEGORY:
        return ascii('Bill Validator');
      case CC.REQUEST_PRODUCT_CODE:
        return ascii('EBA-22-PB2');
      case CC.REQUEST_ENCRYPTION_SUPPORT:
        return encryptionSupport(1, this.desFitted);
      case CC.REQUEST_SOFTWARE_REVISION:
        return ascii('V4.03-07');
      case CC.REQUEST_SERIAL:
        return [0x68, 0x11, 0x12];
      case CC.SWITCH_ENCRYPTION_KEY:
        return this.des.switchKey(data);
      case CC.REQUEST_BUILD_CODE:
        return ascii('Standard');
      case CC.REQUEST_MANUFACTURER:
        return ascii('JCM');
      case CC.REQUEST_COMMS_REVISION:
        return [0x01, 0x04, 0x06];
      case CC.REQUEST_BILL_POSITION:
        return ascii('GB').every((c, i) => c === data[i]) ? [0x07, 0x00] : [0x00, 0x00];
      case CC.REQUEST_BILL_ID:
        return ascii(GB_BILLS[data[0]] ?? EMPTY_BILL);
      case CC.READ_ENCRYPTED_MONETARY_ID:
        return this.monetaryId(data[0] ?? 0, data[1] ?? 0);
      case CC.READ_ENCRYPTED_BILL_EVENTS:
        return this.des.key
          ? sealEvents(this.des.key, this.random, this.events || 1, this.buffer, data[0] ?? 0)
          : null;
      case CC.READ_BUFFERED_BILL_EVENTS: {
        const evs: number[] = [];
        for (let i = 0; i < 5; i++) evs.push(this.buffer[i]?.[0] ?? 0, this.buffer[i]?.[1] ?? 0);
        return [this.events, ...evs];
      }
      case CC.ROUTE_BILL: {
        const route = data[0] ?? 0;
        if (route === 0xff) return [];
        const type = this.held;
        this.held = 0;
        if (route !== 0 && type) this.push(type, 0);
        return [];
      }
      case CC.PERFORM_SELF_CHECK:
        return [0];
      case CC.MODIFY_BILL_OPERATING_MODE:
        this.mode = (data[0] ?? 0) & 0xff;
        return [];
      case CC.REQUEST_BILL_OPERATING_MODE:
        return [this.mode];
      case CC.REQUEST_INHIBIT_STATUS:
        return [this.inhibit & 0xff, (this.inhibit >> 8) & 0xff];
      case CC.REQUEST_MASTER_INHIBIT_STATUS:
        return [this.enabled ? 1 : 0];
      case CC.REQUEST_CURRENCY_REVISION:
        return ascii('001');
      case CC.REQUEST_COUNTRY_SCALING_FACTOR:
        return ascii('GB').every((c, i) => c === data[i]) ? [JcmEba.SCALE & 0xff, JcmEba.SCALE >> 8, 2] : [0, 0, 0];
      case CC.REQUEST_POLLING_PRIORITY:
        return [3, 2];
      case CC.MODIFY_MASTER_INHIBIT:
        this.enabled = (data[0] ?? 0) !== 0;
        this.onLampWord?.(this.lampWord);
        return [];
      case CC.MODIFY_INHIBIT:
        this.inhibit = (data[0] ?? 0) | ((data[1] ?? 0) << 8);
        this.onLampWord?.(this.lampWord);
        return [];
      case CC.SIMPLE_POLL:
        return [];
      default:
        return null;
    }
  }
}

const GB_BILLS: Record<number, string> = {
  1: 'GB0005A',
  2: 'GB0010A',
  3: 'GB0020A',
};

const EMPTY_BILL = '.......';

const MODELS: Record<string, () => CcTalkDevice> = {
  SR5I: () => new Sr5iMech(),
  SCH2: () => new Sch2Hopper(),
  SCH3: () => new Sch3Hopper(),
  SCH5: () => new Sch5Hopper(),
  JCMEBA: () => new JcmEba(),
};

export function deviceFor(model: string): CcTalkDevice | null {
  const key = model.replace(/[\s-]/g, '').toUpperCase();
  return MODELS[key]?.() ?? null;
}
