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
  token?: boolean;
}

export interface Sys80CoinCode {
  shape: 'scan' | 'script';
  at: number;
  lines: Sys80CoinLine[];
  gate: { flags: number; mask: number } | null;
  refillInput: number | null;
  shared: { accept: number; refill: number | null; first: number; ignore: number; ignoreShift: number; reg?: number; stride?: number } | null;
  judgeOnly?: boolean;
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
  const j = locateJudged(rom, end);
  if (j) return j;
  return a ?? b ?? { refused: 'no System 80 coin code this board reads was found in the program' };
}

function locateJudged(rom: Uint8Array, end: number): Sys80CoinCode | null {
  for (let a = 14; a + 40 <= end; a += 2) {
    const c = judgedC(rom, a, end) ?? judgedD(rom, a, end) ?? judgedE(rom, a, end);
    if (c) return c;
  }
  return null;
}

function judgedC(rom: Uint8Array, a: number, end: number): Sys80CoinCode | null {
  if (w16(rom, a) !== 0x020c || w16(rom, a + 4) !== 0x04c1 || w16(rom, a + 6) !== 0x020a || w16(rom, a + 10) !== 0xc081) return null;
  if ((w16(rom, a + 12) & 0xfc3f) !== 0x3401 || w16(rom, a + 14) !== 0x8081) return null;
  const base = w16(rom, a + 2) >> 1;
  const gate = w16(rom, a - 14) === 0xc260 && w16(rom, a - 10) === 0x2260 && w16(rom, a - 6) === 0x1602 && w16(rom, a - 4) === 0x0460
    ? { flags: w16(rom, a - 12), mask: w16(rom, w16(rom, a - 8)) } : null;
  let mask = -1; let ignore = -1; let accept = -1; let t = -1;
  for (let pc = a + 16, i = 0; i < 64 && pc < end; i++, pc += insnLength(rom, pc)) {
    const w = w16(rom, pc);
    if (w === 0x0242 && mask < 0) mask = w16(rom, pc + 2);
    if (w === 0x4060 && ignore < 0) ignore = w16(rom, pc + 2);
    if (w === 0x0911 && (w16(rom, pc + 2) & 0xff00) === 0x1700 && w16(rom, pc + 4) === 0xc802
      && w16(rom, pc + 8) === 0xd820 && w16(rom, pc + 14) === 0xb826) {
      accept = pc + 4;
      t = w16(rom, pc + 16);
      break;
    }
  }
  if (mask <= 0 || mask > 0xff || ignore < 0 || accept < 0) return null;
  const at = gate ? a - 14 : a;
  const priced = pricedC(rom, end, accept, t, base, mask, ignore);
  if (priced) return { shape: 'scan', at, gate, ...priced };
  const lines: Sys80CoinLine[] = [];
  for (let k = 0; k < 8 && (mask >> k) & 1; k++) {
    lines.push({ line: base + k, credits: rom[t + 8 * k] ?? 0, meters: [], change: [], accept, refill: null });
  }
  return {
    shape: 'scan', at, lines, gate, refillInput: null, judgeOnly: true,
    shared: { accept, refill: null, first: 0, ignore, ignoreShift: 0, reg: 6, stride: 8 },
  };
}

function pricedC(rom: Uint8Array, end: number, accept: number, t: number, base: number, mask: number, ignore: number):
  Pick<Sys80CoinCode, 'lines' | 'shared' | 'refillInput'> | null {
  let alt = -1; let normal = -1;
  for (let pc = accept + 16, i = 0; i < 6 && pc < end; i++, pc += insnLength(rom, pc)) {
    if (w16(rom, pc) === 0x2260 && (w16(rom, pc + 4) & 0xff00) === 0x1600) {
      alt = pc + 6;
      normal = jumpTo(pc + 4, w16(rom, pc + 4));
      break;
    }
  }
  const armOff = (pc: number): number => (w16(rom, pc) === 0xc1e6 && w16(rom, pc + 4) === 0xb5e0 ? w16(rom, pc + 2) - t : -1);
  if (alt < 0 || armOff(alt) !== 4 || armOff(normal) !== 2) return null;
  const flag = w16(rom, w16(rom, alt - 4));
  let refillInput: number | null = null;
  for (let pc = Math.max(0, accept - 160); pc < accept; pc += 2) {
    if (w16(rom, pc) !== 0xc181 || (w16(rom, pc + 2) & 0xff0f) !== 0x0a06 || w16(rom, pc + 4) !== 0x0246 || w16(rom, pc + 8) !== 0xe246) continue;
    const sh = (w16(rom, pc + 2) >> 4) & 15;
    if (flag > 0 && (flag & (flag - 1)) === 0 && (flag & w16(rom, pc + 6)) === flag) refillInput = base + Math.log2(flag) - sh;
    break;
  }
  if (refillInput === null) return null;
  let list = -1; let listEnd = -1; let cbase = -1;
  for (let a = 0; a + 20 <= end && list < 0; a += 2) {
    if (w16(rom, a) !== 0x0209 || w16(rom, a + 4) !== 0x0201 || w16(rom, a + 6) !== 0x0100 || w16(rom, a + 8) !== 0x04c6
      || w16(rom, a + 10) !== 0xd219 || w16(rom, a + 12) !== 0x0988 || w16(rom, a + 14) !== 0x9a20) continue;
    list = w16(rom, a + 2);
    cbase = w16(rom, a + 18);
    for (let b = a + 20; b < a + 120 && b < end; b += 2) if (w16(rom, b) === 0x0289) { listEnd = w16(rom, b + 2); break; }
  }
  if (list < 0 || listEnd <= list) return null;
  let lo = -1; let hi = -1;
  for (let a = 0; a + 20 <= end && lo < 0; a += 2) {
    if (w16(rom, a) !== 0x0287 || (w16(rom, a + 4) & 0xff00) !== 0x1a00 || w16(rom, a + 6) !== 0x0287
      || (w16(rom, a + 10) & 0xff00) !== 0x1400 || w16(rom, a + 12) !== 0xc320 || w16(rom, a + 18) !== 0xb9c8 || w16(rom, a + 20) !== cbase) continue;
    lo = w16(rom, a + 2); hi = w16(rom, a + 8);
  }
  if (lo < 0 || hi <= lo) return null;
  const port = new Map<number, number>();
  for (let a = 0; a + 16 <= end && !port.size; a += 2) {
    if (w16(rom, a) !== 0x0201 || w16(rom, a + 4) !== 0xd0b1 || (w16(rom, a + 6) & 0xff00) !== 0x1100 || w16(rom, a + 8) !== 0x0982
      || w16(rom, a + 10) !== 0xd331 || w16(rom, a + 12) !== 0x98a0) continue;
    const q0 = w16(rom, a + 16) - cbase;
    for (let e = w16(rom, a + 2); e + 1 < rom.length && rom[e]! < 0x80 && port.size < 32; e += 2) port.set(q0 + rom[e]!, rom[e + 1]! >> 1);
  }
  if (!port.size) return null;
  const scripts = new Map<number, number>();
  for (let p = list; p < listEnd && scripts.size < 32;) {
    scripts.set(rom[p]!, p);
    const q = p + 2 + rom[p + 1]!;
    p = q + 1 + 2 * rom[q]!;
  }
  const run = (id: number, times: number, depth: number, out: { meters: Sys80Pulse[]; change: Sys80Pulse[]; credits: number }): boolean => {
    const p = scripts.get(id);
    if (p === undefined || depth > 3) return false;
    let q = p + 2 + rom[p + 1]!;
    const n = rom[q++]!;
    for (let i = 0; i < n; i++, q += 2) {
      const count = rom[q]! * times; const to = rom[q + 1]!;
      if (to < 16) { if (!run(to, count, depth + 1, out)) return false; continue; }
      const at = port.get(to);
      if (at !== undefined) (to >= lo && to < hi ? out.meters : out.change).push({ port: at, count });
      else out.credits += ((rom[q]! ^ 0x80) - 0x80) * times;
    }
    return true;
  };
  const lines: Sys80CoinLine[] = [];
  for (let k = 0; k < 8 && (mask >> k) & 1; k++) {
    const e = t + 8 * k;
    const credits = rom[e]!;
    const nId = w16(rom, e + 2) - cbase; const aId = w16(rom, e + 4) - cbase;
    const main = { meters: [] as Sys80Pulse[], change: [] as Sys80Pulse[], credits: 0 };
    if (!run(nId, 1, 0, main)) return null;
    let refill: number | null = null;
    let refillMeters: Sys80Pulse[] = [];
    let token = false;
    if (aId !== nId) {
      const r = { meters: [] as Sys80Pulse[], change: [] as Sys80Pulse[], credits: 0 };
      if (!run(aId, 1, 0, r) || r.change.length || ((credits + r.credits) & 0xff) !== 0) return null;
      refill = alt;
      refillMeters = r.meters;
      token = true;
    }
    lines.push({
      line: base + k, credits, meters: main.meters,
      change: main.change.length ? [{ ports: main.change, units: null }] : [],
      accept: normal, refill, ...(refillMeters.length ? { refillMeters } : {}), ...(token ? { token } : {}),
    });
  }
  if (!lines.some((l) => l.credits > 0 || l.change.length)) return null;
  return { lines, refillInput, shared: { accept: normal, refill: alt, first: 0, ignore, ignoreShift: 0, reg: 6, stride: 8 } };
}

function judgedD(rom: Uint8Array, a: number, end: number): Sys80CoinCode | null {
  if (w16(rom, a) !== 0x40a0 || (w16(rom, a + 4) & 0xff00) !== 0x1300 || w16(rom, a + 6) !== 0x0203) return null;
  if (w16(rom, a + 10) !== 0x0223 || w16(rom, a + 12) !== 3 || w16(rom, a + 14) !== 0x0912 || w16(rom, a + 16) !== 0x17fc) return null;
  const ignore = w16(rom, a + 2);
  const T = w16(rom, a + 8);
  if (w16(rom, a + 18) !== 0x04cc || (w16(rom, a + 20) & 0xff00) !== 0x1f00 || w16(rom, a + 24) !== 0x05c3) return null;
  const refillInput = w16(rom, a + 20) & 0xff;
  const j = a + 30;
  const refill = (w16(rom, j) & 0xff00) === 0x1000 ? jumpTo(j, w16(rom, j)) : null;
  let accept = -1;
  for (let pc = a + 32, i = 0; i < 12 && pc < end; i++, pc += insnLength(rom, pc)) if (w16(rom, pc) === 0xb833) { accept = pc; break; }
  if (accept < 0) return null;
  let mask = -1; let released = -1;
  for (let b = a - 2; b >= Math.max(4, a - 64); b -= 2) {
    if (w16(rom, b) !== 0x0242 || w16(rom, b - 4) !== 0xc0a0 || (w16(rom, b + 4) & 0xff00) !== 0x1600) continue;
    const to = jumpTo(b + 4, w16(rom, b + 4));
    if (to > b && to <= a) { mask = w16(rom, b + 2); released = w16(rom, b - 2); break; }
  }
  if (mask <= 0) return null;
  let base = -1;
  for (let b = 0; b + 4 <= end && base < 0; b += 2) {
    if (w16(rom, b) !== 0xc803 || w16(rom, b + 2) !== released) continue;
    for (let c = b - 2; c >= Math.max(0, b - 48) && base < 0; c -= 2) {
      if ((w16(rom, c) & 0xfc3f) !== 0x3401) continue;
      for (let d = c - 2; d >= Math.max(0, c - 12); d -= 2) if (w16(rom, d) === 0x020c) { base = w16(rom, d + 2) >> 1; break; }
    }
  }
  if (base < 0) return null;
  const shared = { accept, refill, first: T + 3, ignore, ignoreShift: 0, stride: 3 };
  const priced = pricedD(rom, end, T, base, mask, accept, refill);
  if (priced) return { shape: 'script', at: a, lines: priced, gate: null, refillInput, shared };
  const lines: Sys80CoinLine[] = [];
  for (let k = 0; k < 16 && (mask >> k) & 1; k++) {
    lines.push({ line: base + k, credits: rom[T + 3 * (k + 1)] ?? 0, meters: [], change: [], accept, refill });
  }
  return { shape: 'script', at: a, lines, gate: null, refillInput, judgeOnly: true, shared };
}

function pricedD(rom: Uint8Array, end: number, T: number, base: number, mask: number, accept: number, refill: number | null): Sys80CoinLine[] | null {
  let list = -1; let sBase = -1; let table = -1; let qBase = -1;
  for (let a = 0; a + 16 <= end; a += 2) {
    if (list < 0 && w16(rom, a) === 0x0202 && w16(rom, a + 4) === 0xc072 && (w16(rom, a + 6) & 0xff00) === 0x1300 && w16(rom, a + 8) === 0xd0d1
      && w16(rom, a + 10) === 0x0983 && w16(rom, a + 12) === 0xd0e3) { list = w16(rom, a + 2); sBase = w16(rom, a + 14); }
    if (table < 0 && w16(rom, a) === 0x0202 && w16(rom, a + 4) === 0xd0f2 && (w16(rom, a + 6) & 0xff00) === 0x1100 && w16(rom, a + 8) === 0xd332
      && w16(rom, a + 10) === 0x098c && w16(rom, a + 12) === 0xd2b2) table = w16(rom, a + 2);
    if (qBase < 0 && w16(rom, a) === 0xd131 && w16(rom, a + 2) === 0x0884) {
      for (let b = a + 4; b < a + 16; b += 2) if (w16(rom, b) === 0xb903) { qBase = w16(rom, b + 2); break; }
    }
  }
  if (list < 0 || table < 0 || qBase <= sBase) return null;
  const scripts = new Map<number, number>();
  for (let p = list; w16(rom, p) > 0 && scripts.size < 64; p += 2) scripts.set(rom[w16(rom, p)]!, w16(rom, p));
  const drive = new Map<number, [number, number]>();
  for (let e = table; e + 2 < rom.length && rom[e]! < 0x80 && drive.size < 64; e += 3) drive.set(rom[e]!, [rom[e + 1]! >> 1, rom[e + 2]! >> 1]);
  const run = (idx: number, times: number, depth: number, out: { meters: Sys80Pulse[]; change: Sys80Pulse[] }): boolean => {
    const p = scripts.get(idx);
    if (p === undefined || depth > 3) return false;
    let q = p + 2 + rom[p + 1]!;
    const n = rom[q++]!;
    for (let i = 0; i < n; i++, q += 2) {
      const count = rom[q]! * times; const to = (rom[q + 1]! ^ 0x80) - 0x80;
      if (to < 0) { if (!run(qBase + to - sBase, count, depth + 1, out)) return false; continue; }
      const d = drive.get(to);
      if (d) (d[0] === d[1] ? out.meters : out.change).push({ port: d[0], count });
    }
    return true;
  };
  const lines: Sys80CoinLine[] = [];
  const refills: number[] = [];
  for (let k = 0; k < 16 && (mask >> k) & 1; k++) {
    const e = T + 3 * (k + 1);
    if (e + 2 >= rom.length) return null;
    const r = { meters: [] as Sys80Pulse[], change: [] as Sys80Pulse[] };
    if (!run(rom[e + 1]!, 1, 0, r)) return null;
    if (rom[e + 2]! !== 0) {
      if (!run(rom[e + 2]!, 1, 0, { meters: [], change: [] })) return null;
      refills.push(k);
    }
    lines.push({
      line: base + k, credits: rom[e]!, meters: r.meters,
      change: r.change.length ? [{ ports: r.change, units: null }] : [],
      accept, refill,
    });
  }
  if (refills.length === 1) lines[refills[0]!]!.token = true;
  return lines.some((l) => l.credits > 0 || l.change.length) ? lines : null;
}

function judgedE(rom: Uint8Array, a: number, end: number): Sys80CoinCode | null {
  if (w16(rom, a) !== 0x020c || (w16(rom, a + 4) & 0xff00) !== 0x1e00 || (w16(rom, a + 6) & 0xff00) !== 0x1d00) return null;
  if ((w16(rom, a + 8) & 0xfc3f) !== 0x340a || w16(rom, a + 10) !== 0x4283 || w16(rom, a + 12) !== 0x4284) return null;
  const base = w16(rom, a + 2) >> 1;
  const count = ((w16(rom, a + 8) >> 6) & 15) || 16;
  let credit = -1; let accept = -1; let refill: number | null = null;
  for (let pc = a + 14, i = 0; i < 128 && pc < end; i++, pc += insnLength(rom, pc)) {
    const w = w16(rom, pc);
    if (w === 0x6807 && credit < 0) credit = w16(rom, pc + 2);
    if (w !== 0xa807 || credit < 0) continue;
    if (accept < 0) { if (w16(rom, pc + 2) === credit) accept = pc; continue; }
    if (w16(rom, pc + 2) !== credit && w16(rom, pc - 4) === w16(rom, accept - 4)) { refill = pc; break; }
  }
  if (accept < 0) return null;
  const lines: Sys80CoinLine[] = [];
  for (let k = 0; k < count; k++) lines.push({ line: base + k, credits: 0, meters: [], change: [], accept, refill });
  return { shape: 'scan', at: a, lines, gate: null, refillInput: null, shared: null, judgeOnly: true };
}

export function sys80CoinTable(code: Sys80CoinCode, tokenPorts: readonly number[]): CoinLineTable {
  const isToken = (l: Sys80CoinLine): boolean => !!l.token || l.meters.some((m) => tokenPorts.includes(m.port));
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
