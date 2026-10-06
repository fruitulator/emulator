import type { MachineDisplay } from '../machine/machine';
import { Msc1937 } from './msc1937';

export class EpochAlpha implements MachineDisplay {
  readonly kind = 'epochalpha' as const;

  private readonly vfd = new Msc1937();

  otherDisplayBytes = 0;
  private charBytes = 0;

  private data = 0;
  private control = 0;

  readonly dot = new EpochDotAlpha();

  get chars(): Uint8Array {
    return this.vfd.chars;
  }

  get dots(): Uint8Array {
    return this.vfd.dots;
  }

  get duty(): number {
    return this.vfd.duty;
  }

  clear(): void {
    this.vfd.reset();
    this.data = 0;
    this.control = 0xff;
    this.otherDisplayBytes = 0;
    this.charBytes = 0;
    this.dot.reset();
  }

  writeData(v: number): void {
    this.data = v & 0xff;
  }

  writeControl(v: number): void {
    const changed = (this.control ^ v) & 0xff;
    this.control = v & 0xff;
    if (changed & 2) this.dot.command = (v & 2) === 0;
    if (!(changed & 1)) return;
    if (!this.dot.command && (v & 2)) {
      this.vfd.writeByte(this.data);
      this.charBytes++;
    } else {
      this.dot.strobe(REV8[this.data]);
      this.otherDisplayBytes++;
    }
  }

  text(): string {
    if (this.charBytes === 0 && this.otherDisplayBytes > 0) return this.dot.text();
    return this.vfd.text();
  }
}

const REV8 = Uint8Array.from({ length: 256 }, (_, b) => {
  let r = 0;
  for (let i = 0; i < 8; i++) if (b & (1 << i)) r |= 0x80 >> i;
  return r;
});

export class EpochDotAlpha {
  readonly cells = new Uint32Array(16);
  readonly glyphs = new Uint8Array(40);
  size = 16;
  cursor = 0;
  brightness = 0;
  enabled = false;
  command = false;
  private mode = 0;
  private count = 0;
  private glyph = 0;
  private glyphCol = 0;

  reset(): void {
    this.clearCells();
    this.enabled = true;
    this.command = false;
    this.mode = 0;
    this.count = 0;
  }

  private clearCells(): void {
    this.cursor = 0;
    this.size = 16;
    this.glyph = 0;
    this.cells.fill(0);
    this.brightness = 0;
  }

  strobe(b: number): void {
    if (this.command) { this.doCommand(b); return; }
    if (this.count === 0) {
      if (this.mode === 0x10) {
        if (!this.enabled) return;
        this.cells[this.cursor] = (this.cells[this.cursor] & 0xffffff00) | b;
        this.advance();
      } else if (this.mode === 0x30) {
        const p = (b & 0x0f) === 1 ? 0x2e : (b & 0x0f) === 3 ? 0x2c : 0;
        this.cells[this.cursor] = (this.cells[this.cursor] & 0xffff00ff) | (p << 8);
        this.advance();
      }
      return;
    }
    if (this.mode === 0x20) {
      this.glyphs[this.glyph * 5 + this.glyphCol] = b;
      this.glyphCol++;
    }
    this.count--;
    if (this.count === 0 && this.mode === 0x20) {
      this.glyph = (this.glyph + 1) & 7;
      this.glyphCol = 0;
    }
  }

  private advance(): void {
    this.cursor++;
    if (this.cursor >= this.size) this.cursor = 0;
  }

  private doCommand(b: number): void {
    const n = b & 0x0f;
    switch (b >> 4) {
      case 0: this.mode = 0; if (b === 0) this.count = 5; break;
      case 1: this.mode = 0x10; this.count = 0; this.cursor = n; this.command = false; break;
      case 2: this.mode = 0x20; this.count = 5; this.command = false; this.glyph = b & 7; this.glyphCol = 0; break;
      case 3: this.mode = 0x30; this.cursor = n; this.command = false; break;
      case 4: if (n === 3) this.clearCells(); break;
      case 5: this.mode = 0x50; this.count = 0; this.brightness = (b - 1) & 7; break;
      case 6: this.mode = 0x60; this.count = 0; this.size = n === 0 ? 16 : n + 8; break;
      case 7:
        this.mode = 0x70;
        if (n === 0) for (let i = 0; i < this.size; i++) this.cells[i] &= ~0x20000;
        else if (n === 1) for (let i = 0; i < this.size; i++) this.cells[i] |= 0x20000;
        break;
      default: break;
    }
  }

  text(): string {
    let s = '';
    for (let i = 0; i < this.size; i++) {
      const c = this.cells[i] & 0xff;
      s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ' ';
    }
    return s;
  }
}
