
export interface LookWork {
  apply(): void;
  showTrim(): void;
  rebuild(): void;
  save(): void;
}

export function settleLook(done: boolean, work: LookWork): void {
  if (!done) return;
  work.apply();
  work.showTrim();
  work.rebuild();
  work.save();
}

export class NudgeRun {
  private pending = false;

  constructor(private readonly settle: () => void) {}

  down(move: () => void): void {
    move();
    this.pending = true;
  }

  up(): void {
    if (!this.pending) return;
    this.pending = false;
    this.settle();
  }
}

export const LIVE_MS = 100;

export class LiveLook {
  private last = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly run: () => void, private readonly now: () => number = () => performance.now(),
    private readonly ms = LIVE_MS) {}

  move(): void {
    const t = this.now();
    if (t - this.last >= this.ms) {
      this.cancel();
      this.last = t;
      this.run();
      return;
    }
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.last = this.now();
      this.run();
    }, this.ms - (t - this.last));
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
