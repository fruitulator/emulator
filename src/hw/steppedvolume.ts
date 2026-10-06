export class SteppedVolume {
  count = 0;
  level = 0xff;

  constructor(private readonly steps: number) {}

  step(up: boolean): number {
    if (up) { if (this.count < this.steps) this.count++; } else if (this.count > 0) this.count--;
    return this.set(this.counted());
  }

  counted(): number {
    return Math.trunc((this.count * 0xff) / this.steps);
  }

  set(level: number): number {
    this.level = level;
    return level;
  }
}

export interface LevelTarget {
  setGain(g: number): void;
}

export function setBoardLevel(level: number, chips: readonly (LevelTarget | null | undefined)[]): void {
  const g = level / 0xff;
  for (const c of chips) c?.setGain(g);
}

export function isClassicLayout(layoutName: string | undefined): boolean {
  return /\.dat$/i.test(layoutName ?? '');
}

export function v9Sc4Gain(count: number): number {
  return 10 ** ((count * 30 - 3000) / 2000);
}
