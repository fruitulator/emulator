
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
