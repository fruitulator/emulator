import type { CoinLine, CoinLineTable, Refusal } from './coinwiring';

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

const ROM_BASE = 0x1000;

interface Decoded { value: number; target: number }

function keepsB(rom: Uint8Array, page: number, a: number): boolean {
  const p = page + a;
  if (rom[p] !== 0x96 || rom[p + 2] !== 0x85) return false;
  const op = rom[p + 4];
  const rel = (rom[p + 5]! << 24) >> 24;
  if (op === 0x27) return rom[page + ((a + 6 + rel) & 0xffff)] === 0x39;
  if (op === 0x26) return rom[p + 6] === 0x39;
  return false;
}

export function decodeHandler(rom: Uint8Array, page: number, h: number, joins: ReadonlySet<number> = new Set()): Decoded | null {
  let a = h;
  let b: number | null = null;
  for (let n = 0; n < 12; n++) {
    if (a !== h && joins.has(a)) return b === null || b === 0 ? null : { value: b, target: a };
    const p = page + a;
    if (p + 4 > rom.length) return null;
    const op = rom[p]!;
    const w = (rom[p + 1]! << 8) | rom[p + 2]!;
    if (op === 0x8e) { a += 3; continue; }
    if (op === 0xc6) { b = rom[p + 1]!; a += 2; continue; }
    if (op === 0xbd) { b = null; a += 3; continue; }
    if (op === 0x17 || op === 0x8d) {
      const t = op === 0x17 ? (a + 3 + ((w << 16) >> 16)) & 0xffff : (a + 2 + ((rom[p + 1]! << 24) >> 24)) & 0xffff;
      if (!keepsB(rom, page, t)) b = null;
      a += op === 0x17 ? 3 : 2;
      continue;
    }
    if (op === 0x16 || op === 0x20) {
      const t = op === 0x16 ? (a + 3 + ((w << 16) >> 16)) & 0xffff : (a + 2 + ((rom[p + 1]! << 24) >> 24)) & 0xffff;
      return b === null || b === 0 ? null : { value: b, target: t };
    }
    if (op === 0x7d) {
      const q = p + 3;
      if (rom[q] === 0x10 && rom[q + 1] === 0x27) {
        const rel = ((rom[q + 2]! << 8) | rom[q + 3]!) << 16 >> 16;
        const t = (a + 7 + rel) & 0xffff;
        return b === null || b === 0 ? null : { value: b, target: t };
      }
      if (rom[q] === 0x27) {
        const t = (a + 5 + ((rom[q + 1]! << 24) >> 24)) & 0xffff;
        return b === null || b === 0 ? null : { value: b, target: t };
      }
      return null;
    }
    if (op === 0x96 && rom[p + 2] === 0x85 && rom[p + 4] === 0x27) {
      const t = (a + 6 + ((rom[p + 5]! << 24) >> 24)) & 0xffff;
      return b === null || b === 0 ? null : { value: b, target: t };
    }
    return null;
  }
  return null;
}

const PLAYS_ADD = [0x8e, -1, -1, 0xeb, 0x84, 0xe7, 0x84];
const TOKEN_SPAN = 0x48;

export function tokenHandler(rom: Uint8Array, page: number, h: number): boolean {
  for (let a = h; a < h + TOKEN_SPAN; a++) {
    const p = page + a;
    if (p + PLAYS_ADD.length > rom.length) return false;
    if (PLAYS_ADD.every((b, i) => b < 0 || rom[p + i] === b)) return true;
  }
  return false;
}

interface RecordRun { at: number; stride: number; count: number }

function recordRuns(rom: Uint8Array): RecordRun[] {
  const ports: number[] = [];
  for (let i = 2; i + 7 <= rom.length; i++) {
    if (rom[i] === 0x0c && rom[i + 1] === 0x02 && (rom[i + 2]! & 0xf0) === 0 && rom[i + 3] === 0) ports.push(i - 2);
  }
  const runs: RecordRun[] = [];
  for (let i = 0; i + 2 < ports.length;) {
    const stride = ports[i + 1]! - ports[i]!;
    if (stride < 9 || stride > 16 || ports[i + 2]! - ports[i + 1]! !== stride) { i++; continue; }
    let j = i + 2;
    while (j + 1 < ports.length && ports[j + 1]! - ports[j]! === stride) j++;
    runs.push({ at: ports[i]!, stride, count: j - i + 1 });
    i = j + 1;
  }
  return runs;
}

function referenced(rom: Uint8Array, run: RecordRun): number | null {
  const page = run.at & ~0xffff;
  const lo = (run.at & 0xffff) - 3 * run.stride;
  const hi = (run.at & 0xffff) + run.stride * run.count;
  for (let p = page; p + 3 <= Math.min(rom.length, page + 0x10000); p++) {
    if (rom[p] !== 0x8e) continue;
    const a = (rom[p + 1]! << 8) | rom[p + 2]!;
    if (a >= lo && a < hi) return p & 0xffff;
  }
  return null;
}

export function readMpu4CoinTable(rom: Uint8Array, lineOfMask: (mask: number) => number | null): CoinLineTable | Refusal {
  const runs = recordRuns(rom).filter((r) => {
    const h = (rom[r.at]! << 8) | rom[r.at + 1]!;
    return h >= ROM_BASE;
  });
  if (!runs.length) return { refused: 'no Barcrest coin records in this program' };
  const found = new Map<number, number>();
  const tokens = new Set<number>();
  const sources: string[] = [];
  let anyRef = false;
  for (const run of runs) {
    const ref = referenced(rom, run);
    if (ref === null) continue;
    anyRef = true;
    const page = run.at & ~0xffff;
    const mine = new Map<number, Decoded>();
    const myTokens = new Set<number>();
    const joins = new Set<number>();
    for (let k = 0; k < run.count; k++) {
      const r = run.at + k * run.stride;
      const h = (rom[r]! << 8) | rom[r + 1]!;
      const d = h >= ROM_BASE ? decodeHandler(rom, page, h) : null;
      if (d) joins.add(d.target);
    }
    for (let k = 0; k < run.count; k++) {
      const r = run.at + k * run.stride;
      const mask = rom[r + 8]!;
      if (mask === 0 || (mask & (mask - 1)) !== 0) continue;
      const line = lineOfMask(mask);
      if (line === null) continue;
      const h = (rom[r]! << 8) | rom[r + 1]!;
      if (h < ROM_BASE) continue;
      const d = decodeHandler(rom, page, h, joins);
      if (!d) {
        if (tokenHandler(rom, page, h)) myTokens.add(line);
        continue;
      }
      const had = mine.get(line);
      if (had && (had.value !== d.value || had.target !== d.target)) {
        return { refused: `two coin records for one line disagree (${hex(r & 0xffff)})` };
      }
      mine.set(line, d);
    }
    if (mine.size < 3) continue;
    const targets = new Set([...mine.values()].map((d) => d.target));
    if (targets.size !== 1) return { refused: `the coin handlers at ${hex(run.at & 0xffff)} do not share one credit routine` };
    for (const [line, d] of mine) {
      const had = found.get(line);
      if (had !== undefined && had !== d.value) return { refused: 'two copies of the coin table state different values' };
      found.set(line, d.value);
    }
    for (const line of myTokens) if (!mine.has(line)) tokens.add(line);
    sources.push(`${hex(run.at & 0xffff)} (indexed at ${hex(ref)}, credit routine ${hex([...targets][0]!)})`);
  }
  if (!anyRef) return { refused: 'Barcrest coin records found, but no code indexes them' };
  if (!sources.length) return { refused: 'fewer than three coin handlers read' };
  const lines: CoinLine[] = [...found].map(([line, credits]): CoinLine => ({ line, credits, change: [] }));
  for (const line of tokens) if (!found.has(line)) lines.push({ line, credits: 0, change: [], token: true, tokenPence: null });
  lines.sort((a, b) => a.line - b.line);
  return {
    lines,
    pricePerCredit: null,
    source: `MPU4 Barcrest coin records ${sources.join(', ')}: each coin handler's value`,
  };
}

export function readMpu4CoinTakes(rom: Uint8Array, lineOfMask: (mask: number) => number | null): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!('lines' in readMpu4CoinTable(rom, lineOfMask))) return out;
  for (const run of recordRuns(rom)) {
    if (referenced(rom, run) === null) continue;
    const page = run.at & ~0xffff;
    for (let k = 0; k < run.count; k++) {
      const r = run.at + k * run.stride;
      const mask = rom[r + 8]!;
      if (mask === 0 || (mask & (mask - 1)) !== 0) continue;
      const line = lineOfMask(mask);
      const h = (rom[r]! << 8) | rom[r + 1]!;
      if (line === null || h < ROM_BASE) continue;
      const at = page + h;
      const list = out.get(line) ?? [];
      if (!list.includes(at)) list.push(at);
      out.set(line, list);
    }
  }
  return out;
}
