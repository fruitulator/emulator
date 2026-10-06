export class SwitchedLamps {
  readonly state: Uint8Array;
  readonly shown: Uint8Array;

  constructor(readonly count: number) {
    this.state = new Uint8Array(count);
    this.shown = new Uint8Array(count).fill(0xff);
  }

  reset(): void {
    this.state.fill(0);
    this.shown.fill(0xff);
  }

  resetDark(): void {
    this.state.fill(0);
    this.shown.fill(0);
  }

  write(bits: number): void {
    for (let k = 0; k < this.count; k++) {
      const on = (bits >> k) & 1;
      if (on && !this.state[k]) {
        this.state[k] = 1;
        this.shown[k] = 0xff;
      } else if (!on && this.state[k]) {
        this.state[k] = 0;
        this.shown[k] = 0;
      }
    }
  }
}
