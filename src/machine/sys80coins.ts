import type { CoinLine, CoinLineTable, Refusal, SlotCoin } from './coinwiring';
import { detectCoins } from './coinwiring';

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

export interface Sys80Pulse { port: number; count: number }

export interface Sys80CoinLine {
  line: number;
  credits: number;
  meters: Sys80Pulse[];
  change: { ports: Sys80Pulse[]; units: number | null }[];
  accept: number;
  refill: number | null;
  refillMeters?: Sys80Pulse[];
}

export interface Sys80CoinCode {
  shape: 'scan' | 'script';
  at: number;
  lines: Sys80CoinLine[];
  gate: { flags: number; mask: number } | null;
  refillInput: number | null;
  shared: { accept: number; refill: number | null; first: number; ignore: number; ignoreShift: number } | null;
}

const CODE_END = 0x3000;

const w16 = (rom: Uint8Array, a: number): number => (a >= 0 && a + 1 < rom.length ? (rom[a]! << 8) | rom[a + 1]! : -1);
const disp8 = (w: number): number => ((w & 0xff) ^ 0x80) - 0x80;
const jumpTo = (pc: number, w: number): number => pc + 2 + 2 * disp8(w);

export function insnLength(rom: Uint8Array, a: number): number {
  const w = w16(rom, a);
  if (w < 0) return 2;
  const ext = (t: number): number => (t === 2 ? 2 : 0);
  if (w >= 0x4000) return 2 + ext((w >> 4) & 3) + ext((w >> 10) & 3);
  if (w >= 0x2000) return 2 + ext((w >> 4) & 3);
  if (w >= 0x1000) return 2;
  if (w >= 0x0c00) return 2;
  if (w >= 0x0800) return 2;
  if (w >= 0x0400) return 2 + ext((w >> 4) & 3);
  if (w >= 0x0300) return w === 0x0300 ? 4 : 2;
  if (w >= 0x0200) return (w & 0xffe0) === 0x02a0 || (w & 0xffe0) === 0x02c0 ? 2 : 4;
  return 2;
}

function creditOf(rom: Uint8Array, pc: number): { reg: number; credits: number } | null {
  const w = w16(rom, pc);
  if ((w & 0xfc3f) === 0xa420 && ((w >> 10) & 3) === 1) return { reg: (w >> 6) & 15, credits: w16(rom, w16(rom, pc + 2)) };
  if ((w & 0xfff0) === 0x0590) return { reg: w & 15, credits: 1 };
  if ((w & 0xfff0) === 0x05d0) return { reg: w & 15, credits: 2 };
  return null;
}

function queueOf(rom: Uint8Array, pc: number): { queue: number; count: number } | null {
  if (w16(rom, pc) !== 0xb820) return null;
  const c = w16(rom, pc + 2);
  return { queue: w16(rom, pc + 4), count: c >= 0 && c < rom.length ? rom[c]! : 0 };
}

function locateDrain(rom: Uint8Array, end: number): { lo: number; hi: number; t: number } | null {
  for (let a = 0; a + 12 <= end; a += 2) {
    if (w16(rom, a) !== 0xd321 || w16(rom, a + 4) !== 0x098c || w16(rom, a + 6) !== 0x0a1c || w16(rom, a + 8) !== 0x3048) continue;
    const t = w16(rom, a + 2);
    let lo = -1;
    for (let b = a - 2; b >= Math.max(0, a - 16); b -= 2) if (w16(rom, b) === 0x0201) { lo = w16(rom, b + 2); break; }
    let hi = -1;
    for (let b = a + 10; b < a + 20; b += 2) if (w16(rom, b) === 0x0281) { hi = w16(rom, b + 2); break; }
    if (lo >= 0 && hi > lo) return { lo, hi, t };
  }
  return null;
}

function walk(rom: Uint8Array, from: number, to: number): {
  credit: { reg: number; credits: number } | null; gated: { queue: number; count: number }[]; open: { queue: number; count: number }[];
} | null {
  let credit: { reg: number; credits: number } | null = null;
  const gated: { queue: number; count: number }[] = [];
  const open: { queue: number; count: number }[] = [];
  let gateEnd = -1;
  for (let pc = from; pc < to; pc += insnLength(rom, pc)) {
    const w = w16(rom, pc);
    if (pc >= gateEnd) gateEnd = -1;
    if ((w & 0xff00) === 0x1f00 && (w16(rom, pc + 2) & 0xff00) === 0x1300) {
      const t = jumpTo(pc + 2, w16(rom, pc + 2));
      if (t > pc) gateEnd = Math.min(t, to);
      pc += 2;
      continue;
    }
    const c = creditOf(rom, pc);
    if (c) { if (credit) return null; credit = c; continue; }
    const q = queueOf(rom, pc);
    if (q) (gateEnd > pc ? gated : open).push(q);
  }
  return { credit, gated, open };
}

function locateScan(rom: Uint8Array, end: number): Sys80CoinCode | Refusal | null {
  for (let a = 14; a + 16 <= end; a += 2) {
    if (w16(rom, a) !== 0x020c || w16(rom, a + 4) !== 0x04c1 || w16(rom, a + 6) !== 0x020a) continue;
    if (w16(rom, a + 10) !== 0xc081 || w16(rom, a + 12) !== 0x04c1 || (w16(rom, a + 14) & 0xfc3f) !== 0x3401) continue;
    const base = w16(rom, a + 2) >> 1;
    const count = ((w16(rom, a + 14) >> 6) & 15) || 16;
    if (count > 8) continue;
    const gate = w16(rom, a - 14) === 0xc060 && w16(rom, a - 10) === 0x2060 && w16(rom, a - 6) === 0x1602 && w16(rom, a - 4) === 0x0460
      ? { flags: w16(rom, a - 12), mask: w16(rom, w16(rom, a - 8)) } : null;
    let mask = 0xff00;
    let srl8 = -1;
    for (let pc = a + 16; pc < a + 80 && pc < end; pc += insnLength(rom, pc)) {
      const w = w16(rom, pc);
      if (w === 0x0241) mask = w16(rom, pc + 2);
      if (w === 0x0981) { srl8 = pc; break; }
    }
    if (srl8 < 0) return { refused: `System 80 coin scan at ${hex(a)}: no SRL R1,8 after the read` };
    if ((w16(rom, srl8 + 2) & 0xff00) !== 0x1300 || (w16(rom, srl8 + 4) & 0xff00) !== 0x1000) {
      return { refused: `System 80 coin scan at ${hex(a)}: no branch to its credit code` };
    }
    let pc = jumpTo(srl8 + 4, w16(rom, srl8 + 4));
    let start = -1;
    for (let p = pc, i = 0; i < 6 && p < end; i++, p += insnLength(rom, p)) if ((w16(rom, p) & 0xff0f) === 0x0901) { start = p; break; }
    if (start < 0) return { refused: `System 80 coin scan at ${hex(a)}: no per-line test` };
    const lines: Sys80CoinLine[] = [];
    let reg = -1;
    let bit = 0;
    pc = start;
    let refillInput: number | null = null;
    for (let guard = 0; guard < 16 && (w16(rom, pc) & 0xff0f) === 0x0901 && (w16(rom, pc + 2) & 0xff00) === 0x1700; guard++) {
      bit += ((w16(rom, pc) >> 4) & 15) || 16;
      const blockEnd = jumpTo(pc + 2, w16(rom, pc + 2));
      const blockStart = pc + 4;
      if (blockEnd <= blockStart || blockEnd > end) return { refused: `System 80 coin scan at ${hex(a)}: a line test jumps backwards` };
      const b = bit - 1;
      const live = b < count && ((mask >> 8) & (1 << b)) !== 0;
      let accept = blockStart;
      let refill: number | null = null;
      let creditTo = blockEnd;
      let refillMeters: Sys80Pulse[] = [];
      const w0 = w16(rom, blockStart);
      if ((w0 & 0xff00) === 0x1f00 && (w16(rom, blockStart + 2) & 0xff00) === 0x1300) {
        const alt = jumpTo(blockStart + 2, w16(rom, blockStart + 2));
        const altWalk = alt > blockStart && alt < blockEnd ? walk(rom, alt, blockEnd) : null;
        if (altWalk && !altWalk.credit) {
          refill = alt;
          refillMeters = [...altWalk.gated, ...altWalk.open].map((q) => ({ port: q.queue, count: q.count }));
          accept = blockStart + 4;
          creditTo = alt;
          if (refillInput !== null && refillInput !== (w0 & 0xff)) return { refused: `System 80 coin scan at ${hex(a)}: two refill inputs` };
          refillInput = w0 & 0xff;
        }
      }
      const main = walk(rom, accept, creditTo);
      if (!main) return { refused: `System 80 coin scan at ${hex(a)}: a line credits twice` };
      if (live && main.credit) {
        if (reg >= 0 && reg !== main.credit.reg) return { refused: `System 80 coin scan at ${hex(a)}: two credit registers` };
        reg = main.credit.reg;
        lines.push({
          line: base + b, credits: main.credit.credits,
          meters: main.gated.map((q) => ({ port: q.queue, count: q.count })),
          change: main.open.length ? [{ ports: main.open.map((q) => ({ port: q.queue, count: q.count })), units: null }] : [],
          accept, refill,
          ...(refillMeters.length ? { refillMeters } : {}),
        });
      }
      pc = blockEnd;
      for (let i = 0; i < 2 && (w16(rom, pc) & 0xff0f) !== 0x0901; i++) pc += insnLength(rom, pc);
    }
    if (!lines.length) return { refused: `System 80 coin scan at ${hex(a)}: no line credits` };
    const drain = locateDrain(rom, end);
    if (!drain) return { refused: `System 80 coin scan at ${hex(a)}: its meter drain was not found` };
    const port = (q: number): number => {
      if (q < drain.lo || q >= drain.hi) return -1;
      const at = (drain.t + q) & 0xffff;
      return at < rom.length ? rom[at]! : -1;
    };
    for (const l of lines) {
      for (const m of l.meters) m.port = port(m.port);
      for (const m of l.refillMeters ?? []) m.port = port(m.port);
      for (const c of l.change) for (const p of c.ports) p.port = port(p.port);
      if (l.meters.some((m) => m.port < 0) || (l.refillMeters ?? []).some((m) => m.port < 0) || l.change.some((c) => c.ports.some((p) => p.port < 0))) {
        return { refused: `System 80 coin scan at ${hex(a)}: a pulse queue outside its drain` };
      }
    }
    return { shape: 'scan', at: gate ? a - 14 : a, lines, gate, refillInput, shared: null };
  }
  return null;
}

function locateScript(rom: Uint8Array, end: number): Sys80CoinCode | Refusal | null {
  for (let a = 0; a + 14 <= end; a += 2) {
    const w = w16(rom, a);
    if ((w & 0xff0f) !== 0x0902 || w16(rom, a + 2) !== 0x40a0 || (w16(rom, a + 6) & 0xff00) !== 0x1300) continue;
    if (w16(rom, a + 8) !== 0x0203 || w16(rom, a + 12) !== 0x0223 || w16(rom, a + 14) !== 0x0004 || w16(rom, a + 16) !== 0x0912 || w16(rom, a + 18) !== 0x17fc) continue;
    const shift = (w >> 4) & 15;
    const ignore = w16(rom, a + 4);
    const T = w16(rom, a + 10);
    const where = `System 80 coin entries at ${hex(a)}`;
    let mask = -1; let released = -1;
    for (let b = a - 2; b >= Math.max(0, a - 64); b -= 2) {
      if (w16(rom, b) !== 0x0242 || w16(rom, b - 4) !== 0xc0a0 || (w16(rom, b + 4) & 0xff00) !== 0x1600) continue;
      const t = jumpTo(b + 4, w16(rom, b + 4));
      if (t > b && t <= a) { mask = w16(rom, b + 2); released = w16(rom, b - 2); break; }
    }
    if (mask < 0) return { refused: `${where}: the lines it handles were not found` };
    let base = -1;
    for (let b = 0; b + 4 <= end && base < 0; b += 2) {
      if (w16(rom, b) !== 0xc803 || w16(rom, b + 2) !== released) continue;
      for (let c = b - 2; c >= Math.max(0, b - 48); c -= 2) {
        if (w16(rom, c) === 0x3401) {
          for (let d = c - 2; d >= Math.max(0, c - 12); d -= 2) if (w16(rom, d) === 0x020c) { base = w16(rom, d + 2) >> 1; break; }
          break;
        }
      }
    }
    if (base < 0) return { refused: `${where}: the switch read was not found` };
    let accept = -1; let refillInput: number | null = null; let refillPc: number | null = null;
    for (let pc = a + 20; pc < a + 100 && pc < end; pc += insnLength(rom, pc)) {
      const x = w16(rom, pc);
      if ((x & 0xff00) === 0x1f00 && (w16(rom, pc + 2) & 0xff00) === 0x1600 && w16(rom, pc + 4) === 0x0205 && w16(rom, pc + 6) === 0x0003) refillInput = x & 0xff;
      if (x === 0xb833) { accept = pc; break; }
    }
    if (accept < 0) return { refused: `${where}: its credit add was not found` };
    for (let pc = a + 20; pc < accept; pc += insnLength(rom, pc)) {
      const x = w16(rom, pc);
      if ((x & 0xff00) === 0x1000 && jumpTo(pc, x) === accept + 4) refillPc = pc;
    }
    const scripts = locateScripts(rom, end);
    if ('refused' in scripts) return { refused: `${where}: ${scripts.refused}` };
    const lines: Sys80CoinLine[] = [];
    const n = (mask >> shift) & 0xffff;
    for (let k = 0; k < 16 && (n >> k) & 1; k++) {
      const e = T + 4 * (k + 1);
      if (e + 3 >= rom.length) break;
      const credits = rom[e]!;
      const acts = [rom[e + 1]!, rom[e + 2]!];
      const meters: Sys80Pulse[] = [];
      const runs: { meters: Sys80Pulse[]; drives: Sys80Pulse[]; units: number }[] = [];
      for (const act of acts) {
        const r = scripts.run(act);
        if (!r) return { refused: `${where}: line ${base + shift + k}'s action ${act} is not a script` };
        runs.push(r);
      }
      meters.push(...runs[0]!.meters);
      const change = runs.some((r) => r.units > 0) ? runs.map((r) => ({ ports: r.drives, units: r.units })) : [];
      if (credits === 0 && !change.length) continue;
      lines.push({ line: base + shift + k, credits, meters, change, accept, refill: refillPc });
    }
    if (!lines.length) return { refused: `${where}: no line credits` };
    return {
      shape: 'script', at: a, lines, gate: null, refillInput,
      shared: { accept, refill: refillPc, first: T + 4, ignore, ignoreShift: shift },
    };
  }
  return null;
}

function locateScripts(rom: Uint8Array, end: number): Refusal | {
  run(idx: number): { meters: Sys80Pulse[]; drives: Sys80Pulse[]; units: number } | null;
} {
  let list = -1;
  for (let a = 0; a + 12 <= end; a += 2) {
    if (w16(rom, a) === 0x0202 && w16(rom, a + 4) === 0xc072 && (w16(rom, a + 6) & 0xff00) === 0x1300 && w16(rom, a + 8) === 0xd0d1 && w16(rom, a + 10) === 0x0983 && w16(rom, a + 12) === 0xd0e3) { list = w16(rom, a + 2); break; }
  }
  if (list < 0) return { refused: 'its script list was not found' };
  const scripts = new Map<number, number>();
  for (let p = list; w16(rom, p) > 0 && scripts.size < 64; p += 2) scripts.set(rom[w16(rom, p)]!, w16(rom, p));
  let table = -1; let bound = -1;
  for (let a = 0; a + 12 <= end; a += 2) {
    if (w16(rom, a) !== 0x0202 || w16(rom, a + 4) !== 0xd0f2 || (w16(rom, a + 6) & 0xff00) !== 0x1100 || w16(rom, a + 8) !== 0xd332 || w16(rom, a + 10) !== 0x098c || w16(rom, a + 12) !== 0xd2b2) continue;
    table = w16(rom, a + 2);
    for (let b = a + 14; b < a + 60; b += 2) {
      if (w16(rom, b) === 0x0282 && (w16(rom, b + 4) & 0xff00) === 0x1a00 && (w16(rom, b + 6) & 0xff00) === 0x1600 && w16(rom, b + 8) === 0x05a0) {
        const inct = jumpTo(b + 6, w16(rom, b + 6));
        if (w16(rom, inct) === 0x05e0) bound = w16(rom, b + 2);
        break;
      }
    }
    break;
  }
  if (table < 0 || bound < 0) return { refused: 'its drive table was not found' };
  const drive = new Map<number, { ports: number[]; units: number }>();
  for (let e = table; e + 2 < rom.length && rom[e]! < 0x80 && drive.size < 64; e += 3) {
    drive.set(rom[e]!, { ports: [rom[e + 1]! >> 1, rom[e + 2]! >> 1], units: e + 3 < bound ? 0 : e + 3 === bound ? 1 : 2 });
  }
  const run = (idx: number, depth: number): { meters: Sys80Pulse[]; drives: Sys80Pulse[]; units: number } | null => {
    const p = scripts.get(idx);
    if (p === undefined || depth > 3) return null;
    const nD = rom[p + 1]!;
    let q = p + 2 + nD;
    const nF = rom[q++]!;
    const out = { meters: [] as Sys80Pulse[], drives: [] as Sys80Pulse[], units: 0 };
    for (let i = 0; i < nF; i++, q += 2) {
      const count = rom[q]!; const to = rom[q + 1]!;
      const d = drive.get(to);
      if (d && d.units === 0) out.meters.push({ port: d.ports[0]!, count });
      else if (d) { out.units += count * d.units; out.drives.push({ port: d.ports[0]!, count }); }
      else if (scripts.has(to)) {
        const r = run(to, depth + 1);
        if (!r) return null;
        out.units += count * r.units;
        for (const x of r.drives) out.drives.push({ port: x.port, count: x.count * count });
      }
    }
    return out;
  };
  return { run: (idx) => run(idx, 0) };
}

export function locateSys80Coins(rom: Uint8Array): Sys80CoinCode | Refusal {
  const end = Math.min(rom.length, CODE_END);
  const a = locateScan(rom, end);
  if (a && !('refused' in a)) return a;
  const b = locateScript(rom, end);
  if (b && !('refused' in b)) return b;
  return a ?? b ?? { refused: 'no System 80 coin code this board reads was found in the program' };
}

export function sys80CoinTable(code: Sys80CoinCode, tokenPorts: readonly number[]): CoinLineTable {
  const isToken = (l: Sys80CoinLine): boolean => l.meters.some((m) => tokenPorts.includes(m.port));
  const base: CoinLine[] = code.lines.map((l) => ({
    line: l.line, credits: l.credits,
    change: l.change.every((c) => c.units === null) ? l.change.map((c) => c.ports.map((p) => ({ count: p.count, tube: p.port }))) : [],
    ...(isToken(l) ? { token: true } : {}),
  }));
  const source = `JPM System 80 coin ${code.shape === 'scan' ? 'scan' : 'entries'} ${hex(code.at)}`;
  const units = code.lines.filter((l) => l.change.some((c) => c.units !== null));
  if (!units.length) return { lines: base, pricePerCredit: null, source };
  const plain = base.filter((b) => !units.some((u) => u.line === b.line));
  const p = priceOf({ lines: plain, pricePerCredit: null, source });
  const lines = base.flatMap((b) => {
    const u = units.find((x) => x.line === b.line);
    if (!u) return [b];
    if (p === null) return [];
    return [{ ...b, change: u.change.map((c) => [{ count: c.units!, pence: p }]) }];
  });
  return { lines, pricePerCredit: null, source };
}

function priceOf(table: CoinLineTable): number | null {
  const coins = detectCoins(table);
  if (!(coins instanceof Map)) return null;
  for (const l of table.lines) {
    const c = coins.get(l.line);
    if (typeof c === 'number' && !l.change.length && l.credits > 0) return c / l.credits;
  }
  return null;
}

export function sys80ProgramCoins(table: CoinLineTable): Map<number, { coin: SlotCoin; change: number }> | null {
  const coins = detectCoins(table);
  if (!(coins instanceof Map)) return null;
  const p = priceOf(table);
  const out = new Map<number, { coin: SlotCoin; change: number }>();
  for (const l of table.lines) {
    const c = coins.get(l.line);
    if (c === undefined) continue;
    const v = typeof c === 'number' ? c : c.token;
    const change = l.change.length && p !== null && v !== null ? Math.max(0, Math.round(v - l.credits * p)) : 0;
    out.set(l.line, { coin: c, change });
  }
  return out;
}

export function sys80PortPulses(rom: Uint8Array, port: number): number[] | null {
  const end = Math.min(rom.length, CODE_END);
  const drain = locateDrain(rom, end);
  if (!drain) return null;
  const out: number[] = [];
  for (let pc = 0; pc + 6 <= end; pc += 2) {
    const q = queueOf(rom, pc);
    if (!q || q.queue < drain.lo || q.queue >= drain.hi) continue;
    const at = (drain.t + q.queue) & 0xffff;
    if (at < rom.length && rom[at] === port) out.push(q.count);
  }
  return out;
}

export function sys80PlayMeterPrice(
  rom: Uint8Array,
  code: Sys80CoinCode,
  gridIn: readonly { ports: readonly number[]; pence: number }[],
): number | null {
  const coinPorts = new Set<number>();
  for (const l of code.lines) {
    for (const m of [...l.meters, ...(l.refillMeters ?? [])]) coinPorts.add(m.port);
    for (const c of l.change) for (const p of c.ports) coinPorts.add(p.port);
  }
  const prices = new Set<number>();
  for (const g of gridIn) {
    if (g.pence <= 0 || !g.ports.length || g.ports.some((p) => coinPorts.has(p))) continue;
    const counts = g.ports.flatMap((p) => sys80PortPulses(rom, p) ?? []);
    if (!counts.length || counts.some((c) => c !== counts[0])) continue;
    prices.add(g.pence * counts[0]!);
  }
  return prices.size === 1 ? [...prices][0]! : null;
}
