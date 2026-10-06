import type { AutosaveTrigger } from '../emu-protocol';

export type SaveMoment = 'leave' | 'switch' | 'hidden' | 'pagehide';

export const PUSH_WAIT_MS = 3000;

export interface AutosaveSurface<B> {
  canSave(m: SaveMoment): boolean;
  leaving?(m: SaveMoment): void;
  keeps?(): boolean;
  cached?(): B | null;
  takesPush(): boolean;
  claimPush?(blob: B): Promise<void> | null;
  write(blob: B, reason: string): void | Promise<void>;
}

export interface AutosaveOptions {
  debounceMs?: number;
  awaitPush?: boolean;
}

export function pushReason(trigger: AutosaveTrigger | undefined): string {
  return trigger === 'clear-ram' ? 'clear RAM' : 'pause push';
}

export class PlayAutosave<B> {
  private last = 0;
  private readonly owed: Array<() => void> = [];

  constructor(
    private readonly surface: AutosaveSurface<B>,
    private readonly opts: AutosaveOptions = {},
  ) {}

  moment(m: SaveMoment, now: number = Date.now()): Promise<void> | null {
    const s = this.surface;
    if (!s.canSave(m)) return null;
    const gap = this.opts.debounceMs ?? 0;
    if (gap > 0) {
      if (now - this.last < gap) return null;
      this.last = now;
    }
    s.leaving?.(m);
    if (s.keeps && !s.keeps()) return null;
    const owed = this.opts.awaitPush ? this.expectPush() : null;
    const blob = s.cached?.();
    if (blob) void s.write(blob, m);
    return owed;
  }

  expectPush(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.owed.push(resolve);
      setTimeout(resolve, PUSH_WAIT_MS);
    });
  }

  pushed(blob: B, trigger?: AutosaveTrigger): void {
    const s = this.surface;
    const done = this.owed.shift();
    const claimed = s.claimPush?.(blob);
    if (claimed) { void claimed.finally(() => done?.()); return; }
    if (!s.takesPush()) { done?.(); return; }
    void Promise.resolve(s.write(blob, pushReason(trigger))).finally(() => done?.());
  }

  watchPage(win: Pick<Window, 'addEventListener'>): void {
    win.addEventListener('pagehide', () => { this.moment('pagehide'); });
  }
}
