import type { Refusal } from './coinwiring';
import { at, CREDIT_ADD, findAll, readCoinSequences, SELECTOR, word, type Sc1CoinLock, type Sc1CoinTables } from './sc1coins';

const REC = 27;
const ROM_BASE = 0x4000;

const SCAN = [0x8e, -1, -1, 0xbc, -1, -1, 0x24, -1, 0xa6, 0x84, 0x44, 0x44, 0x44, 0x44, 0xb1, -1, -1, 0x27, 0x09,
  0xb7, -1, -1, 0xbd, -1, -1, 0xb7, -1, -1, 0xe6, 0x84, 0xc4, 0x07];
const DEBOUNCE = [0xb6, -1, -1, 0xb8, -1, -1, 0x34, 0x02, 0xb6, -1, -1, 0x43, 0xa4, 0xe0, 0x34, 0x02,
  0xb6, -1, -1, 0x43, 0xb4, -1, -1, 0x34, 0x02, 0xb6, -1, -1, 0xb4, -1, -1, 0xaa, 0xe0, 0x34, 0x02,
  0x43, 0xb4, -1, -1, 0xb7, -1, -1, 0x43, 0xba, -1, -1, 0x43, 0xba, -1, -1, 0xb7, -1, -1];
const LAST_AT = 4;
const LOCK_AT = 44;
const PENDING_AT = 48;
const COIN_TEST = [0xa6, 0x0c, 0xb5];

export interface Sys85CoinTables extends Sc1CoinTables {
  lock: Sc1CoinLock;
}

export function locateSys85CoinTables(rom: Uint8Array): Sys85CoinTables | Refusal {
  const found = new Set<string>();
  for (let p = 0; p + 12 <= rom.length; p++) {
    if (rom[p] !== 0xc6 || rom[p + 2] !== 0x34 || rom[p + 3] !== 0x04 || rom[p + 4] !== 0x8e
      || rom[p + 10] !== 0xa5 || rom[p + 11] !== 0x0c) continue;
    let sel: number;
    if (rom[p + 7] === 0xbd) sel = word(rom, p + 8);
    else if (rom[p + 7] === 0x17) sel = (p + 10 + ((word(rom, p + 8) << 16) >> 16)) & 0xffff;
    else continue;
    if (!at(rom, sel, SELECTOR)) continue;
    found.add(`${word(rom, p + 5)},${rom[p + 1]!}`);
  }
  if (found.size !== 1) return { refused: found.size ? 'the program names two coin tables' : 'no coin records found in the program' };
  const [table, groups] = [...found][0]!.split(',').map(Number) as [number, number];
  if (table < ROM_BASE || table + groups * REC * 4 > rom.length) return { refused: 'the coin records are not in program ROM' };
  if (groups < 1 || groups > 8) return { refused: 'the coin record count is out of range' };
  if (findAll(rom, CREDIT_ADD).length !== 1) return { refused: 'the program\'s credit routine was not found' };

  const scans = findAll(rom, SCAN);
  if (scans.length !== 1) return { refused: scans.length ? 'the program has two switch scans' : 'the program\'s switch scan was not found' };
  const switches = [word(rom, scans[0]! + 1)];
  if (switches[0]! < ROM_BASE) return { refused: 'the switch table is not in program ROM' };

  const debounces = findAll(rom, DEBOUNCE);
  if (debounces.length !== 1) return { refused: debounces.length ? 'the program debounces two coin bytes' : 'the coin debounce was not found' };
  const d = debounces[0]!;
  const coinByte = word(rom, d + 1);
  const lockByte = word(rom, d + LOCK_AT);
  const lastByte = word(rom, d + LAST_AT);
  const pending = word(rom, d + PENDING_AT);
  if (coinByte >= 0x2000 || lockByte >= 0x2000 || lastByte >= 0x2000) return { refused: 'the coin byte is not in RAM' };
  if (word(rom, d + PENDING_AT + 3) !== pending || word(rom, d + 4) !== word(rom, d + 21) || word(rom, d + 4) !== word(rom, d + 37)
    || word(rom, d + 1) !== word(rom, d + 26)) return { refused: 'the coin debounce was not read' };
  if (!findAll(rom, [...COIN_TEST, pending >> 8, pending & 0xff]).length) return { refused: 'the coin loop does not test the debounced coins' };

  const sequences = readCoinSequences(rom, ROM_BASE);
  if ('refused' in sequences) return sequences;
  return { table, groups, coinByte, switches, switchFlag: null, sequences, lock: { lockByte, lastByte, sequenceForce: null } };
}
