export interface Second {
  t: number; reels: boolean; ledger: boolean; glass: boolean; alarm: boolean; line: string;
  lamps?: number;
  pics?: readonly number[];
}

export const quiet = (s: Second): boolean => !s.reels && !s.ledger && !s.alarm;

export const ALARM_GAP_S = 5;

export function standingAlarm(s: readonly Pick<Second, 'alarm'>[]): number {
  let last = -1;
  for (let i = s.length - 1; i >= 0; i--) if (s[i].alarm) { last = i; break; }
  if (last < 0 || s.length - 1 - last > ALARM_GAP_S) return 0;
  let first = last;
  for (let i = last - 1; i >= 0 && first - i <= ALARM_GAP_S + 1; i--) if (s[i].alarm) first = i;
  return s.length - first;
}

export const LAMP_EVIDENCE = 8;
export const QUIET_LONG_S = 30;
export const LONG_ALIVE_SHARE = 0.8;

export const moving = (s: Second): boolean => s.glass || (s.lamps ?? 0) > 0;

export const VARIETY_S = 10;
export const PICTURES_MIN = 6;

export function varied(w: readonly Second[]): boolean {
  if (w.length < 2) return false;
  const half = Math.floor(w.length / 2);
  const count = (h: readonly Second[]): number => new Set(h.flatMap((s) => s.pics ?? [])).size;
  return count(w.slice(0, half)) >= PICTURES_MIN && count(w.slice(half)) >= PICTURES_MIN;
}

const alive = (w: readonly Second[]): boolean => w.every(quiet) && w.some(moving);

export const keepable = (w: readonly Second[]): boolean => alive(w) && varied(w);

export function attractFired(secs: readonly Second[], windowS: number): boolean {
  if (secs.length < windowS) return false;
  const w = secs.slice(-windowS);
  if (!alive(w)) return false;
  if (secs.length < VARIETY_S) return false;
  const v = secs.slice(-VARIETY_S);
  if (!v.every(quiet) || !varied(v)) return false;
  if (w.some((s) => (s.lamps ?? 0) >= LAMP_EVIDENCE)) return true;
  const long = Math.max(windowS, QUIET_LONG_S);
  if (secs.length < long) return false;
  const l = secs.slice(-long);
  return l.every(quiet) && l.filter(moving).length >= Math.ceil(long * LONG_ALIVE_SHARE);
}

export class LampFlips {
  private prev: boolean[] | null = null;
  private changed = new Set<number>();
  private pictures = new Set<number>();
  feed(v: { layoutLamp(n: number): boolean }, lamps = 512): void {
    const now: boolean[] = new Array(lamps);
    let h = 0x811c9dc5;
    for (let n = 0; n < lamps; n++) {
      now[n] = v.layoutLamp(n);
      if (now[n]) { h ^= n & 0xff; h = Math.imul(h, 0x01000193); h ^= n >> 8; h = Math.imul(h, 0x01000193); }
    }
    this.pictures.add(h >>> 0);
    const p = this.prev;
    if (p) for (let n = 0; n < lamps; n++) if (now[n] !== p[n]) this.changed.add(n);
    this.prev = now;
  }
  take(): number {
    const n = this.changed.size;
    this.changed = new Set();
    return n;
  }
  takePictures(): number[] {
    const p = [...this.pictures];
    this.pictures = new Set();
    return p;
  }
  reset(): void { this.prev = null; this.changed = new Set(); this.pictures = new Set(); }
}

export function attractWhy(secs: readonly Second[], windowS: number): string {
  if (attractFired(secs, windowS)) return 'none';
  const w = secs.slice(-windowS);
  const r: string[] = [];
  const n = (k: keyof Second) => w.filter((s) => s[k]).length;
  if (n('reels')) r.push(`reels moved in ${n('reels')}/${w.length}s`);
  if (n('ledger')) r.push(`ledger moved in ${n('ledger')}/${w.length}s`);
  if (n('alarm')) r.push(`ALARM in ${n('alarm')}/${w.length}s`);
  if (!w.some(moving)) r.push('glass frozen');
  const v = secs.slice(-VARIETY_S);
  if (!r.length && !varied(v)) r.push(`the lamps are not cycling (under ${PICTURES_MIN} pictures in each ${Math.floor(VARIETY_S / 2)} s)`);
  if (!r.length) r.push(`no lamp show (under ${LAMP_EVIDENCE} lamps a second) and not ${QUIET_LONG_S} s quiet with the glass moving`);
  return r.join(', ');
}

export function busyByItself(secs: readonly Second[], windowS: number): boolean {
  const w = secs.slice(-windowS);
  return w.some((s) => s.ledger) && !w.at(-1)?.alarm;
}
