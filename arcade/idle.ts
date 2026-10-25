import { str } from '../web/i18n';

export const IDLE_NO_CREDIT_MS = 60_000;
export const IDLE_WITH_CREDIT_MS = 5 * 60_000;
export const STILL_PLAYING_ANSWER_MS = 30_000;

export const STILL_PLAYING_TEXT = str('arcade.idle.are_you_still_playing');
export const CARRY_ON_BUTTON = str('arcade.idle.continue_playing');
export function stillPlayingText(leftMs: number): string {
  const s = Math.max(1, Math.ceil(leftMs / 1000));
  return `${STILL_PLAYING_TEXT} ${s} ${s === 1 ? 'second' : 'seconds'} left.`;
}

export interface IdleLimits { noCreditMs: number; creditMs: number; answerMs: number }

export const IDLE_LIMITS: IdleLimits = {
  noCreditMs: IDLE_NO_CREDIT_MS, creditMs: IDLE_WITH_CREDIT_MS, answerMs: STILL_PLAYING_ANSWER_MS,
};

export function idleLimitsFrom(search: string, dev: boolean): IdleLimits {
  if (!dev) return IDLE_LIMITS;
  const v = new URLSearchParams(search).get('idle');
  if (!v) return IDLE_LIMITS;
  const parts = v.split(',');
  const sec = (i: number, fallback: number): number => {
    const t = parts[i]?.trim();
    if (!t) return fallback;
    const n = Number(t);
    return Number.isFinite(n) && n >= 1 && n <= 3600 ? Math.round(n * 1000) : fallback;
  };
  return { noCreditMs: sec(0, IDLE_NO_CREDIT_MS), creditMs: sec(1, IDLE_WITH_CREDIT_MS), answerMs: sec(2, STILL_PLAYING_ANSWER_MS) };
}

export type IdleState = { kind: 'playing' } | { kind: 'ask'; leftMs: number } | { kind: 'release' };

export class IdleClock {
  private last: number;
  private askedAt: number | null = null;

  constructor(private readonly limits: IdleLimits, at: number) {
    this.last = at;
  }

  active(at: number): void {
    this.last = at;
    this.askedAt = null;
  }

  carryOn(at: number): void { this.active(at); }

  get asking(): boolean { return this.askedAt !== null; }

  tick(at: number, credit: boolean): IdleState {
    if (this.askedAt === null) {
      const limit = credit ? this.limits.creditMs : this.limits.noCreditMs;
      if (at - this.last < limit) return { kind: 'playing' };
      this.askedAt = at;
    }
    const left = this.askedAt + this.limits.answerMs - at;
    return left > 0 ? { kind: 'ask', leftMs: left } : { kind: 'release' };
  }
}

export class CreditSign {
  private moneyAt = -Infinity;
  private reelsAt = -Infinity;

  moneyIn(at: number): void { this.moneyAt = at; }
  reels(at: number): void { this.reelsAt = at; }

  get credit(): boolean { return this.moneyAt > this.reelsAt; }
}
