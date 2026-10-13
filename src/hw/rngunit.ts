export class RngUnit {
  type: 0 | 1 | 2 = 0;
  seed = 0;
  private buf = new Uint8Array(9);
  private index = 0;
  private remaining = 0;

  private random256(): number {
    this.seed = (Math.imul(this.seed, 0x08088405) + 1) >>> 0;
    return this.seed >>> 24;
  }

  request(v: number): void {
    if (this.type !== 1) return;
    if (v !== 0x20 && v !== 0x47) return;
    const a = this.random256();
    const b = this.random256();
    this.buf[0] = a;
    this.buf[1] = b;
    this.buf[2] = ~a & 0xff;
    this.buf[3] = ~b & 0xff;
    this.remaining = 4;
    this.index = 0;
  }

  next(): number | null {
    if (this.type === 1) {
      if (!this.remaining) return null;
      this.remaining--;
      return this.buf[this.index++];
    }
    if (this.type === 2) {
      if (this.index === 0) {
        this.buf.set([4, 3, 2, 1]);
        for (let i = 4; i < 8; i++) this.buf[i] = this.random256();
        this.buf[8] = 0;
      }
      const v = this.buf[this.index++];
      if (this.index === 9) this.index = 0;
      return v;
    }
    return null;
  }
}
