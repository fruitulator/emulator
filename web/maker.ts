import { contentFiles } from '../src/machine/setfiles';
import { MANUFACTURERS } from './title';
import { str } from './i18n';

export const MAKER_RULE = 1;

const GAME_MAKER_LINES: readonly (readonly [RegExp, string])[] = [
  [/MAZOOMA\s+GAMES/, 'Mazooma'],
  [/QPS\s+INTERACTIVE/, 'QPS'],
  [/Reflex Gaming Ltd/i, 'Reflex Gaming'],
  [/RED GAMING/, 'Red Gaming'],
  [/EMPIRE GAMES LTD/, 'Empire'],
  [/CRYSTAL LEISURE/, 'Crystal Leisure'],
  [/J\.P\.M\.\s+INTERACTIVE/, 'JPM'],
];

const OS_MAKER_LINES: readonly (readonly [RegExp, string])[] = [
  [/\(C\)\s*(?:19|20)\d\d\s+BARCREST|\(C\)\s*Barcrest/i, 'Barcrest'],
  [/COPYRIGHT OF MAYGAY MACHINES/i, 'Maygay'],
  [/retained by Bell-Fruit (?:Games|Group|Manufacturing)/, 'Bell-Fruit'],
  [/ACE SP\.ACE A\.W\.P\. \(c\)/i, 'Ace'],
];

const BOARD_MAKERS: Record<string, string> = {
  MPU4: 'Barcrest',
  MPU5: 'Barcrest',
  MPU3: 'Barcrest',
  MMM: 'Maygay',
  MPU2: 'Barcrest',
  SYS83: 'Bell-Fruit',
  MPU4VIDEO: 'Barcrest',
  MPU4PLASMA: 'Barcrest',
  SCORPION1: 'Bell-Fruit',
  SCORPION2: 'Bell-Fruit',
  SCORPION4: 'Bell-Fruit',
  SCORPION5: 'Bell-Fruit',
  SYS85: 'Bell-Fruit',
  ADDER5: 'Bell-Fruit',
  SYS5: 'JPM',
  SYSTEM80: 'JPM',
  IMPACT: 'JPM',
  MPS2: 'JPM',
  SRU: 'JPM',
  BLACKBOX: 'Bell-Fruit',
  M1AB: 'Maygay',
  EPOCH: 'Maygay',
  SPACE: 'Ace',
  SYS1: 'Ace',
  ACEVIDEO: 'Ace',
  PLUTO5: 'Heber',
  PROCONN: 'Project',
  ELECTROCOIN: 'Electrocoin',
  PHOENIX: 'Electrocoin',
  PHOENIX2: 'Electrocoin',
  ASTRASYSA1: 'Astra',
};

const NAME_WORDS = new Set(['bellfruit', 'bfm', 'barcrest', 'maygay', 'jpm', 'pcp', 'mazooma', 'astra', 'qps']);

const MAX_ROM = 8 * 1024 * 1024;

const latin1 = new TextDecoder('latin1');

function interleave(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length * 2);
  for (let i = 0; i < a.length; i++) {
    out[2 * i] = a[i];
    out[2 * i + 1] = b[i];
  }
  return out;
}

export function makerFromRoms(files: readonly { name: string; bytes: Uint8Array }[]): string | undefined {
  const roms = contentFiles([...files])
    .filter((f) => !/\.(fml|dat)$/i.test(f.name) && f.bytes.length > 0 && f.bytes.length <= MAX_ROM);
  function* readings(): Generator<string> {
    for (const f of roms) yield latin1.decode(f.bytes);
    for (let i = 0; i < roms.length; i++) {
      for (let j = 0; j < roms.length; j++) {
        if (i !== j && roms[i].bytes.length === roms[j].bytes.length) {
          yield latin1.decode(interleave(roms[i].bytes, roms[j].bytes));
        }
      }
    }
  }
  let os = OS_MAKER_LINES.length;
  for (const text of readings()) {
    for (const [re, maker] of GAME_MAKER_LINES) if (re.test(text)) return maker;
    for (let k = 0; k < os; k++) if (OS_MAKER_LINES[k][0].test(text)) os = k;
  }
  return os < OS_MAKER_LINES.length ? OS_MAKER_LINES[os][1] : undefined;
}

export function makerFromName(source: string): string | undefined {
  for (const m of source.matchAll(/\(([^)]*)\)/g)) {
    const label = MANUFACTURERS[m[1].trim().toLowerCase().replace(/[\s_-]/g, '')];
    if (label) return label;
  }
  for (const word of source.split(/[^A-Za-z']+/)) {
    const w = word.toLowerCase();
    for (const k of [w, w.replace(/'s$/, ''), w.replace(/s$/, '')]) {
      if (NAME_WORDS.has(k)) return MANUFACTURERS[k] ?? k.toUpperCase();
    }
  }
  return undefined;
}

export function boardMaker(system: string): string | undefined {
  return BOARD_MAKERS[system.toUpperCase()];
}

export function makerOf(
  files: readonly { name: string; bytes: Uint8Array }[],
  system: string,
  sourceName: string | undefined,
): string | undefined {
  return makerFromRoms(files) ?? (sourceName ? makerFromName(sourceName) : undefined) ?? boardMaker(system);
}

export const UNKNOWN_MAKER = str('maker.other');

export function libraryMaker(g: { maker?: string; sourceName?: string; name: string; system: string }): string {
  return g.maker ?? makerFromName(g.sourceName ?? g.name) ?? boardMaker(g.system) ?? UNKNOWN_MAKER;
}
