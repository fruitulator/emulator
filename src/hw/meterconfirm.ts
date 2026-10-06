export const METER_HOLD_TICKS = 5;

export class MeterConfirm {
  word = 0;
  readonly hold = new Uint8Array(16);
  pending = 0;
  acc = 0;
  shortPulses = 0;

  write(word: number): void {
    word &= 0xffff;
    const changed = word ^ this.word;
    if (changed === 0) return;
    for (let i = 0, bit = 1; i < 16; i++, bit <<= 1) {
      if (!(changed & bit)) continue;
      if (word & bit) {
        this.hold[i] = METER_HOLD_TICKS;
        this.pending |= bit;
      } else {
        if (this.hold[i] !== 0) this.shortPulses++;
        this.hold[i] = 0;
        this.pending &= ~bit;
      }
    }
    this.word = word;
  }

  tick(): number {
    if (this.pending === 0) return 0;
    let confirmed = 0;
    for (let i = 0, bit = 1; i < 16; i++, bit <<= 1) {
      if (!(this.pending & bit) || this.hold[i] === 0) continue;
      if (--this.hold[i] !== 0) continue;
      this.pending &= ~bit;
      confirmed |= bit;
    }
    return confirmed;
  }

  advance(units: number, period: number): number {
    this.acc += units;
    if (this.acc < period) return 0;
    let confirmed = 0;
    while (this.acc >= period) {
      this.acc -= period;
      confirmed |= this.tick();
    }
    return confirmed;
  }

  reset(): void {
    this.word = 0;
    this.hold.fill(0);
    this.pending = 0;
  }
}
