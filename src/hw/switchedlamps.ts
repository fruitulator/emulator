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
    this.writeAt(0, this.count, bits);
  }

  writeAt(first: number, n: number, bits: number): boolean {
    let switched = false;
    for (let k = 0; k < n; k++) {
      const i = first + k;
      if (i >= this.count) break;
      const on = (bits >> k) & 1;
      if (on && !this.state[i]) {
        this.state[i] = 1;
        this.shown[i] = 0xff;
        switched = true;
      } else if (!on && this.state[i]) {
        this.state[i] = 0;
        this.shown[i] = 0;
        switched = true;
      }
    }
    return switched;
  }
}
