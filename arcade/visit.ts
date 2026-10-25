import type { CashLedger } from '../src/machine/machine';
import type { StateRec } from '../web/store';

export const PLAY_CLAIM_MS = 3000;

export function moneyMoved(from: CashLedger | null, to: CashLedger | null): boolean {
  if (!from || !to) return false;
  return from.inPence !== to.inPence || from.outPence !== to.outPence || from.unpricedOut !== to.unpricedOut
    || from.tokenInPence !== to.tokenInPence || from.tokenOutPence !== to.tokenOutPence
    || from.unpricedTokenOut !== to.unpricedTokenOut || (from.unpricedTokenIn ?? 0) !== (to.unpricedTokenIn ?? 0)
    || (from.unpricedIn ?? 0) !== (to.unpricedIn ?? 0)
    || (from.euroInCents ?? 0) !== (to.euroInCents ?? 0) || (from.euroOutCents ?? 0) !== (to.euroOutCents ?? 0);
}

export class ClaimTrigger {
  private pressedAt = -Infinity;

  pressed(at: number): void { this.pressedAt = at; }

  reels(at: number, moved: boolean, booted: boolean): boolean {
    return moved && booted && at - this.pressedAt <= PLAY_CLAIM_MS;
  }
}

export function walkUpStart(rec: Pick<StateRec, 'stamp' | 'nvram'>, stamp: string): 'resume' | 'battery' | 'fresh' {
  if (rec.stamp === undefined || rec.stamp === stamp) return 'resume';
  return rec.nvram && rec.nvram.length > 0 ? 'battery' : 'fresh';
}
