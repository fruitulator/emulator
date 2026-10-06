export class H8Port {
  private ddr: number;
  private dr = 0;
  private pcr = 0;

  input = 0;

  inputSource: (() => number) | null = null;

  forcedInputs = 0;

  onOutput: ((data: number, driven: number) => void) | null = null;

  private lastOutput = -1;

  constructor(private readonly mask: number, private readonly defaultDdr: number) {
    this.ddr = defaultDdr;
  }

  reset(): void {
    this.dr = 0;
    this.ddr = this.defaultDdr;
    this.pcr = 0;
    this.lastOutput = -1;
    this.updateOutput();
  }

  ddrR(): number { return 0xff; }

  ddrW(data: number): void {
    this.ddr = data & 0xff;
    this.updateOutput();
  }

  drR(): number { return (this.dr | this.mask) & 0xff; }

  drW(data: number): void {
    this.dr = data & 0xff;
    this.updateOutput();
  }

  portR(): number {
    let res = this.mask | (this.dr & ~this.forcedInputs & this.ddr);
    if ((this.ddr & ~this.mask & 0xff) !== (~this.mask & 0xff) || this.forcedInputs) {
      const live = this.inputSource ? this.inputSource() : this.input;
      res |= live & (this.forcedInputs | ~this.ddr);
    }
    return res & 0xff;
  }

  levels(pulled: number): number {
    return ((this.dr & this.ddr) | (pulled & ~this.ddr)) & 0xff;
  }

  pcrR(): number { return (this.pcr | this.mask) & 0xff; }

  pcrW(data: number): void { this.pcr = data & 0xff; }

  private updateOutput(): void {
    const data = (this.dr | ~this.ddr) & ~this.mask & 0xff;
    const driven = this.ddr & ~this.mask & 0xff;
    const res = (driven << 8) | data;
    if (res !== this.lastOutput) {
      this.lastOutput = res;
      this.onOutput?.(data, driven);
    }
  }
}
