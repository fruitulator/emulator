import type { MachineDisplay } from '../machine/machine';
import { BETCOM_FONT } from './betcomfont';

export class BetcomAlpha implements MachineDisplay {
  readonly kind = 'msc' as const;

  readonly chars = new Uint8Array(16);

  readonly cellDots = new Uint8Array(16 * 6);

  private readonly cells = new Uint8Array(16);
  private readonly dots = new Uint8Array(16 * 6);
  private cursor = 0;
  private running = false;
  private bright = 0x1f;

  private lastClock = false;
  private shift = 0;
  private bits = 0;
  private lastPort = 0;

  constructor() {
    this.reset();
  }

  get duty(): number {
    return this.bright;
  }

  reset(): void {
    this.clear();
    this.cursor = 0;
    this.bright = 0x1f;
    this.running = false;
    this.lastClock = false;
    this.shift = 0;
    this.bits = 0;
    this.lastPort = 0;
  }

  private clear(): void {
    this.cells.fill(0x20);
    this.dots.fill(0);
    this.sync();
  }

  writePort(raw: number): void {
    const v = (raw ^ 5) & 0xff;
    if (((v ^ this.lastPort) & 7) === 0) { this.lastPort = v; return; }
    const sel = (v & 4) !== 0;
    const clock = (v & 1) !== 0;
    const data = (v & 2) !== 0;
    if (!sel) {
      this.bits = 0;
      this.shift = 0;
      this.lastClock = clock;
    } else if (clock !== this.lastClock) {
      this.lastClock = clock;
      if (!clock) {
        this.shift = ((this.shift << 1) | (data ? 0 : 1)) & 0xff;
        if (++this.bits === 8) {
          this.bits = 0;
          const b = this.shift;
          this.shift = 0;
          this.pendingByte = b;
        }
      }
    }
    if ((v ^ this.lastPort) & 4) {
      if (!sel && this.running) { this.running = false; this.resetController(); }
      else if (sel) this.running = true;
    }
    this.lastPort = v;
    if (this.pendingByte >= 0) {
      const b = this.pendingByte;
      this.pendingByte = -1;
      if (this.running) this.command(b);
    }
  }

  private pendingByte = -1;

  private resetController(): void {
    this.clear();
    this.cursor = 0;
    this.bright = 0x1f;
  }

  private command(b: number): void {
    if (b < 0x80) {
      if (b === 0x2e || b === 0x2c) {
        this.dots[this.cursor * 6 + 5] = BETCOM_FONT[b * 6 + 5];
        this.sync();
        return;
      }
      this.cursor = (this.cursor + 1) & 15;
      this.cells[this.cursor] = b;
      this.dots.set(BETCOM_FONT.subarray(b * 6, b * 6 + 6), this.cursor * 6);
      this.sync();
      return;
    }
    const hi = b & 0xf0;
    if (hi === 0xa0) this.cursor = b & 15;
    else if (b === 0xb0) this.clear();
    else if (hi === 0xe0 || hi === 0xf0) this.bright = hi & 0x1f;
  }

  private sync(): void {
    for (let i = 0; i < 16; i++) {
      this.chars[i] = this.cells[15 - i] & 0x7f;
      this.cellDots.set(this.dots.subarray((15 - i) * 6, (15 - i) * 6 + 6), i * 6);
    }
  }

  text(): string {
    let s = '';
    for (const c of this.chars) s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ' ';
    return s;
  }
}
