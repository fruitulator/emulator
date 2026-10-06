
export const Z80_DAISY_INT = 0x01;
export const Z80_DAISY_IEO = 0x02;

export interface Z80DaisyDevice {
  daisyIrqState(): number;
  daisyIrqAck(): number;
  daisyIrqReti(): void;
}

export class Z80DaisyChain {
  constructor(private readonly devices: readonly Z80DaisyDevice[]) {}

  get irq(): boolean {
    for (const d of this.devices) {
      const s = d.daisyIrqState();
      if (s & Z80_DAISY_INT) return true;
      if (s & Z80_DAISY_IEO) return false;
    }
    return false;
  }

  ack(): number {
    for (const d of this.devices) {
      if (d.daisyIrqState() & Z80_DAISY_INT) return d.daisyIrqAck() & 0xff;
    }
    return 0xff;
  }

  reti(): void {
    for (const d of this.devices) {
      if (d.daisyIrqState() & Z80_DAISY_IEO) {
        d.daisyIrqReti();
        return;
      }
    }
  }
}
