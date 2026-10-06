
const PITCH_WORDS = 0x400;
const VRAM_BYTES = 0x1000000;
const BUSY_CYCLES = 2500;
const IRQ_FIRST = 1_000_000;
const IRQ_PERIOD = 50_000;
const REDRAW_A = 2_000_000;
const REDRAW_B = 400_000;
const LAYER_SPAN = 0x12c000;
export const YGV_TRANSPARENT = 0xf81e;
const LONG_REGS = new Set([0x58, 0x5c, 0x60, 0x64, 0xac]);

const swap16 = (v: number): number => ((v & 0xff) << 8) | ((v >> 8) & 0xff);
const s16 = (v: number): number => (v << 16) >> 16;

export function ygvColour(w: number): number {
  return (0xff000000 | (((w >> 11) & 31) << 19) | (((w >> 6) & 31) << 11) | ((w & 31) << 3)) >>> 0;
}

export class Ygv619 {
  readonly vram = new Uint16Array(VRAM_BYTES / 2);
  frame: Uint32Array;
  frameSerial = 0;
  width: number;
  height: number;

  private srcY = 0; private srcX = 0; private dstY = 0; private dstX = 0;
  private rows = 0; private widthBytes = 0; private widthPx = 0;
  private key = 0; private fg = 0; private bg = 0; private mode = 0;
  private srcBase = 0; private dstBase = 0;
  layerA = 0; layerB = 0; layerC = 0;

  private busyLeft = 0;
  private armed = false;
  private irqFlag = false;
  private irqLeft = 0;
  private redrawA = 0;
  private redrawB = 0;
  private xferAt = 0;
  private xferCount = -1;
  private readonly longHi = new Uint16Array(0x200);

  constructor(width = 640, height = 480, private readonly onIrq: () => void = () => {}) {
    this.width = width;
    this.height = height;
    this.frame = new Uint32Array(width * height);
  }

  reset(): void {
    this.vram.fill(0);
    this.srcY = this.srcX = this.dstY = this.dstX = 0;
    this.rows = this.widthBytes = this.widthPx = 0;
    this.key = this.fg = this.bg = this.mode = 0;
    this.srcBase = this.dstBase = 0;
    this.layerA = this.layerB = this.layerC = 0;
    this.busyLeft = 0;
    this.armed = false;
    this.irqFlag = false;
    this.irqLeft = 0;
    this.redrawA = this.redrawB = 0;
    this.xferCount = -1;
    this.longHi.fill(0);
    this.frame.fill(0);
    this.frameSerial = 0;
  }

  get irq(): boolean {
    return this.irqFlag;
  }

  get busy(): boolean {
    return this.busyLeft > 0;
  }

  read8(_off: number): number {
    return 0xff;
  }

  read16(off: number): number {
    if (off === 0x5a) return this.irqFlag ? 2 : 0;
    if (off === 0x5e) return this.busyLeft > 0 ? 8 : 0;
    return 0;
  }

  write8(off: number, v: number): void {
    if (off === 0x2b) { this.armed = true; return; }
    if (off !== 0x8f) return;
    if (v === 0) { this.fill(); this.commandDone(true); }
    else if (v === 3) { this.copy(); this.commandDone(true); }
    else if (v === 4) {
      this.xferAt = this.dstWord(this.dstBase, this.dstX, this.dstY);
      this.xferCount = 0;
      this.irqLeft = IRQ_FIRST;
    }
  }

  write16(off: number, v: number): void {
    if (LONG_REGS.has(off)) { this.longHi[off] = v; return; }
    if (LONG_REGS.has(off - 2)) {
      this.write32(off - 2, ((this.longHi[off - 2] << 16) | v) >>> 0);
      return;
    }
    switch (off) {
      case 0x68: this.srcY = s16(v); break;
      case 0x6a: this.srcX = s16(v); break;
      case 0x6c: this.dstY = s16(v); break;
      case 0x6e: this.dstX = s16(v); break;
      case 0x70: this.rows = v; break;
      case 0x72: this.widthBytes = v; this.widthPx = v >> 1; break;
      case 0x82: this.key = v; break;
      case 0x84: this.fg = v; break;
      case 0x86: this.bg = v; break;
      case 0x8a: this.mode = swap16(v); break;
    }
  }

  write32(off: number, v: number): void {
    switch (off) {
      case 0x58: if (v & 2) { this.irqFlag = false; this.onIrq(); } break;
      case 0x60: this.srcBase = (v + 0x80000000) >>> 0; break;
      case 0x64: this.dstBase = (v + 0x80000000) >>> 0; break;
      case 0xac: this.dataPort(v); break;
    }
  }

  vramRead8(off: number): number {
    const w = this.vram[(off & 0xffffff) >> 1];
    return off & 1 ? w & 0xff : w >> 8;
  }

  vramRead16(off: number): number {
    return this.vram[(off & 0xffffff) >> 1];
  }

  vramWrite8(off: number, v: number): void {
    const i = (off & 0xffffff) >> 1;
    this.vram[i] = off & 1 ? (this.vram[i] & 0xff00) | v : (this.vram[i] & 0xff) | (v << 8);
  }

  vramWrite16(off: number, v: number): void {
    if (off >= 0x100) { this.vram[(off & 0xffffff) >> 1] = v; return; }
    if (off === 0x10 || off === 0x30 || off === 0x50) { this.longHi[0x100 + off] = v; return; }
    if (off === 0x12 || off === 0x32 || off === 0x52) {
      this.layerWrite32(off - 2, ((this.longHi[0x100 + off - 2] << 16) | v) >>> 0);
    }
  }

  private layerWrite32(off: number, v: number): void {
    const base = (v & 0x7fffffff) >>> 0;
    let changed = false;
    if (off === 0x30) { this.redrawA = 0; changed = base !== this.layerA; this.layerA = base; }
    else if (off === 0x10) { this.redrawB = 0; changed = base !== this.layerB; this.layerB = base; }
    else { changed = base !== this.layerC; this.layerC = base; }
    if (changed) this.redraw();
  }

  private dstWord(base: number, x: number, y: number): number {
    return (((base + x + y * 0x800) & 0xffffff) >>> 0) >> 1;
  }

  private fill(): void {
    let at = this.dstWord(this.dstBase, this.dstX, this.dstY);
    const pairs = this.widthPx >> 1;
    for (let r = 0; r < this.rows; r++, at += PITCH_WORDS) {
      for (let i = 0; i < pairs * 2; i++) this.vram[(at + i) & 0x7fffff] = this.fg;
    }
  }

  private copy(): void {
    let src = this.dstWord(this.srcBase, this.srcX, this.srcY);
    let dst = this.dstWord(this.dstBase, this.dstX, this.dstY);
    let skipRows = 0;
    if (this.dstY < 0) {
      src += -this.dstY * PITCH_WORDS;
      dst += -this.dstY * PITCH_WORDS;
      skipRows = -this.dstY;
    }
    let rows = this.rows;
    if (this.dstY + this.rows > 600) rows = this.rows - (this.dstY + this.rows - 600);
    const first = this.dstX < 0 ? -this.dstX >> 1 : 0;
    let cols = this.widthPx;
    if (this.dstX + this.widthBytes > 0x800) cols = (this.widthBytes - (this.dstX + this.widthBytes - 0x800)) >> 1;
    for (let r = rows - skipRows; r > 0; r--, src += PITCH_WORDS, dst += PITCH_WORDS) {
      for (let c = first; c < cols; c++) {
        const p = this.vram[(src + c) & 0x7fffff];
        if (p !== this.key) this.vram[(dst + c) & 0x7fffff] = p;
      }
    }
  }

  private dataPort(v: number): void {
    if (this.xferCount < 0 || this.xferCount >= this.rows * 2) return;
    if ((this.xferCount & 1) === 0) {
      if (v !== 0 || this.mode === 4) this.expand(v);
      this.xferAt += PITCH_WORDS;
    }
    this.xferCount++;
    if (this.xferCount === this.rows * 2) this.scheduleRedraw();
  }

  private expand(v: number): void {
    const n = this.widthPx & 0xff;
    const at = this.xferAt;
    if (this.mode === 4) {
      for (let i = 0; i < n; i++) {
        const bit = i < 32 ? (v << i) & 0x80000000 : 0;
        this.vram[(at + i) & 0x7fffff] = bit ? this.fg : this.bg;
      }
      return;
    }
    let bits = v >>> 0;
    for (let left = n; bits !== 0 && left > 0; left--) {
      const b = 31 - Math.clz32(bits);
      bits = (bits & ~(1 << b)) >>> 0;
      this.vram[(at + (b ^ 31)) & 0x7fffff] = this.fg;
    }
  }

  private commandDone(busy: boolean): void {
    this.irqLeft = IRQ_FIRST;
    if (busy) this.busyLeft = BUSY_CYCLES;
    this.scheduleRedraw();
  }

  private scheduleRedraw(): void {
    const d = this.dstBase;
    const a = this.layerA || 0x10000;
    if (d >= a && d < a + LAYER_SPAN) this.redrawA = REDRAW_A;
    else if (d >= this.layerB && d < this.layerB + LAYER_SPAN) this.redrawB = REDRAW_B;
  }

  tick(cycles: number): void {
    if (this.busyLeft > 0) this.busyLeft -= cycles;
    let redraw = false;
    if (this.redrawA > 0 && (this.redrawA -= cycles) < 1) redraw = true;
    if (this.redrawB > 0 && (this.redrawB -= cycles) < 1) redraw = true;
    if (redraw) this.redraw();
    if (this.armed && (this.irqLeft -= cycles) < 1) {
      this.irqLeft += IRQ_PERIOD;
      if (!this.irqFlag) { this.irqFlag = true; this.onIrq(); }
    }
  }

  redraw(): void {
    if (this.layerA === 0) this.layerA = 0x10000;
    const a = (this.layerA & 0xffffff) >> 1;
    const b = (this.layerB & 0xffffff) >> 1;
    const w = this.width;
    const h = this.height;
    const out = this.frame;
    let changed = false;
    let o = 0;
    const put = (i: number) => {
      let p = this.vram[(b + i) & 0x7fffff];
      if (p === YGV_TRANSPARENT) p = this.vram[(a + i) & 0x7fffff];
      const c = ygvColour(p);
      if (out[o] !== c) { out[o] = c; changed = true; }
      o++;
    };
    if (w < h) {
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) put(c * PITCH_WORDS + (h - r));
    } else {
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) put(r * PITCH_WORDS + c);
    }
    if (changed) this.frameSerial++;
  }
}
