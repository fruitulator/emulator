import { decryptFml, isEncryptedFml } from '../layout/fml';
import { parseLayout, type ParsedComponent } from '../layout/fmlparse';
import { COIN_RAW } from './coinraw';
import { acceptorIds } from './coinid';

export interface CoinNote {
  readonly name: string;
  readonly pence: number | null;
  readonly token: boolean;
}

export const COIN_NOTES: ReadonlyMap<number, CoinNote> = new Map([
  [0, { name: '5p Binary', pence: 5, token: false }],
  [1, { name: '10p Binary', pence: 10, token: false }],
  [2, { name: '20p Binary', pence: 20, token: false }],
  [3, { name: 'Tok Binary', pence: null, token: true }],
  [4, { name: '50p Binary', pence: 50, token: false }],
  [5, { name: '£1 Binary', pence: 100, token: false }],
  [6, { name: '£2 Binary', pence: 200, token: false }],
  [7, { name: '5p MPU4', pence: 5, token: false }],
  [8, { name: '10p MPU4', pence: 10, token: false }],
  [9, { name: '20p MPU4', pence: 20, token: false }],
  [10, { name: '50p MPU4', pence: 50, token: false }],
  [11, { name: '£1 MPU4', pence: 100, token: false }],
  [12, { name: '£2 MPU4', pence: 200, token: false }],
  [13, { name: '£1 MPU5', pence: 100, token: false }],
  [14, { name: '£2 MPU5', pence: 200, token: false }],
  [15, { name: 'bit0 1', pence: null, token: false }],
  [16, { name: 'bit1 2', pence: null, token: false }],
  [17, { name: 'bit2 4', pence: null, token: false }],
  [18, { name: 'bit3 8', pence: null, token: false }],
  [19, { name: 'bit4 16', pence: null, token: false }],
  [20, { name: 'bit5 32', pence: null, token: false }],
  [21, { name: 'bit6 64', pence: null, token: false }],
  [22, { name: 'bit7 128', pence: null, token: false }],
  [23, { name: '5p EPOCH', pence: 5, token: false }],
  [24, { name: '10p EPOCH', pence: 10, token: false }],
  [25, { name: '20p EPOCH', pence: 20, token: false }],
  [26, { name: 'Tok EPOCH', pence: null, token: true }],
  [27, { name: '50p Old EPOCH', pence: 50, token: false }],
  [28, { name: '£1 EPOCH', pence: 100, token: false }],
  [29, { name: '£2 EPOCH', pence: 200, token: false }],
  [68, { name: '50p New EPOCH', pence: 50, token: false }],
  [30, { name: 'ccTalk Note 1', pence: null, token: false }],
  [31, { name: 'ccTalk Note 2', pence: null, token: false }],
  [32, { name: 'ccTalk Note 3', pence: null, token: false }],
  [50, { name: 'ccTalk Note 4', pence: null, token: false }],
  [39, { name: 'ccTalk Coin 1', pence: null, token: false }],
  [40, { name: 'ccTalk Coin 2', pence: null, token: false }],
  [41, { name: 'ccTalk Coin 3', pence: null, token: false }],
  [42, { name: 'ccTalk Coin 4', pence: null, token: false }],
  [43, { name: 'ccTalk Coin 5', pence: null, token: false }],
  [44, { name: 'ccTalk Coin 6', pence: null, token: false }],
  [45, { name: 'ccTalk Coin 7', pence: null, token: false }],
  [46, { name: 'ccTalk Coin 8', pence: null, token: false }],
  [33, { name: '5p Proconn', pence: 5, token: false }],
  [34, { name: '10p Proconn', pence: 10, token: false }],
  [35, { name: '20p Proconn', pence: 20, token: false }],
  [36, { name: '50p Proconn', pence: 50, token: false }],
  [37, { name: '£1 Proconn', pence: 100, token: false }],
  [38, { name: '£2 Proconn', pence: 200, token: false }],
  [51, { name: 'Tok Proconn', pence: null, token: true }],
  [47, { name: 'NV4 £5 Note', pence: 500, token: false }],
  [48, { name: 'NV4 £10 Note', pence: 1000, token: false }],
  [49, { name: 'NV4 £20 Note', pence: 2000, token: false }],
  [59, { name: 'JPM £5 Note', pence: 500, token: false }],
  [60, { name: 'JPM £10 Note', pence: 1000, token: false }],
  [61, { name: 'JPM £20 Note', pence: 2000, token: false }],
  [52, { name: '£1 Pluto5', pence: 100, token: false }],
  [53, { name: '10p BB', pence: 10, token: false }],
  [54, { name: 'Tok BB', pence: null, token: true }],
  [55, { name: '50p 1SW BB', pence: 50, token: false }],
  [56, { name: '50p 2SW BB', pence: 50, token: false }],
  [57, { name: 'Tok MPU4', pence: null, token: true }],
  [62, { name: 'Tok MPU4 2', pence: null, token: true }],
  [58, { name: 'Tok BFM', pence: null, token: true }],
  [69, { name: 'Tok BFM 2', pence: null, token: true }],
  [63, { name: 'Tok MPS2', pence: null, token: true }],
  [64, { name: 'Tok M1A/B', pence: null, token: true }],
  [65, { name: 'Tok/2p SYS85', pence: null, token: true }],
  [66, { name: 'Tok SYS1', pence: null, token: true }],
  [67, { name: 'Tok Phoenix', pence: null, token: true }],
  [72, { name: '10p Coinmaster', pence: 10, token: false }],
  [73, { name: '20p Coinmaster', pence: 20, token: false }],
  [74, { name: '50p Coinmaster', pence: 50, token: false }],
  [75, { name: '£1 Coinmaster', pence: 100, token: false }],
]);

export const COIN_NOTE_BLANK = 0x47;

const TOKEN_EFFECTS = new Set([0x2, 0x4, 0x8]);

export interface DeclaredCoin {
  button: number | null;
  note: number | null;
  named: CoinNote | null;
  effect: number | null;
  line: number | null;
  token: boolean;
  pence: number | null;
  rect: { left: number; top: number; width: number; height: number } | null;
}

function fmlPayload(layout: Uint8Array | undefined): Uint8Array | null {
  if (!layout || layout.length === 0) return null;
  try {
    return isEncryptedFml(layout) ? decryptFml(layout) : layout;
  } catch {
    return null;
  }
}

export const PARALLEL_NOTE_CHANNELS: ReadonlyMap<number, number> =
  new Map([[0x2f, 1], [0x30, 2], [0x31, 3]]);

export function parallelNoteChannels(layout: Uint8Array | undefined): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of declaredCoins(layout)) {
    if (c.note === null) continue;
    const channel = PARALLEL_NOTE_CHANNELS.get(c.note);
    if (channel === undefined || c.pence === null) continue;
    out.set(channel, c.pence);
  }
  return out;
}

function declaredLine(c: ParsedComponent): number | null {
  const id = c.values.get('CoinId');
  if (id === undefined || id < 0x0f || id > 0x16) return null;
  return id - 0x0f;
}

export function declaredCoins(layout: Uint8Array | undefined): DeclaredCoin[] {
  const payload = fmlPayload(layout);
  if (!payload) return [];
  let comps: ParsedComponent[];
  try {
    comps = parseLayout(payload);
  } catch {
    return [];
  }
  const out: DeclaredCoin[] = [];
  for (const c of comps) {
    if (!c.values.get('CoinSelected')) continue;
    const ids = acceptorIds(c.values);
    const note = ids.note ?? null;
    const named = note === null ? null : COIN_NOTES.get(note) ?? null;
    const rawEffect = c.values.get('EffectId') ?? ids.effect;
    const effect = rawEffect === undefined ? null : rawEffect;
    const button = c.values.get('ButtonNumber');
    out.push({
      button: button === undefined ? null : button,
      note,
      named,
      effect,
      line: declaredLine(c),
      token: (named?.token ?? false) || (effect !== null && TOKEN_EFFECTS.has(effect)),
      pence: named?.pence ?? null,
      rect: c.width > 0 && c.height > 0
        ? { left: c.x, top: c.y, width: c.width, height: c.height }
        : null,
    });
  }
  return out;
}

export function cabinetCoinPence(layout: Uint8Array | undefined): Map<number, number> | null {
  const priced = new Map<number, number>();
  for (const c of declaredCoins(layout)) {
    if (c.line === null || c.pence === null) continue;
    priced.set(c.line, c.pence);
  }
  return priced.size ? priced : null;
}

export interface CabinetCoinSlot {
  readonly pence: number | null;
  readonly token: boolean;
  readonly mask: number;
  readonly note: number;
}

export function coinRowPattern(c: DeclaredCoin, row: number): number | undefined {
  const direct = (v: number): number | undefined =>
    ((v & 0x78) >> 3) === row ? 1 << (v & 7) : undefined;
  if (c.note === COIN_NOTE_BLANK) {
    return c.button !== null && c.button >= 0 && c.button < 128 ? direct(c.button) : undefined;
  }
  if (c.note === null) {
    return c.line === null ? undefined : 1 << c.line;
  }
  const raw = COIN_RAW[c.note];
  if (raw === undefined) return undefined;
  return raw & 0x100 ? direct(raw) : raw & 0xff;
}

export function cabinetCoinSlots(
  layout: Uint8Array | undefined,
  row: number,
): CabinetCoinSlot[] {
  const out: CabinetCoinSlot[] = [];
  for (const c of declaredCoins(layout)) {
    if (c.note === null) continue;
    if (c.pence === null && !c.token) continue;
    const mask = coinRowPattern(c, row);
    if (mask === undefined || mask === 0) continue;
    out.push({ pence: c.pence, token: c.token, mask, note: c.note });
  }
  return out;
}
