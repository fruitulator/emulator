
export interface I8279Hooks {
  rowRead?(row: number): number;
}

export class I8279 {
  readonly dram = new Uint8Array(16);

  private sensorInc = false;
  private displayInc = false;
  private sPtr = 0;
  private dPtr = 0;
  private readSensor = false;

  constructor(private readonly hooks: I8279Hooks = {}, private readonly isChip1 = true) {
    this.reset();
  }

  reset(): void {
    this.sensorInc = false;
    this.displayInc = false;
    this.sPtr = 0;
    this.dPtr = 0;
    this.dram.fill(0);
  }

  get displayPointer(): number { return this.dPtr; }

  read(a0: number): number {
    if (a0 & 1) return 0;
    if (this.readSensor && this.isChip1) {
      const v = this.hooks.rowRead ? this.hooks.rowRead(this.sPtr) & 0xff : 0;
      if (this.sensorInc) this.sPtr = (this.sPtr + 1) & 7;
      return v;
    }
    const v = this.dram[this.dPtr];
    if (this.displayInc) this.dPtr = (this.dPtr + 1) & 15;
    return v;
  }

  write(a0: number, value: number): void {
    const v = value & 0xff;
    if (!(a0 & 1)) {
      this.dram[this.dPtr] = v;
      if (this.displayInc) this.dPtr = (this.dPtr + 1) & 15;
      return;
    }
    switch (v >> 5) {
      case 2:
        this.sPtr = v & 7;
        this.sensorInc = (v & 0x10) !== 0;
        this.readSensor = true;
        break;
      case 3:
        this.dPtr = v & 15;
        this.displayInc = (v & 0x10) !== 0;
        this.readSensor = false;
        break;
      case 4:
        this.dPtr = v & 15;
        this.displayInc = (v & 0x10) !== 0;
        break;
      case 6:
        if (v === 0xc1) this.dram.fill(0);
        break;
      default:
        break;
    }
  }
}
