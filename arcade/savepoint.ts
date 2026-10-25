
export const SETTLE_MS = 3000;

export const MONEY_QUIET_MS = 1500;

export interface Activity {
  reels: boolean;
  money: boolean;
  mech: boolean;
  alarm: boolean;
  held: boolean;
}

export const busy = (a: Activity): boolean => a.reels || a.money || a.mech || a.alarm || a.held;

export class SettleSave {
  private armed = false;
  private quietFrom: number | null = null;
  private moneyAt: number | null = null;
  asked = 0;
  askedMoney = 0;

  played(at: number): void {
    this.armed = true;
    this.quietFrom = null;
    void at;
  }

  gap(): void {
    this.quietFrom = null;
  }

  reset(): void {
    this.armed = false;
    this.quietFrom = null;
    this.moneyAt = null;
  }

  saved(): void {
    this.armed = false;
    this.moneyAt = null;
  }

  get pending(): boolean { return this.armed || this.moneyAt !== null; }

  money(at: number, moved: boolean, mech: boolean): boolean {
    if (moved) { this.moneyAt = at; return false; }
    if (this.moneyAt === null || mech || at - this.moneyAt < MONEY_QUIET_MS) return false;
    this.moneyAt = null;
    this.asked++;
    this.askedMoney++;
    return true;
  }

  sample(at: number, a: Activity): boolean {
    if (busy(a)) { this.quietFrom = null; return false; }
    if (this.quietFrom === null || at < this.quietFrom) { this.quietFrom = at; return false; }
    if (!this.armed || at - this.quietFrom < SETTLE_MS) return false;
    this.armed = false;
    this.moneyAt = null;
    this.asked++;
    return true;
  }
}

export function reelPose(reels: readonly { position: number; travel: number; bounce: number }[]): string {
  return reels.map((r) => `${r.position}/${r.travel}/${r.bounce}`).join(',');
}
