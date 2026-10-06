export class StatedLines {
  private readonly owned: Uint8Array;
  private readonly level: Uint8Array;

  constructor(strobes: number) {
    this.owned = new Uint8Array(strobes);
    this.level = new Uint8Array(strobes);
  }

  state(strobe: number, mask: number, value: number): void {
    if (strobe < 0 || strobe >= this.owned.length) return;
    this.owned[strobe] |= mask & 0xff;
    this.level[strobe] = (this.level[strobe] & ~mask) | (value & mask);
  }

  stateLine(id: number, on: boolean): void {
    const mask = 1 << (id & 7);
    this.state(id >> 3, mask, on ? mask : 0);
  }

  reassert(...images: Uint8Array[]): void {
    for (const img of images) {
      const n = Math.min(img.length, this.owned.length);
      for (let i = 0; i < n; i++) {
        const m = this.owned[i];
        if (m) img[i] = (img[i] & ~m) | (this.level[i] & m);
      }
    }
  }
}
