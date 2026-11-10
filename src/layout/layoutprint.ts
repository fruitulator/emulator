import { decryptFml, isEncryptedFml } from './fml';
import { parseLayout } from './fmlparse';
import { declaredCoins } from '../machine/layoutcoins';

export const LAYOUT_PRINT_RULE = 1;

const NOT_COMPARED = new Set(['CoinId', 'CoinNoteId', 'EffectId']);

const LAYOUT = /\.fml$/i;

const SHORTCUT = /^Shortcut\d/;

const BIT0_NOTE = 15;

export function printableLayout(name: string): boolean {
  return LAYOUT.test(name);
}

function lampTable(subs: number[] | undefined): number[] | null {
  if (!subs) return null;
  let n = subs.length;
  while (n > 0 && subs[n - 1] === -2) n--;
  return subs.slice(0, n);
}

export function layoutPrintText(bytes: Uint8Array): string | null {
  let comps;
  try {
    const payload = isEncryptedFml(bytes) ? decryptFml(bytes) : bytes;
    comps = parseLayout(payload);
  } catch {
    return null;
  }
  if (!comps.length) return null;
  const rows = comps.map((c) => {
    const values: Record<string, number> = {};
    for (const [k, v] of c.defaults) values[k] = v;
    for (const [k, v] of c.values) values[k] = v;
    const reversed = values.Reversed || values.ReversedLegacy ? 1 : 0;
    delete values.ReversedLegacy;
    values.Reversed = reversed;
    const named = Object.keys(values).filter((k) => !k.startsWith('#') && !NOT_COMPARED.has(k) && !SHORTCUT.test(k) && values[k] !== 0).sort()
      .map((k) => [k, values[k]]);
    const texts = [...c.texts].filter(([k]) => !k.startsWith('#'))
      .map(([k, v]) => [k === 'Label' ? 'OffText' : k, v] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return [c.type, c.x, c.y, c.width, c.height, c.number, c.angle, lampTable(c.subs), named, texts];
  });
  const coins = declaredCoins(bytes).map((c) => [
    c.button, c.note ?? (c.line === null ? null : BIT0_NOTE + c.line), c.pence, c.token, c.rect,
  ]);
  const set = rows.map((r) => JSON.stringify(r)).sort();
  return JSON.stringify({ rule: LAYOUT_PRINT_RULE, rows: set, coins: coins.map((c) => JSON.stringify(c)).sort() });
}
