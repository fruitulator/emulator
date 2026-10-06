export class Sc5E2rom {
  static readonly ADDRESS = 0x36;

  readonly data = new Uint8Array(256).fill(0xff);

  private command = 0;
  private pointer = 0;
  private index = 0;

  select(write: boolean): void {
    if (write) this.index = 0;
  }

  write(v: number): void {
    v &= 0xff;
    const i = this.index++;
    if (i === 0) { this.command = v; return; }
    if (i === 1) { this.pointer = v; return; }
    if (this.command === 0xa3) return;
    this.data[this.pointer] = v;
    this.pointer = (this.pointer + 1) & 0xff;
  }

  read(): number {
    if (this.command === 0x38) return 0;
    const v = this.data[this.pointer];
    this.pointer = (this.pointer + 1) & 0xff;
    return v;
  }

  load(image: Uint8Array): void {
    this.data.fill(0xff);
    this.data.set(image.subarray(0, this.data.length));
  }
}
