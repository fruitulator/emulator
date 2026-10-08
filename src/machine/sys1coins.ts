import { Z80 } from '../cpu/z80';
import type { CoinLine, CoinLineTable, Refusal } from './coinwiring';

export type Sys1Mem = (a: number) => number;

export interface Sys1CoinCode {
  loop: number;
  lines: number;
  pending: number;
  table: number;
  dispatch: number;
  ret: number;
  ops: number[];
  double: number | null;
  mask: number;
  token: { flag: number; mask: number; first: number; second: number; line: number } | null;
}

const PORT_A = [0x3a, 0xe0, 0xaf, 0x2f];

function find(mem: Sys1Mem, from: number, to: number, pat: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = from; i + pat.length <= to; i++) {
    let ok = true;
    for (let j = 0; j < pat.length; j++) if (pat[j]! >= 0 && mem(i + j) !== pat[j]) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}

const word = (mem: Sys1Mem, a: number): number => mem(a) | (mem(a + 1) << 8);

export function locateSys1Coins(mem: Sys1Mem): Sys1CoinCode | Refusal {
  const ROM = 0x8000;
  const C = [0x06, -1, 0x11, -1, -1, 0x21, -1, -1, 0xdd, 0x21, -1, -1, 0x1a, 0xb7, 0x20, 0x08, 0x13, 0x23, 0x23, 0xdd, 0x23, 0x10, 0xf5, 0xc9, 0xdd, 0x34, 0x00, 0x3d, 0x12, 0x11, 0x10, 0x00];
  const cons = find(mem, 0, ROM, C);
  if (cons.length !== 1) return { refused: cons.length ? 'the program\'s coin consumer was found twice' : 'the program\'s coin consumer was not found' };
  const loop = cons[0]!;
  const lines = mem(loop + 1);
  const pending = word(mem, loop + 3);
  const table = word(mem, loop + 6);
  if (lines < 1 || lines > 8 || pending < 0x8000 || pending >= 0xa000) return { refused: 'the program\'s coin consumer does not read as one' };
  const D = [0x7e, 0x23, 0x66, 0x6f, 0xcd, -1, -1, 0xc9];
  if (!find(mem, table - 8, table, D).includes(table - 8)) return { refused: 'the program\'s coin script dispatch was not found' };
  const dispatch = table - 4;
  const ret = table - 1;
  const runner = word(mem, dispatch + 1);
  const end = find(mem, runner, Math.min(runner + 0x60, ROM), [0xff, 0xff])[0];
  if (end === undefined) return { refused: 'the program\'s coin script runner was not found' };
  let ops: number[] = [];
  for (let s = runner + 4; s < end; s++) {
    if (mem(s - 3) !== 0xcd || (end - s) % 2) continue;
    const ws: number[] = [];
    for (let a = s; a < end; a += 2) ws.push(word(mem, a));
    if (ws.length >= 6 && ws.every((w) => w > runner && w < runner + 0x200)) { ops = ws; break; }
  }
  if (ops.length < 6) return { refused: 'the program\'s coin script ops were not found' };
  const op1 = ops[0]!;
  if (!find(mem, op1, op1 + 6, [0xc5, 0xe5, 0x0e, 0x02, 0x21]).includes(op1)) return { refused: 'the program\'s credit op does not read as one' };
  const dbl = find(mem, op1, op1 + 0x20, [0x3a, -1, -1, 0xb7, 0x20, 0x02, 0xcb, 0x21])[0];
  if (!find(mem, ops[3]!, ops[3]! + 3, [0x23, 0x79, 0xcd]).includes(ops[3]!)) return { refused: 'the program\'s meter op does not read as one' };
  const P = [0x21, (pending - 1) & 0xff, (pending - 1) >> 8, 0x23, 0xcb, 0x39, 0x30, 0xfb, 0x34];
  const deb = find(mem, 0, ROM, P);
  if (deb.length !== 1) return { refused: 'the program\'s coin debounce was not found' };
  const reads = find(mem, Math.max(0, deb[0]! - 0x120), deb[0]!, PORT_A);
  if (!reads.length) return { refused: 'the program\'s coin debounce reads no coin port' };
  const r = reads[0]! + 4;
  if (mem(r) === 0xe6 && mem(r + 2) === 0x32) {
    return { loop, lines, pending, table, dispatch, ret, ops, double: dbl === undefined ? null : word(mem, dbl + 1), mask: mem(r + 1), token: null };
  }
  const T = [0xeb, 0x21, -1, -1, 0xcb, 0x46, 0xeb, 0x20, -1, 0xe6, -1, 0x32];
  if (!find(mem, r, r + T.length, T).includes(r)) return { refused: 'the program\'s coin debounce does not read as one' };
  const flag = word(mem, r + 2);
  const tok = r + 9 + ((mem(r + 8) << 24) >> 24);
  if (!find(mem, tok, tok + 6, [0xf5, 0xe6, -1, 0xe6, -1]).includes(tok)) return { refused: 'the program\'s token mode does not read as one' };
  const cashMask = mem(tok + 2) & mem(tok + 4);
  const bits: number[] = [];
  let line = -1;
  for (let a = tok; a < deb[0]! && (bits.length < 2 || line < 0); a++) {
    if (mem(a) === 0xcb && (mem(a + 1) & 0xc7) === 0x47 && bits.length < 2) {
      const k = (mem(a + 1) >> 3) & 7;
      if (!bits.includes(k)) bits.push(k);
    }
    if (mem(a) === 0x21 && mem(a + 3) === 0x34) {
      const at = word(mem, a + 1);
      if (at >= pending && at < pending + lines) line = at - pending;
    }
  }
  if (bits.length < 2 || line < 0) return { refused: 'the program\'s token sequence does not read as one' };
  return {
    loop, lines, pending, table, dispatch, ret, ops, double: dbl === undefined ? null : word(mem, dbl + 1),
    mask: mem(r + 10), token: { flag, mask: cashMask, first: bits[0]!, second: bits[1]!, line },
  };
}

export interface Sys1Script {
  credits: number;
  pulses: Map<number, number>;
  change: { id: number; count: number }[];
}

const CASH_IN = 1;
const CASH_OUT = 2;
const TOKENS_IN = 3;
const TOKENS_OUT = 4;
const SOLENOIDS = new Set([11, 12, 13, 14]);

export function decodeSys1Script(code: Sys1CoinCode, mem: Sys1Mem, at: number): Sys1Script | null {
  const out: Sys1Script = { credits: 0, pulses: new Map(), change: [] };
  const list = (h: number): boolean => mem(h) === 0x23 || ((mem(h) === 0x20 || mem(h) === 0x28) && mem(h + 2) === 0x23);
  const pulse = (id: number, n: number): void => {
    if (SOLENOIDS.has(id)) out.change.push({ id, count: n });
    else out.pulses.set(id, (out.pulses.get(id) ?? 0) + n);
  };
  let a = at;
  for (let n = 0; n < 64; n++) {
    const op = mem(a++);
    if (op === 0) return out;
    const h = code.ops[op - 1];
    if (h === undefined) return null;
    const c = mem(a++);
    if (op === 1) { out.credits += c; continue; }
    if (mem(h) === 0xc5 && mem(h + 1) === 0xe1 && mem(h + 2) === 0xc9) { a = c | (mem(a) << 8); continue; }
    if (list(h)) {
      let b = mem(a++);
      const isChange = op === 5 || op === 6;
      const isPulse = op === 4;
      let id = c;
      for (let k = 0; k < 32; k++) {
        if (isChange) out.change.push({ id, count: b });
        else if (isPulse) pulse(id, b);
        id = mem(a++);
        if (id === 0) break;
        b = mem(a++);
      }
      continue;
    }
    if (op === 5) out.change.push({ id: c, count: 1 });
  }
  return null;
}

export function sys1Credits(code: Sys1CoinCode, mem: Sys1Mem, s: Sys1Script): number {
  return code.double !== null && mem(code.double) === 0 ? s.credits * 2 : s.credits;
}

export function sys1CoinLines(code: Sys1CoinCode, mem: Sys1Mem): number {
  if (code.token && (mem(code.token.flag) & 1)) return code.token.mask | (1 << code.token.line);
  return code.mask & ((1 << code.lines) - 1);
}

export function sys1TokenSequence(code: Sys1CoinCode, mem: Sys1Mem, line: number): [number, number] | null {
  const t = code.token;
  if (!t || line !== t.line || !(mem(t.flag) & 1)) return null;
  return [t.first, t.second];
}

export function sys1ScriptAt(code: Sys1CoinCode, mem: Sys1Mem, col: number, i: number): number {
  return word(mem, code.table + col * 0x10 + i * 2);
}

function lineOf(code: Sys1CoinCode, mem: Sys1Mem, line: number, s: Sys1Script): CoinLine | null {
  const credits = sys1Credits(code, mem, s);
  if (credits <= 0) return null;
  const token = (s.pulses.get(TOKENS_IN) ?? 0) > 0 && !(s.pulses.get(CASH_IN) ?? 0);
  const change = s.change.length ? [s.change.map((c) => ({ count: c.count, tube: c.id }))] : [];
  return token ? { line, credits, change, token: true } : { line, credits, change };
}

export function sys1CoinTable(code: Sys1CoinCode, mem: Sys1Mem, dry: (line: number) => number | 'refused' | null): CoinLineTable | Refusal {
  const r = sys1LineScripts(code, mem, dry);
  return 'refused' in r ? r : r.table;
}

export function sys1LineScripts(code: Sys1CoinCode, mem: Sys1Mem, dry: (line: number) => number | 'refused' | null): { table: CoinLineTable; scripts: Map<number, Sys1Script> } | Refusal {
  const lines: CoinLine[] = [];
  const scripts = new Map<number, Sys1Script>();
  const live = sys1CoinLines(code, mem);
  for (let k = 0; k < code.lines; k++) {
    if (!(live & (1 << k))) continue;
    const v = dry(k);
    let s = typeof v === 'number' ? decodeSys1Script(code, mem, v) : null;
    if (!s || sys1Credits(code, mem, s) <= 0) s = decodeSys1Script(code, mem, sys1ScriptAt(code, mem, 1, k));
    if (!s) return { refused: 'a coin script of the program does not decode' };
    const l = lineOf(code, mem, k, s);
    if (l) { lines.push(l); scripts.set(k, s); }
  }
  if (!lines.length) return { refused: 'the program credits no coin line' };
  return { table: { lines, pricePerCredit: null, source: `Ace System 1 coin scripts at $${code.table.toString(16).toUpperCase()}` }, scripts };
}

export function sys1MeterUnit(table: CoinLineTable, scripts: ReadonlyMap<number, Sys1Script>, prices: ReadonlyMap<number, number>): number | null {
  let unit: number | null = null;
  for (const l of table.lines) {
    if (l.token || l.change.length) continue;
    const s = scripts.get(l.line);
    const n = s?.pulses.get(CASH_IN) ?? 0;
    const p = prices.get(l.line);
    if (!s || n <= 0 || p === undefined) continue;
    const u = p / n;
    if (unit !== null && Math.abs(unit - u) > 1e-9) return null;
    unit = u;
  }
  return unit;
}

export function sys1ScriptLine(code: Sys1CoinCode, mem: Sys1Mem, line: number, script: number): CoinLine | null {
  const s = decodeSys1Script(code, mem, script);
  return s ? lineOf(code, mem, line, s) : null;
}

export interface Sys1DryState {
  rom: Uint8Array;
  ram: Uint8Array;
  cpu: Z80;
  io: { read(a: number): number; write(a: number, v: number): void };
}

export function sys1DryRun(code: Sys1CoinCode, st: Sys1DryState, line: number): number | 'refused' | null {
  if (line < 0 || line >= code.lines) return 'refused';
  const ram = st.ram.slice();
  const RAM = ram.length - 1;
  for (let k = 0; k < code.lines; k++) ram[(code.pending + k) & RAM] = 0;
  ram[(code.pending + line) & RAM] = 1;
  const z = new Z80({
    read8: (a) => (a < 0x8000 ? st.rom[a]! : a < 0xa000 ? ram[a & RAM]! : a < 0xc000 ? st.io.read(a) : 0xff),
    write8: (a, v) => { if (a >= 0x8000 && a < 0xa000) ram[a & RAM] = v; else if (a >= 0xa000 && a < 0xc000) st.io.write(a, v); },
  }, { in: () => 0xff, out: () => {} });
  const c = st.cpu;
  z.a = c.a; z.f = c.f; z.b = c.b; z.c = c.c; z.d = c.d; z.e = c.e; z.h = c.h; z.l = c.l;
  z.ix = c.ix; z.iy = c.iy; z.i = c.i; z.im = c.im;
  const SENTINEL = 0xfffe;
  z.sp = (0x8000 + ram.length - 2) & 0xffff;
  ram[z.sp & RAM] = SENTINEL & 0xff;
  ram[(z.sp + 1) & RAM] = SENTINEL >> 8;
  z.pc = code.loop;
  for (let n = 0; n < 20_000; n++) {
    if (z.pc === code.dispatch) return z.hl;
    if (z.pc === SENTINEL || z.pc === code.ret) return 'refused';
    if (z.halted) return null;
    z.step();
  }
  return null;
}

export interface Sys1Solenoids {
  lines: Map<number, number>;
  map: number; queue: number; drain: number; image: number;
}

export function locateSys1Solenoids(mem: Sys1Mem): Sys1Solenoids | Refusal {
  const ROM = 0x8000;
  const L = [0xfe, 0x11, 0x30, -1, 0x21, -1, -1, 0x23, 0x23, 0xcb, 0x7e, 0x20, -1, 0xbe, 0x20, 0xf7, 0x23, 0x7e, 0xcd];
  const look = find(mem, 0, ROM, L);
  if (look.length !== 1) return { refused: look.length ? 'the program\'s output id map was found twice' : 'the program\'s output id map was not found' };
  const map = word(mem, look[0]! + 5);
  const adder = word(mem, look[0]! + 19);
  if (!find(mem, adder, adder + 13, [0xd5, 0xe5, 0x5f, 0x16, 0x00, 0x21, -1, -1, 0x19, 0x19, 0x7e, 0x80, 0x77]).includes(adder)) return { refused: 'the program\'s output timer does not read as one' };
  const queue = word(mem, adder + 6);
  const D = find(mem, 0, ROM, [0x06, 0x10, 0xdd, 0x21, (queue + 32) & 0xff, (queue + 32) >> 8, 0x29, 0xdd, 0x7e, 0x00, 0xdd, 0xb6, 0x01, 0x28, 0x0e]);
  if (D.length !== 1) return { refused: 'the program\'s output drain was not found' };
  const drain = D[0]!;
  const tail = find(mem, drain, drain + 0x30, [0x23, 0xdd, 0x2b, 0xdd, 0x2b, 0x10, 0xe3])[0];
  if (tail === undefined) return { refused: 'the program\'s output drain does not read as one' };
  const st = find(mem, tail + 7, tail + 7 + 8, [0x22])[0];
  if (st === undefined) return { refused: 'the program\'s output image was not found' };
  const image = word(mem, st + 1);
  const portA = (a: number): boolean => a >= 0xa000 && a < 0xc000 && !(a & 0x20) && (a & 3) === 0;
  const loads = find(mem, 0, ROM, [0x2a, image & 0xff, image >> 8]);
  const written = loads.some((ld) => {
    for (let a = ld + 3; a < ld + 3 + 0x30; a++) if (mem(a) === 0x22 && portA(word(mem, a + 1))) return true;
    return false;
  });
  if (!written) return { refused: 'the program\'s output image does not reach the triac port' };
  const lines = new Map<number, number>();
  for (let a = map + 2, n = 0; !(mem(a) & 0x80) && n < 64; a += 2, n++) {
    const id = mem(a); const out = mem(a + 1);
    if (SOLENOIDS.has(id) && out >= 1 && out <= 7) lines.set(out - 1, id);
  }
  if (!lines.size) return { refused: 'the program maps no payout solenoid to the triac port' };
  return { lines, map, queue, drain, image };
}

export interface Sys1PayoutCoin { units: number; token: boolean }
export interface Sys1Payouts {
  coins: Map<number, Sys1PayoutCoin>;
  conflicts: number[];
  scripts: { at: number; id: number; units: number; token: boolean }[];
}

export function locateSys1Payouts(code: Sys1CoinCode, mem: Sys1Mem): Sys1Payouts | Refusal {
  const ROM = 0x8000;
  const seen = new Set<number>();
  const scripts: Sys1Payouts['scripts'] = [];
  for (let a = 0; a + 3 <= ROM; a++) {
    if (mem(a) !== 0x21 && mem(a) !== 0x11) continue;
    const t = word(mem, a + 1);
    if (t >= ROM || seen.has(t) || mem(t) !== 5 || !SOLENOIDS.has(mem(t + 1))) continue;
    seen.add(t);
    const s = decodeSys1Script(code, mem, t);
    if (!s || s.credits !== 0 || s.change.length !== 1 || s.change[0]!.count !== 1) continue;
    const ids = [...s.pulses].filter(([, n]) => n > 0);
    if (ids.length !== 1) continue;
    const [meter, units] = ids[0]!;
    if (meter !== CASH_OUT && meter !== TOKENS_OUT) continue;
    scripts.push({ at: t, id: s.change[0]!.id, units, token: meter === TOKENS_OUT });
  }
  if (!scripts.length) return { refused: 'the program\'s payout scripts were not found' };
  const coins = new Map<number, Sys1PayoutCoin>();
  const conflicts = new Set<number>();
  for (const s of scripts) {
    const c = coins.get(s.id);
    if (!c) { if (!conflicts.has(s.id)) coins.set(s.id, { units: s.units, token: s.token }); continue; }
    if (c.units !== s.units || c.token !== s.token) { coins.delete(s.id); conflicts.add(s.id); }
  }
  return { coins, conflicts: [...conflicts].sort((x, y) => x - y), scripts };
}
