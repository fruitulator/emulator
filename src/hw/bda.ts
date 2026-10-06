
function fold6(code: number): number {
  const folded = code & 0x3f;
  return folded > 0 && folded < 0x20 ? folded + 0x40 : folded;
}

const BIT_REVERSE = Uint8Array.from({ length: 256 }, (_, b) => {
  let r = 0;
  for (let i = 0; i < 8; i++) if (b & (1 << i)) r |= 0x80 >> i;
  return r;
});

export const UDF_CELL = 0x80;

export class Bda {
  readonly kind = 'bda' as const;

  readonly chars = new Uint8Array(16);
  private readonly cells = new Uint8Array(16);
  private readonly mirrored: boolean;

  private cursor = 0;
  private mode = 0;
  private windowStart = 0;
  private windowEnd = 0;
  private windowSize = 0;
  private scrollActive = false;

  private userDef = 0;
  private readonly userDefBytes: number;
  private customSkip = 0;
  private custom = 0;
  private udfNext = 0;
  protected readonly modeCmdUserDef: boolean;

  private extended = false;
  private asciiCharset = false;
  private readonly udfSlot = new Uint8Array(128);
  readonly udfDots = new Uint8Array(16 * 5);
  private readonly udfData = new Uint8Array(7);

  private readonly gfxCol = new Uint8Array(96);
  private readonly gfxOn = new Uint8Array(96);
  private readonly shadow = new Uint8Array(96);
  private gfxBuffered = true;
  private gfxPending = false;
  private gfxLoad = 0;
  private gfxAt = 0;
  private gfxLeft = 0;
  private fillOutside = false;

  private readonly scrollQueue = new Uint8Array(48);
  private scrollCount = 0;
  private scrollRead = 0;
  private scrollCollect = false;
  private scrollLeft = 0;
  scrollPeriod = 0;

  private blank = 0;
  private flash = 0;
  private flashRate = 0;
  private flashLeft = 0;
  private flashOn = false;
  flashBase = 0;
  private v20Start = 0;
  private v20End = 15;
  readonly gfxDots = new Uint8Array(16 * 6);

  constructor(userDefBytes = 7, modeCmdUserDef = true, mirrored = false) {
    this.mirrored = mirrored;
    this.userDefBytes = userDefBytes;
    this.modeCmdUserDef = modeCmdUserDef;
  }

  readonly trace = new Uint8Array(1024);
  private traceAt = 0;

  traceBytes(): number[] {
    return [...this.trace.subarray(this.traceAt), ...this.trace.subarray(0, this.traceAt)];
  }
  private blankFlag = false;
  duty = 31;

  onByte: ((data: number) => void) | null = null;

  private enabled = false;
  private lastClock = false;
  private shift = 0;
  private bits = 0;

  private sync(): void {
    if (this.mirrored) for (let i = 0; i < 16; i++) this.chars[i] = this.cells[15 - i];
    else this.chars.set(this.cells);
    const g = this.gfxDots;
    for (let i = 0; i < 16; i++) {
      const cell = this.mirrored ? 15 - i : i;
      let mask = 0;
      for (let c = 0; c < 5; c++) {
        const col = cell * 6 + c;
        g[i * 6 + c] = this.gfxOn[col] ? BIT_REVERSE[this.gfxCol[col]] : 0;
        if (this.gfxOn[col]) mask |= 1 << c;
      }
      g[i * 6 + 5] = mask;
    }
  }

  private setCell(cell: number, v: number): void {
    this.cells[cell] = v;
    this.gfxOn.fill(0, cell * 6, cell * 6 + 6);
    this.flash &= ~(1 << cell);
  }

  private moveCell(to: number, from: number): void {
    this.cells[to] = this.cells[from];
    this.gfxCol.copyWithin(to * 6, from * 6, from * 6 + 6);
    this.gfxOn.copyWithin(to * 6, from * 6, from * 6 + 6);
    this.flash = (this.flash & ~(1 << to)) | (((this.flash >> from) & 1) << to);
  }

  private clearCells(from: number, to: number, keepFlash = false): void {
    if (to <= from) return;
    if (!keepFlash) for (let i = from; i < to; i++) this.flash &= ~(1 << i);
    this.cells.fill(0, from, to);
    this.gfxOn.fill(0, from * 6, to * 6);
    this.gfxCol.fill(0, from * 6, to * 6);
  }

  private window(): [number, number] {
    return [this.v20Start, this.v20End];
  }

  private windowMask(): number {
    const [s, e] = this.window();
    return s <= e ? (((1 << (e - s + 1)) - 1) << s) & 0xffff : 0;
  }

  hiddenCells(): number {
    const m = (this.blank | (this.flashOn ? this.flash : 0)) & 0xffff;
    if (!this.mirrored || !m) return m;
    let r = 0;
    for (let i = 0; i < 16; i++) if (m & (1 << i)) r |= 1 << (15 - i);
    return r;
  }

  private cellFor(code: number): number {
    if (this.udfSlot[code]) return UDF_CELL | (this.udfSlot[code] - 1);
    return this.asciiCharset ? code : fold6(code);
  }

  tick(cycles: number): void {
    if (this.flashLeft > 0) {
      this.flashLeft -= cycles;
      while (this.flashLeft < 1) {
        const reload = this.flashBase * this.flashRate;
        this.flashOn = !this.flashOn;
        if (reload === 0) {
          this.flashOn = false;
          this.flashLeft = 0;
          break;
        }
        this.flashLeft += reload;
      }
    }
    if (this.scrollLeft <= 0) return;
    this.scrollLeft -= cycles;
    let moved = false;
    while (this.scrollLeft < 1) {
      const [start, end] = this.window();
      if (start <= end) for (let i = start; i < end; i++) this.moveCell(i, i + 1);
      this.setCell(end & 15, this.scrollQueue[this.scrollRead++]);
      moved = true;
      if (this.scrollRead < this.scrollCount && this.scrollPeriod > 0) this.scrollLeft += this.scrollPeriod;
      else {
        this.scrollLeft = 0;
        break;
      }
    }
    if (moved) this.sync();
  }

  private graphicsByte(data: number): void {
    if (this.gfxLoad === 1) {
      this.gfxAt = data;
      this.gfxLoad = 2;
      return;
    }
    if (this.gfxLoad === 2) {
      this.gfxLeft = data - this.gfxAt + 1;
      this.gfxLoad = this.gfxLeft > 0 ? 3 : 0;
      return;
    }
    const at = this.gfxAt++;
    if (at < 96) {
      this.shadow[at] = data;
      if (!this.gfxBuffered) {
        this.gfxCol[at] = data;
        this.gfxOn[at] = 1;
      }
    }
    if (--this.gfxLeft !== 0) return;
    this.gfxLoad = 0;
    if (this.gfxBuffered) this.gfxPending = true;
  }

  reset(): void {
    this.cells.fill(0);
    this.chars.fill(0);
    this.cursor = 0;
    this.mode = 0;
    this.windowStart = 0;
    this.windowEnd = 0;
    this.windowSize = 0;
    this.scrollActive = false;
    this.userDef = 0;
    this.extended = false;
    this.asciiCharset = false;
    this.udfSlot.fill(0);
    this.udfDots.fill(0);
    this.udfData.fill(0);
    this.customSkip = 0;
    this.custom = 0;
    this.udfNext = 0;
    this.blankFlag = false;
    this.duty = 31;
    this.gfxCol.fill(0);
    this.gfxOn.fill(0);
    this.shadow.fill(0);
    this.gfxDots.fill(0);
    this.gfxBuffered = true;
    this.gfxPending = false;
    this.gfxLoad = 0;
    this.gfxAt = 0;
    this.gfxLeft = 0;
    this.fillOutside = false;
    this.scrollQueue.fill(0);
    this.scrollCount = 0;
    this.scrollRead = 0;
    this.scrollCollect = false;
    this.scrollLeft = 0;
    this.blank = 0;
    this.flash = 0;
    this.flashRate = 0;
    this.flashLeft = 0;
    this.flashOn = false;
    this.v20Start = 0;
    this.v20End = 15;
    this.enabled = false;
    this.lastClock = false;
    this.shift = 0;
    this.bits = 0;
  }

  private loadUserGlyph(): void {
    const d = this.udfData;
    const code = d[5] & 0x7f;
    let slot = this.udfSlot[code] - 1;
    if (slot < 0) {
      slot = this.udfNext;
      this.udfNext = (this.udfNext + 1) & 0x0f;
      for (let c = 0; c < this.udfSlot.length; c++) if (this.udfSlot[c] === slot + 1) this.udfSlot[c] = 0;
      this.udfSlot[code] = slot + 1;
    }
    const col = this.udfDots.subarray(slot * 5, slot * 5 + 5);
    col.fill(0);
    for (let row = 0; row < 7; row++) {
      for (let c = 0; c < 5; c++) {
        const i = row * 5 + c + 3;
        const bit = (d[4 - (i >> 3)] >> (i & 7)) & 1;
        col[c] |= bit << row;
      }
    }
  }

  cellGlyph(cell: number): Uint8Array | null {
    const c = this.chars[cell & 15];
    if (!(c & UDF_CELL)) return null;
    const slot = c & 0x0f;
    return this.udfDots.subarray(slot * 5, slot * 5 + 5);
  }

  text(): string {
    return [...this.chars]
      .map((c) => {
        if (c === 0x21) return '£';
        return c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ' ';
      })
      .join('');
  }

  setSerial(cs: boolean, clock: boolean, data: boolean): void {
    if (!cs) {
      this.enabled = false;
      return;
    }
    if (!this.enabled) {
      this.shift = 0;
      this.bits = 0;
      this.enabled = true;
      this.lastClock = clock;
      return;
    }
    if (clock === this.lastClock) return;
    this.lastClock = clock;
    if (clock) return;

    this.shift = ((this.shift << 1) | (data ? 1 : 0)) & 0xff;
    if (++this.bits === 8) {
      this.bits = 0;
      this.writeChar(this.shift);
      this.shift = 0;
    }
  }

  writeChar(data: number): void {
    this.writeCharRaw(data);
    this.sync();
    this.onByte?.(data & 0xff);
  }

  private writeCharRaw(data: number): void {
    data &= 0xff;
    this.trace[this.traceAt] = data;
    this.traceAt = (this.traceAt + 1) % this.trace.length;

    if (this.gfxLoad) {
      this.graphicsByte(data);
      return;
    }

    if (this.blankFlag) {
      this.duty = ((8 - data) * 4 - 1) & 0x1f;
      this.blankFlag = false;
      return;
    }

    if (this.scrollCollect) {
      if (data === 0) {
        this.scrollCollect = false;
        if (this.scrollCount !== 0) this.scrollLeft = this.scrollPeriod;
      } else if (this.scrollCount < this.scrollQueue.length) {
        this.scrollQueue[this.scrollCount++] = this.cellFor(data & 0x7f);
      }
      return;
    }

    if (this.fillOutside) {
      this.fillOutside = false;
      const v = this.asciiCharset ? data & 0x7f : fold6(data);
      const [ws, we] = this.window();
      for (let i = 0; i < 16; i++) if (i < ws || i > we) this.setCell(i, v);
      return;
    }

    if (this.customSkip > 0) {
      this.custom = ((this.custom >> 8) | (data << 8)) & 0xffff;
      if (--this.customSkip > 0) return;
      const slot = this.udfSlot[0];
      if (this.custom & 1 || !slot) this.place(0x20, true);
      else this.place(UDF_CELL | (slot - 1), true);
      return;
    }

    if (this.userDef > 0) {
      this.userDef--;
      if (this.modeCmdUserDef) {
        this.udfData[this.userDef] = data;
        if (this.userDef === 0) this.loadUserGlyph();
      }
      return;
    }

    if (!(data & 0x80)) {
      this.character(data & 0x7f);
      return;
    }

    switch (data & 0xf0) {
      case 0x80:
        if (data <= 0x83 && this.modeCmdUserDef) {
          if (data === 0x80) this.blank = 0xffff;
          else if (data === 0x81) this.blank |= ~this.windowMask() & 0xffff;
          else if (data === 0x82) this.blank |= this.windowMask();
          else this.blank = 0;
        } else if (data === 0x84) this.blankFlag = true;
        else if (data === 0x85 && this.modeCmdUserDef) this.extended = true;
        else if (data === 0x86 && this.modeCmdUserDef) {
          this.gfxBuffered = true;
          this.gfxPending = false;
        }
        break;
      case 0x90:
        this.cursor = data & 0x0f;
        this.scrollActive = false;
        if (this.mode === 2 && this.cursor >= this.windowEnd) this.scrollActive = true;
        else if (this.mode === 3 && this.cursor === this.windowStart) this.scrollActive = true;
        break;
      case 0xa0:
        if (this.modeCmdUserDef) {
          if (data === 0xa8) this.userDef = this.userDefBytes;
          else if (data === 0xae) this.gfxLoad = 1;
          else if (data === 0xa7) {
            this.scrollCollect = true;
            this.scrollCount = 0;
            this.scrollRead = 0;
          } else if (data === 0xaf) this.scrollLeft = 0;
          else if (data === 0xa6) {
            this.gfxAt = 0;
            this.gfxLeft = 96;
            this.gfxLoad = 3;
          } else if (data === 0xa4) {
            this.gfxBuffered = false;
            if (this.gfxPending) {
              this.gfxCol.set(this.shadow);
              this.gfxOn.fill(1);
            }
          } else if (data === 0xa5) {
            this.shadow.fill(0);
            if (this.gfxBuffered) this.gfxPending = true;
            else {
              this.clearCells(0, 16, true);
              this.gfxPending = false;
            }
          }
          else if (data <= 0xa3) this.mode = data & 0x03;
        } else {
          this.mode = data & 0x03;
        }
        break;
      case 0xb0:
        if (data > 0xb3 && this.modeCmdUserDef) {
          if (data === 0xb8) this.fillOutside = true;
          if (data === 0xbc && this.extended) {
            this.asciiCharset = true;
            this.udfSlot.fill(0);
            for (let k = 0; k < 16; k++) this.udfSlot[k] = k + 1;
          }
          break;
        }
        switch (data & 0x03) {
          case 0x01:
            if (this.windowSize > 0) this.clearCells(this.windowStart, this.windowEnd + 1);
            break;
          case 0x02:
            if (this.windowSize > 0) {
              this.clearCells(0, this.windowStart);
              this.clearCells(this.windowEnd, 16);
            }
            break;
          case 0x03:
            this.clearCells(0, 16);
            break;
        }
        break;
      case 0xc0:
        if (!this.modeCmdUserDef) break;
        this.flashRate = data & 0x0f;
        if (this.flashRate !== 0) this.flashLeft = this.flashBase * this.flashRate;
        break;
      case 0xd0: {
        if (!this.modeCmdUserDef) break;
        const wm = this.windowMask();
        const at = 1 << (this.cursor & 15);
        switch (data & 0x0f) {
          case 0x0: this.flashOn = false; this.flash = 0; break;
          case 0x1: if (wm) this.flash |= wm; break;
          case 0x2: if (wm) this.flash |= ~wm & 0xffff; break;
          case 0x3: this.flash = 0xffff; break;
          case 0x8: this.flash |= at; break;
          case 0x9: this.flash |= ~at & 0xffff; break;
        }
        break;
      }
      case 0xe0:
        this.v20Start = data & 0x0f;
        this.windowStart = data & 0x0f;
        this.windowSize = this.windowEnd - this.windowStart + 1;
        break;
      case 0xf0:
        this.v20End = data & 0x0f;
        this.windowEnd = data & 0x0f;
        this.windowSize = this.windowEnd - this.windowStart + 1;
        this.scrollActive = false;
        if (this.mode === 2 && this.cursor >= this.windowEnd) {
          this.scrollActive = true;
          this.cursor = this.windowEnd;
        }
        else if (this.mode === 3 && this.cursor === this.windowStart) this.scrollActive = true;
        break;
    }
  }

  private character(code: number): void {
    if (this.udfSlot[code]) {
      this.place(UDF_CELL | (this.udfSlot[code] - 1), true);
      return;
    }
    switch (code) {
      case 0x25:
        if (this.modeCmdUserDef) {
          this.flash |= 1 << (this.cursor & 15);
          return;
        }
        this.place(code, false);
        return;
      case 0x2c:
      case 0x2e:
        this.place(code, false);
        return;
      case 0x3a:
        if (!this.modeCmdUserDef) {
          this.userDef = this.userDefBytes;
          return;
        }
        if (!this.asciiCharset) {
          this.customSkip = 2;
          this.custom = 0;
          return;
        }
        break;
      case 0x3b:
        if (!this.asciiCharset) return;
        break;
      case 0x26:
        if (!this.asciiCharset) return;
        break;
    }
    this.place(this.asciiCharset ? code : fold6(code), true);
  }

  private place(ascii: number, move = true, change = true): void {
    if (!move) return;
    let mode = this.mode;
    if (this.windowSize <= 0 || this.windowSize > 16) {
      if (mode === 2) mode = 0;
      else if (mode === 3) mode = 1;
    }

    switch (mode) {
      case 0:
        this.cursor &= 0x0f;
        if (change) this.setCell(this.cursor, ascii);
        this.cursor = (this.cursor + 1) & 0x0f;
        break;
      case 1:
        this.cursor &= 0x0f;
        if (change) this.setCell(this.cursor, ascii);
        this.cursor = (this.cursor + 15) & 0x0f;
        break;
      case 2:
        if (this.cursor < this.windowEnd) {
          this.scrollActive = false;
          if (change) this.setCell(this.cursor, ascii);
          this.cursor++;
        } else {
          if (this.scrollActive) {
            for (let i = this.windowStart; i < this.windowEnd; i++) {
              this.moveCell(i, i + 1);
            }
          } else {
            this.scrollActive = true;
          }
          this.setCell(this.windowEnd, change ? ascii : 0);
        }
        break;
      case 3:
        if (this.cursor > this.windowStart) {
          if (change) this.setCell(this.cursor, ascii);
          this.cursor--;
        } else {
          if (this.scrollActive) {
            for (let i = this.windowEnd; i > this.windowStart; i--) {
              this.moveCell(i, i - 1);
            }
          } else {
            this.scrollActive = true;
          }
          this.setCell(this.windowStart, change ? ascii : 0);
        }
        break;
    }
  }
}
