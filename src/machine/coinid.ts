import { COIN_NOTE_TYPES } from './effects';

export function legacyCoinId(coinId: number): { note: number; effect?: number } {
  switch (coinId) {
    case 0x43: return { note: 0x47, effect: 1 };
    case 0x44: return { note: 0x47, effect: 5 };
    case 0x45: return { note: 0x47, effect: 6 };
    case 0x46: case 0x47: case 0x48: return { note: coinId - 3 };
    case 0x49: return { note: 0x47, effect: 3 };
    case 0x4a: return { note: 0x47, effect: 4 };
    default: return { note: coinId };
  }
}

export function acceptorIds(values: ReadonlyMap<string, number>): { note?: number; effect?: number } {
  const written = values.get('EffectId');
  const current = values.get('CoinNoteId');
  if (current !== undefined && current >= 0) {
    return { note: current, ...(written ? { effect: written } : {}) };
  }
  const old = values.get('CoinId');
  if (old === undefined || old < 0 || isLineWindow(old)) {
    return written ? { effect: written } : {};
  }
  const { note, effect } = legacyCoinId(old);
  const e = written || effect || COIN_NOTE_TYPES[note] || 0;
  return { note, ...(e ? { effect: e } : {}) };
}

export function isLineWindow(coinId: number): boolean {
  return coinId >= 0x0f && coinId <= 0x16;
}

export function isAcceptor(values: ReadonlyMap<string, number>): boolean {
  if (values.get('CoinSelected')) return true;
  const old = values.get('CoinId');
  return old === 0x43 || old === 0x44 || old === 0x45 || old === 0x49 || old === 0x4a;
}
