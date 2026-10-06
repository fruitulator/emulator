
export const STALL_MS = 100;

const LINE_EVERY_MS = 1000;

export class StallWatch {
  private lastBeat = NaN;
  private readonly parts = new Map<string, number>();
  private lastLineAt = -Infinity;
  private heldBack = 0;
  private heldBackMs = 0;

  constructor(private readonly who: string) {}

  charge(part: string, ms: number): void {
    if (ms > 0) this.parts.set(part, (this.parts.get(part) ?? 0) + ms);
  }

  forget(): void {
    this.lastBeat = NaN;
    this.parts.clear();
  }

  beat(now: number, extra = ''): string | null {
    const gap = Number.isNaN(this.lastBeat) ? 0 : now - this.lastBeat;
    this.lastBeat = now;
    const parts = [...this.parts];
    this.parts.clear();
    if (gap <= STALL_MS) return null;
    if (now - this.lastLineAt < LINE_EVERY_MS) {
      this.heldBack++;
      this.heldBackMs += gap;
      return null;
    }
    this.lastLineAt = now;
    let ours = 0;
    const named: string[] = [];
    for (const [part, ms] of parts.sort((a, b) => b[1] - a[1])) {
      ours += ms;
      if (ms >= 1) named.push(`${part} ${Math.round(ms)} ms`);
    }
    named.push(`outside our own work ${Math.max(0, Math.round(gap - ours))} ms`);
    let text = `${this.who} held up ${Math.round(gap)} ms: ${named.join(', ')}`;
    if (extra) text += ` ${extra}`;
    if (this.heldBack) {
      text += ` (and ${this.heldBack} more since the last line, ${Math.round(this.heldBackMs)} ms in all)`;
      this.heldBack = 0;
      this.heldBackMs = 0;
    }
    return text;
  }
}
