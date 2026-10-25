export class T6963c {
  readonly ram = new Uint8Array(0x10000);
  private data = 0;
  private adp = 0;
  private auto = 0;
  private graphicHome = 0;
  private textHome = 0;
  private graphicArea = 0;
  private textArea = 0;
  private cgramOffset = 0;
  private mode = 0;
  displayMode = 0;
  private readData = 0;
  textRomUsed = false;

  reset(): void {
    this.auto = 0;
    this.data = 0;
    this.adp = 0;
    this.graphicHome = 0;
    this.textHome = 0;
    this.graphicArea = 0;
    this.textArea = 0;
    this.cgramOffset = 0;
    this.mode = 0;
    this.displayMode = 0;
  }

  read(cd: number): number {
    return cd ? 0x2b : this.readData;
  }

  write(cd: number, v: number): void {
    if (cd) { this.command(v & 0xff); return; }
    if (this.auto === 1) {
      this.ram[this.adp] = v;
      this.adp = (this.adp + 1) & 0xffff;
    } else {
      this.data = ((v & 0xff) << 8) | (this.data >> 8);
    }
  }

  get on(): boolean {
    return (this.displayMode & 0x0c) !== 0;
  }

  private command(c: number): void {
    if ((c & 0xf0) === 0x20) {
      if ((c & 0x0f) === 0x02) this.cgramOffset = (this.data & 0x1f) << 11;
      else if ((c & 0x0f) === 0x04) this.adp = this.data;
    } else if ((c & 0xfd) === 0x40) {
      if (c & 2) this.graphicHome = this.data;
      else this.textHome = this.data;
    } else if ((c & 0xfd) === 0x41) {
      if (c & 2) this.graphicArea = this.data;
      else this.textArea = this.data;
    } else if ((c & 0xf0) === 0x80) {
      this.mode = c & 0x0f;
    } else if ((c & 0xf0) === 0x90) {
      this.displayMode = c & 0x0f;
    } else if ((c & 0xfe) === 0xb0) {
      this.auto = c & 1 ? 2 : 1;
    } else if (c === 0xb2) {
      this.auto = 0;
    } else if ((c & 0xf0) === 0xc0) {
      if (c & 1) this.readData = this.ram[this.adp];
      else this.ram[this.adp] = this.data >> 8;
      if ((c & 0x0e) === 0x00) this.adp = (this.adp + 1) & 0xffff;
      else if ((c & 0x0e) === 0x02) this.adp = (this.adp - 1) & 0xffff;
    } else if ((c & 0xf0) === 0xf0) {
      const bit = 1 << (c & 7);
      if (c & 8) this.ram[this.adp] |= bit;
      else this.ram[this.adp] &= ~bit;
    }
  }

  render(out: Uint8Array, width: number, lines: number, fontWidth: number): void {
    out.fill(0);
    const stride = width >> 3;
    const height = lines * 8;
    const put = (x: number, y: number, pix: number, op: number): void => {
      if (x >= width || y >= height) return;
      const i = y * stride + (x >> 3);
      const b = 0x80 >> (x & 7);
      const cur = out[i] & b ? 1 : 0;
      const v = op === 1 ? cur ^ pix : op === 3 ? cur & pix : cur | pix;
      out[i] = v ? out[i] | b : out[i] & ~b;
    };
    if (this.displayMode & 0x04) {
      let offs = this.textHome;
      for (let y = 0; y < lines; y++) {
        for (let x = 0; x < this.textArea; x++) {
          const c = this.ram[offs++ & 0xffff];
          const fromRom = !(this.mode & 8) && c < 0x80;
          if (fromRom) { this.textRomUsed = true; continue; }
          const base = this.mode & 8 ? this.cgramOffset + c * 8 : this.cgramOffset + (c & 0x7f) * 8;
          for (let cy = 0; cy < 8; cy++) {
            const d = this.ram[(base + cy) & 0xffff];
            for (let cx = 0; cx < fontWidth; cx++) put(x * fontWidth + cx, y * 8 + cy, (d >> (fontWidth - 1 - cx)) & 1, 0);
          }
        }
      }
    }
    if (this.displayMode & 0x08) {
      const op = this.mode & 7;
      if (!(this.displayMode & 0x04) && fontWidth === 8) {
        if (op === 3) return;
        const n = Math.min(this.graphicArea, stride);
        for (let y = 0; y < height; y++) {
          const src = (this.graphicHome + y * this.graphicArea) & 0xffff;
          for (let x = 0; x < n; x++) out[y * stride + x] = this.ram[(src + x) & 0xffff];
        }
        return;
      }
      let offs = this.graphicHome;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < this.graphicArea; x++) {
          const d = this.ram[offs++ & 0xffff];
          for (let i = 0; i < fontWidth; i++) put(x * fontWidth + i, y, (d >> (fontWidth - 1 - i)) & 1, op);
        }
      }
    }
  }
}
