export class Sc5Volume {
  static readonly ADDRESS = 0x20;

  private command = 0;
  private index = 0;
  level = 0xff;

  onLevel: ((level: number) => void) | null = null;

  select(): void {
    this.index = 0;
  }

  write(v: number): void {
    v &= 0xff;
    const i = this.index++;
    if (i === 0) { this.command = v; return; }
    if (i !== 1 || this.command !== 3) return;
    this.level = v === 0x7f ? 0 : 0xff - 5 * v;
    this.onLevel?.(this.level);
  }
}
