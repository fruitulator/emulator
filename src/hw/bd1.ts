
function fold6(word: number): number {
  if ((word & 0x7f) === 0) return 0;
  const folded = word & 0x3f;
  return folded < 0x20 ? folded + 0x40 : folded;
}

const CUSTOM = 0x10000;
const BLANKED = 0x20000;
const FLASH_LIT = 0x40000;
const FLASHING = 0x80000;
const KEEP_ON_WRITE = 0xfff20000;

export class Bd1 {
  readonly kind = 'bda' as const;

  readonly chars = new Uint8Array(16);
  readonly cellWords = new Uint32Array(16);
  private readonly cell = new Uint32Array(16);

  private cursor = 0;
  private last = 0;
  private lastWasChar = false;
  private mode = 0;
  private winStart = 0;
  private winEnd = 15;
  private armLeft = false;
  private armRight = false;
  private dutyArmed = false;
  private fillArmed = false;
  private customLeft = 0;
  private custom = 0;

  duty = 31;

  private flashRate = 0;
  private flashLeft = 0;
  private flashOn = false;
  flashBase = 0;
  drawsHidden = true;

  private enabled = false;
  private clk = false;
  private shift = 0;
  private bits = 0;

  readonly trace = new Uint8Array(1024);
  private traceAt = 0;

  traceBytes(): number[] {
    return [...this.trace.subarray(this.traceAt), ...this.trace.subarray(0, this.traceAt)];
  }

  reset(): void {
    this.cell.fill(0);
    this.cursor = 0;
    this.last = 0;
    this.lastWasChar = false;
    this.mode = 0;
    this.winStart = 0;
    this.winEnd = 15;
    this.armLeft = false;
    this.armRight = false;
    this.dutyArmed = false;
    this.fillArmed = false;
    this.customLeft = 0;
    this.custom = 0;
    this.duty = 31;
    this.flashRate = 0;
    this.flashLeft = 0;
    this.flashOn = false;
    this.shift = 0;
    this.bits = 0;
    this.sync();
  }

  serial(reset: boolean, clock: boolean, bit: boolean): void {
    if (reset) {
      if (this.enabled) {
        this.reset();
        this.enabled = false;
      }
      this.clk = clock;
      return;
    }
    this.enabled = true;
    if (clock === this.clk) return;
    this.clk = clock;
    if (clock) return;
    this.shift = ((this.shift << 1) | (bit ? 1 : 0)) & 0xff;
    if (++this.bits === 8) {
      this.bits = 0;
      this.writeChar(this.shift);
    }
  }

  writeChar(data: number): void {
    data &= 0xff;
    this.trace[this.traceAt] = data;
    this.traceAt = (this.traceAt + 1) % this.trace.length;
    this.decode(data);
    this.sync();
  }

  private decode(data: number): void {
    if (this.dutyArmed) {
      this.duty = (data & 7) === 0 ? 31 : (7 - (data & 7)) * 4;
      this.dutyArmed = false;
      return;
    }
    if (this.fillArmed) {
      for (let i = 0; i < this.winStart; i++) this.cell[i] = data;
      for (let i = this.winEnd + 1; i < 16; i++) this.cell[i] = data;
      this.fillArmed = false;
      return;
    }
    let v = data;
    if (this.customLeft > 0) {
      this.custom = ((this.custom >> 8) | (data << 8)) & 0xffff;
      if (--this.customLeft > 0) return;
      v = this.custom | CUSTOM | (this.custom & 0x100 ? FLASHING : 0);
    } else if (data & 0x80) {
      this.command(data);
      this.lastWasChar = false;
      return;
    } else if (data === 0x25 || data === 0x26 || data === 0x3b) {
      if (data === 0x25) this.cell[this.last] |= FLASHING;
      return;
    } else if (data === 0x3a) {
      this.customLeft = 2;
      this.custom = 0;
      return;
    }
    if (v === 0x2e || v === 0x2c) {
      this.cell[this.last] |= v << 8;
      this.lastWasChar = false;
      return;
    }
    this.place(v);
  }

  private place(v: number): void {
    const prev = this.cell[this.last];
    if (this.lastWasChar && (prev & 0xff00) && !(prev & CUSTOM)) this.cell[this.last] = prev & 0xffff00ff;
    this.last = this.cursor;
    this.lastWasChar = true;
    switch (this.mode) {
      case 0:
        this.write(v);
        this.cursor = (this.cursor + 1) & 15;
        break;
      case 1:
        this.write(v);
        this.cursor = (this.cursor - 1) & 15;
        break;
      case 2:
        if (this.cursor >= this.winEnd && this.armLeft) {
          for (let i = this.winStart; i < this.winEnd; i++) this.cell[i] = this.cell[i + 1];
          this.cell[this.winEnd] = 0;
        }
        this.write(v);
        if (this.cursor < this.winEnd) {
          this.cursor++;
          this.armLeft = false;
        } else this.armLeft = true;
        break;
      case 3:
        if (this.cursor <= this.winStart && this.armRight) {
          for (let i = this.winEnd; i > this.winStart; i--) this.cell[i] = this.cell[i - 1];
          this.cell[this.winStart] = 0;
        }
        this.write(v);
        if (this.winStart < this.cursor) {
          this.cursor--;
          this.armRight = false;
        } else this.armRight = true;
        break;
    }
  }

  private write(v: number): void {
    this.cell[this.cursor] = ((this.cell[this.cursor] & KEEP_ON_WRITE) | v) >>> 0;
  }

  private command(data: number): void {
    const lo = data & 0x0f;
    const inWindow = (i: number) => i >= this.winStart && i <= this.winEnd;
    switch (data & 0xf0) {
      case 0x80:
        if (data === 0x80) for (let i = 0; i < 16; i++) this.cell[i] |= BLANKED;
        else if (data === 0x81) { for (let i = 0; i < 16; i++) if (!inWindow(i)) this.cell[i] |= BLANKED; }
        else if (data === 0x82) { for (let i = 0; i < 16; i++) if (inWindow(i)) this.cell[i] |= BLANKED; }
        else if (data === 0x83) for (let i = 0; i < 16; i++) this.cell[i] &= ~BLANKED;
        else if (data === 0x84) this.dutyArmed = true;
        break;
      case 0x90:
        this.cursor = lo;
        if (this.cursor >= this.winEnd && this.mode === 2) this.armLeft = true;
        if (this.cursor <= this.winStart && this.mode === 3) this.armRight = true;
        break;
      case 0xa0:
        if (lo < 4) this.mode = lo;
        break;
      case 0xb0:
        if (data === 0xb1) for (let i = this.winStart; i < this.winEnd; i++) this.cell[i] = 0x20;
        else if (data === 0xb2) { for (let i = 0; i < 16; i++) if (!inWindow(i)) this.cell[i] = 0x20; }
        else if (data === 0xb3) this.cell.fill(0x20);
        else if (data === 0xb8) this.fillArmed = true;
        break;
      case 0xc0:
        this.flashRate = lo;
        if (lo === 0) {
          this.flashLeft = 0;
          this.flashOn = false;
        } else this.flashLeft = this.flashBase * lo;
        break;
      case 0xd0:
        if (lo === 0) for (let i = 0; i < 16; i++) this.cell[i] &= ~(FLASHING | FLASH_LIT);
        else if (lo >= 1 && lo <= 3) {
          for (let i = 0; i < 16; i++) {
            const on = lo === 3 || (lo === 1) === inWindow(i);
            if (on) this.cell[i] |= FLASHING;
            else this.cell[i] &= ~FLASHING;
          }
        }
        break;
      case 0xe0:
        this.winStart = lo;
        break;
      case 0xf0:
        this.winEnd = lo;
        break;
    }
  }

  tick(cycles: number): void {
    if (this.flashLeft === 0) return;
    this.flashLeft -= cycles;
    if (this.flashLeft >= 1) return;
    this.flashLeft += this.flashBase * this.flashRate;
    this.flashOn = !this.flashOn;
    for (let i = 0; i < 16; i++) {
      if (!(this.cell[i] & FLASHING)) continue;
      if (this.flashOn) this.cell[i] |= FLASH_LIT;
      else this.cell[i] &= ~FLASH_LIT;
    }
  }

  private sync(): void {
    for (let c = 0; c < 16; c++) {
      const w = this.cell[c];
      const ch = w & CUSTOM ? 0 : fold6(w & 0x7f);
      this.chars[15 - c] = ch;
      this.cellWords[15 - c] = w & CUSTOM ? CUSTOM | (w & 0xffff) : ch | (w & 0xff00);
    }
  }

  hiddenCells(): number {
    if (!this.drawsHidden) return 0;
    let r = 0;
    for (let c = 0; c < 16; c++) {
      const w = this.cell[c];
      if (!(w & CUSTOM) && w & (BLANKED | FLASH_LIT)) r |= 1 << (15 - c);
    }
    return r;
  }

  customPattern(i: number): number | null {
    const w = this.cell[15 - (i & 15)];
    return w & CUSTOM ? w & 0xffff : null;
  }

  text(): string {
    return [...this.chars]
      .map((c) => (c === 0x21 ? '£' : c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ' '))
      .join('');
  }
}
