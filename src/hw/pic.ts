
export interface ProgramCardConfig {
  stakeKey: number;
  jackpotKey: number;
  percentKey: number;
  optionSwitches: number;
  test: boolean;
}

export function noProgramCard(): ProgramCardConfig {
  return {
    stakeKey: 0, jackpotKey: 0, percentKey: 0, optionSwitches: 0, test: false,
  };
}

export function programCardByte(c: ProgramCardConfig, i: number): number {
  switch (i) {
    case 0:
      return ((((c.stakeKey & 7) | (c.test ? 8 : 0)) << 4)
        | (c.jackpotKey & 0x0f)) & 0xff;
    case 1: return percentKeyWireNibble(c.percentKey);
    default: return optionSwitchWireByte(c.optionSwitches);
  }
}

export function optionSwitchWireByte(bank: number): number {
  const rev = (n: number): number =>
    ((n & 1) << 3) | ((n & 2) << 1) | ((n & 4) >> 1) | ((n & 8) >> 3);
  return ((rev((bank >> 4) & 0x0f) << 4) | rev(bank & 0x0f)) & 0xff;
}

export function percentKeyWireNibble(code: number): number {
  const k = code & 0x0f;
  return ((k & 1) << 3) | ((k & 2) << 1) | ((k & 4) >> 1) | ((k & 8) >> 3);
}

export type PicResponder = (history: readonly number[]) => number;

export type PicType = 1 | 2 | 3;

export function picTypeFromLayout(v: string | null | undefined): PicType | null {
  return v === '1' ? 1 : v === '2' ? 2 : v === '3' ? 3 : null;
}

export function picDriverScan(rom: Uint8Array): number | null {
  const len = rom.length;
  let at = -1;
  for (let i = 0; i + 3 < len; i++) {
    if (rom[i] === 0x4f && rom[i + 1] === 0x4c && rom[i + 2] === 0x44 && rom[i + 3] === 0x20) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  const isCmp = (p: number): boolean => rom[p] === 0xb0
    && (rom[p + 1] === 0x92 || rom[p + 1] === 0x94 || rom[p + 1] === 0x95);
  let p = at + 3;
  let steps = 0;
  let found = 0;
  let prev = 0;
  do {
    for (;;) {
      p++;
      if (p + 1 >= len) return null;
      if (steps >= 100 || isCmp(p)) break;
      steps++;
    }
    const pat = rom[p] | (rom[p + 1] << 8);
    if (pat === prev) found--;
    else prev = pat;
    found++;
  } while (found < 2);
  return steps < 100 && isCmp(p) ? p : null;
}

export const PIC_ACCESS_CYCLES = 250;

const CMD_CONFIG = 0x00;
const CMD_IDENTITY = 0x01;
export const PIC_EPOCH_OFFSET = 0x83aa7e80;
const CMD_READ = 0x02;
const CMD_STORE = 0x03;
const CMD_SHORT = 0x04;
const SECURITY_ARG = 0x16;
const SECURITY_ANSWER = 0xa5;
const SECURITY_FIRST_PIC3 = 0x5a;

const STREAM = 0x0d;
const REPLY = 0x28;

export class MpuPic {
  responder: PicResponder = () => -1;

  config: ProgramCardConfig = noProgramCard();

  identity = '';

  type: PicType = 1;

  now: () => Date = () => new Date();

  machineCycles: () => number = () => 0;
  clockHz = 16_000_000;

  private pinnedAt: number | null = null;
  private pinnedCycle = 0;

  private clk = 1;
  private dataOut = 0;
  private inShift = 0;
  private skip = 1;
  private outShift = 0;
  private dataIn = 0;
  private ptr = STREAM;
  private readonly mem = new Uint8Array(0x30);
  private remaining = 0;
  private cmd = 0;
  private arg = 0;
  private startPending = 0;
  private done = 1;
  private attentionDeferred = 0;
  private challenges = 0;
  private bits = 0;
  private readonly stored = new Uint8Array(0x100);
  private seen: number[] = [-1, -1, -1, -1];
  private history: number[] = [];

  pin(at: Date | null): void {
    this.pinnedAt = at === null ? null : at.getTime();
    this.pinnedCycle = this.machineCycles();
  }

  private seconds(): number {
    const ms = this.pinnedAt === null
      ? this.now().getTime()
      : this.pinnedAt + ((this.machineCycles() - this.pinnedCycle) * 1000) / Math.max(1, this.clockHz);
    return (Math.floor(ms / 1000) + PIC_EPOCH_OFFSET) >>> 0;
  }

  reset(): void {
    this.clk = 1;
    this.dataOut = 0;
    this.bits = 0;
    this.inShift = 0;
    this.skip = 1;
    this.remaining = 0;
    this.mem.fill(0);
    this.loadStream();
    this.outShift = this.mem[STREAM];
    this.startPending = 0;
    this.done = 1;
    this.attentionDeferred = 0;
    this.seen = [-1, -1, -1, -1];
    this.challenges = 0;
    this.history = [];
  }

  write(offset: number, val: number): void {
    this.noticeKeys();
    const level = val !== 0 ? 1 : 0;
    const o = offset & 0xf;
    if (o === 4 || o === 5) {
      if (this.clk) this.start();
      this.dataOut = level;
    } else if (o === 6 || o === 7) {
      if (level === 0 && this.clk && !this.skip) {
        this.inShift = ((this.inShift << 1) | this.dataOut) & 0xff;
        this.outShift = (this.outShift << 1) & 0xff;
        if (++this.bits === 8) {
          if (this.type === 1) this.ptr++;
          else this.commandByte(this.inShift);
          this.inShift = 0;
          this.bits = 0;
          this.outShift = this.mem[this.ptr] ?? 0;
          if (this.type !== 1 && this.history.length > 0) {
            const r = this.responder(this.history);
            if (r >= 0) this.outShift = r & 0xff;
          }
        }
      } else if (level === 1 && !this.clk) {
        if (this.done && this.startPending) {
          this.startPending = 0;
          this.attention(false);
        }
        this.dataIn = (this.outShift >> 7) & 1;
      }
      this.skip = 0;
      this.clk = level;
    }
  }

  read(_offset: number): number {
    this.noticeKeys();
    return this.dataIn;
  }

  private start(): void {
    this.skip = 1;
    this.startPending = 1;
    this.done = 0;
    this.history = [];
    if (this.type === 1) {
      this.loadStream();
      this.ptr = STREAM;
      this.outShift = this.mem[STREAM];
    } else {
      this.remaining = 0;
      this.mem[REPLY] = programCardByte(this.config, 0);
      this.ptr = REPLY;
      this.inShift = 0;
      this.bits = 0;
      this.outShift = this.mem[REPLY];
    }
  }

  private loadStream(): void {
    const c = this.config;
    this.mem[STREAM] = (c.stakeKey & 7) | (c.test ? 8 : 0);
    const sw = optionSwitchWireByte(c.optionSwitches);
    this.mem[STREAM + 1] = sw >> 4;
    this.mem[STREAM + 2] = sw & 0x0f;
    this.mem[STREAM + 3] = percentKeyWireNibble(c.percentKey);
    this.mem[STREAM + 4] = c.jackpotKey & 0x0f;
    this.ptr = STREAM;
  }

  private attention(changed: boolean): void {
    if (!this.startPending) {
      if (changed || this.attentionDeferred) {
        this.outShift = 0xff;
        this.dataIn = 1;
        this.attentionDeferred = 0;
      }
    } else {
      this.attentionDeferred = 1;
    }
  }

  private keys(): number[] {
    const c = this.config;
    return [c.optionSwitches & 0xff, c.percentKey & 0x0f, c.stakeKey & 7, c.jackpotKey & 0x0f];
  }

  private noticeKeys(): void {
    const k = this.keys();
    const s = this.seen;
    if (s[0] < 0) { this.seen = k; return; }
    if (k[0] !== s[0] || k[1] !== s[1] || k[2] !== s[2] || k[3] !== s[3]) {
      this.attention(true);
      this.seen = k;
    }
  }

  private commandByte(b: number): void {
    const m = this.mem;
    if (this.remaining === 0) {
      this.cmd = b;
      this.history = [b];
      switch (b) {
        case CMD_CONFIG:
          this.remaining = 2;
          m[REPLY] = percentKeyWireNibble(this.config.percentKey);
          m[REPLY + 1] = optionSwitchWireByte(this.config.optionSwitches);
          this.ptr = REPLY;
          break;
        case CMD_IDENTITY:
        case CMD_READ:
        case CMD_STORE:
          this.remaining = 2;
          m[REPLY] = 0;
          m[REPLY + 1] = 0;
          this.ptr = REPLY;
          break;
        case CMD_SHORT:
          this.remaining = 1;
          m[REPLY] = 0;
          this.ptr = REPLY;
          break;
        default:
          break;
      }
      return;
    }
    this.history.push(b);
    this.remaining--;
    this.ptr++;
    if (this.remaining === 0) {
      this.done = 1;
      if (this.cmd === CMD_STORE) this.stored[this.arg] = b;
      return;
    }
    this.arg = b;
    switch (this.cmd) {
      case CMD_IDENTITY:
        if (b < 4) {
          this.remaining = 1;
          m[REPLY] = (this.identity.charCodeAt(b) || 0) & 0xff;
          this.ptr = REPLY;
        }
        break;
      case CMD_READ: {
        const t = this.seconds();
        if (b === SECURITY_ARG) {
          const first = this.challenges === 0;
          this.challenges = (this.challenges + 1) & 0xff;
          m[REPLY] = first && this.type === 3 ? SECURITY_FIRST_PIC3 : SECURITY_ANSWER;
          this.ptr = REPLY;
        } else if (b >= 0x1c && b <= 0x1f) {
          m[REPLY] = (t >>> ((0x1f - b) * 8)) & 0xff;
          this.ptr = REPLY;
        }
        break;
      }
      default:
        break;
    }
  }

  storedByte(addr: number): number {
    return this.stored[addr & 0xff];
  }
}
