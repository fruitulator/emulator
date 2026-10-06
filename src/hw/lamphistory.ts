
export const LAMP_FULL = 0xff;
export const LAMP_DIM = 0x3c;

export const LAMP_CLASS = Uint8Array.of(
  0, 0, 0, 1,
  0, 2, 1, 1,
  0, 0, 2, 1,
  0, 1, 1, 1,
);

export class LampHistory {
  readonly history: Uint8Array;
  readonly level: Uint8Array;

  constructor(lamps: number) {
    this.history = new Uint8Array(lamps);
    this.level = new Uint8Array(lamps);
  }

  reset(): void {
    this.history.fill(0);
    this.level.fill(0);
  }

  write(n: number, bit: number): boolean {
    const h = ((this.history[n] << 1) | (bit & 1)) & 0x0f;
    this.history[n] = h;
    const was = this.level[n];
    let now = was;
    switch (LAMP_CLASS[h]) {
      case 0:
        now = 0;
        break;
      case 1:
        now = LAMP_FULL;
        break;
      default:
        now = LAMP_DIM;
        break;
    }
    if (now === was) return false;
    this.level[n] = now;
    return true;
  }

  writeByte(base: number, data: number): boolean {
    let changed = false;
    for (let i = 0; i < 8; i++) if (this.write(base + i, (data >> i) & 1)) changed = true;
    return changed;
  }
}
