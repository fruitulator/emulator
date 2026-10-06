import { mfmeBandIndex } from './dat';

export interface DriftReel {
  reel: number;
  pos: number;
  stops: number;
  bandOffset: number;
  reversed: boolean;
}

export interface DriftFault {
  reel: number;
  pos: number;
  sub: number;
  row: number;
  fw: number;
}

export function drawnBandIndex(system: string, r: DriftReel): number | undefined {
  if (system === 'SCORPION4') return ((r.pos - 5) % 96 + 96) % 96;
  if (system === 'SCORPION5' || system === 'ADDER5') return mfmeBandIndex(system, r.pos, r.bandOffset, r.reversed, r.stops);
  return undefined;
}

export function reelDriftFault(system: string, r: DriftReel, fw: number): DriftFault | null {
  const index = drawnBandIndex(system, r);
  if (index === undefined) return null;
  const sps = 96 / r.stops;
  const sub = index % sps;
  const row = Math.round(index / sps) % r.stops;
  const expected = (system === 'SCORPION5' || system === 'ADDER5') && r.reversed ? (r.stops - row) % r.stops : row;
  return sub !== 0 || expected !== fw ? { reel: r.reel, pos: r.pos, sub, row, fw } : null;
}

export type StoreState =
  | 'unreadable'
  | 'unconfirmed'
  | 'confirmed';

export class StoreConfirm {
  static readonly SETTLES = 3;
  private readonly seen = new Set<string>();
  private readable: boolean;
  constructor(readable: boolean) { this.readable = readable; }
  get state(): StoreState {
    if (!this.readable) return 'unreadable';
    return this.seen.size >= StoreConfirm.SETTLES ? 'confirmed' : 'unconfirmed';
  }
  get settles(): number { return this.readable ? this.seen.size : 0; }
  settle(clean: boolean, key: string): boolean {
    if (!this.readable) return false;
    if (clean) this.seen.add(key);
    return this.seen.size >= StoreConfirm.SETTLES;
  }
}
