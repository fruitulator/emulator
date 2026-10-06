#!/usr/bin/env node
import { readFileSync } from 'node:fs';

export function loadRom(paths) {
  if (paths.length === 1) return readFileSync(paths[0]);
  const parts = paths.map((p) => readFileSync(p));
  const pairs = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [a, b] = [parts[i], parts[i + 1]];
    const rom = Buffer.alloc(a.length + b.length);
    for (let k = 0; k < a.length; k++) { rom[k * 2] = a[k]; rom[k * 2 + 1] = b[k]; }
    pairs.push(rom);
  }
  return Buffer.concat(pairs);
}

const be16 = (rom, a) => (rom[a] << 8) | rom[a + 1];
const be32 = (rom, a) => ((rom[a] << 24) | (rom[a + 1] << 16) | (rom[a + 2] << 8) | rom[a + 3]) >>> 0;

function stringAt(rom, a) {
  if (a < 0 || a >= rom.length) return null;
  let s = '';
  for (let i = a; i < rom.length && i < a + 24; i++) {
    const c = rom[i];
    if (c === 0) return s.length >= 2 ? s.trimEnd() : null;
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return null;
}

function recordAt(rom, a) {
  if (a + 8 > rom.length) return null;
  const number = be16(rom, a);
  const code = be16(rom, a + 2);
  const ptr = be32(rom, a + 4);
  if (number === 0 || number > 0x3ff || code > 0x3ff) return null;
  const name = stringAt(rom, ptr);
  return name ? { at: a, number, code, ptr, name } : null;
}

export function findTables(rom, min = 10) {
  const tables = [];
  let a = 0;
  while (a + 8 <= rom.length) {
    if (!recordAt(rom, a)) { a += 2; continue; }
    const run = [];
    let b = a;
    for (;;) {
      const r = recordAt(rom, b);
      if (!r) break;
      run.push(r);
      b += 8;
    }
    if (run.length >= min) tables.push(run);
    a = Math.max(a + 2, b);
  }
  return tables.sort((x, y) => y.length - x.length);
}

export function findTables12(rom, min = 8) {
  const ok = (a) => a + 12 <= rom.length
    && be16(rom, a) !== 0 && be16(rom, a) <= 0x3ff && be16(rom, a + 2) === 0
    && stringAt(rom, be32(rom, a + 4));
  const tables = [];
  let a = 0;
  while (a + 12 <= rom.length) {
    if (!ok(a)) { a += 2; continue; }
    const run = [];
    let b = a;
    while (ok(b)) {
      run.push({ at: b, number: be16(rom, b), name: stringAt(rom, be32(rom, b + 4)),
        lamped: rom[b + 8] === 1, lamp: be16(rom, b + 10) });
      b += 12;
    }
    if (run.length >= min) tables.push(run);
    a = Math.max(a + 2, b);
  }
  return tables.sort((x, y) => y.length - x.length);
}

const NAME_SPAN = 0x2000;

export function findNameArrays(rom, min = 16) {
  const slot = (a) => {
    if (a + 4 > rom.length) return undefined;
    const p = be32(rom, a);
    if (p === 0 || p >= rom.length) return undefined;
    if (rom[p] === 0) return '';
    return stringAt(rom, p) ?? undefined;
  };
  const arrays = [];
  const stops = new Set();
  const emitted = new Set();
  let a = 0;
  while (a + 4 <= rom.length) {
    if (!slot(a)) { a += 2; continue; }
    let base = a;
    while (base >= 4 && slot(base - 4) !== undefined && !stops.has(base)) base -= 4;
    const names = [];
    let cut = -1;
    let lo = Infinity, hi = -Infinity;
    for (let b = base; b + 4 <= rom.length; b += 4) {
      const s = slot(b);
      if (s === undefined) break;
      const p = be32(rom, b);
      if (names.length && (p < lo - NAME_SPAN || p > hi + NAME_SPAN)) break;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
      const v = /^\d+$/.test(s.trim()) ? Number(s.trim()) : null;
      if (v !== null && v !== names.length) {
        const at = names.length - v;
        if (at > 0 && at <= names.length) cut = at;
        break;
      }
      names.push(s);
    }
    if (cut >= 0) names.length = cut;
    if (names.filter(Boolean).length >= min && !emitted.has(base)) {
      const numbered = names.filter((s) => /^\d+$/.test(s.trim())).length;
      arrays.push({ at: base, names, numbered });
      emitted.add(base);
    }
    const next = base + names.length * 4;
    stops.add(next);
    a = Math.max(a + 2, next);
  }
  return arrays.sort((x, y) => y.names.length - x.names.length);
}

const SWITCH_ONLY = ['TEST', 'REFILL', 'CASHDOOR', 'CASH DOOR', 'SERVICEDOOR', 'MAIN DOOR',
  'HOPHIGH', 'HOPLOW', 'DUMPFLOAT', 'DEFLOAT', 'REFLOAT', 'TOPUP', 'CSHDOOR'];
const switchy = (names) => SWITCH_ONLY.filter((n) => names.includes(n)).length;

export function findInputs(rom) {
  for (const t of findTables(rom)) {
    if (t.some((r) => r.code !== 0) && t.some((r) => r.name.trim() === 'START')) {
      return { shape: 'A8', at: t[0].at, records: t.map((r) => ({ number: r.number, name: r.name.trim(), lamp: r.code })) };
    }
  }
  for (const t of findTables12(rom)) {
    if (t.some((r) => r.name.trim() === 'START')) {
      return { shape: 'B12', at: t[0].at, records: t.map((r) => ({ number: r.number, name: r.name.trim(), lamp: r.lamped ? r.lamp : 0 })) };
    }
  }
  for (const a of findNameArrays(rom)) {
    if (switchy(a.names.map((s) => s.trim())) < 3) continue;
    return { shape: 'C4', at: a.at, proved: a.numbered,
      records: a.names.map((name, number) => ({ number, name: name.trim(), lamp: 0 }))
        .filter((r) => r.name && !/^\d+$/.test(r.name)) };
  }
  return null;
}

const ALARM_SLOT = 18;
const alarmAt = (rom, a) => {
  if (a + ALARM_SLOT > rom.length) return null;
  const s = rom.subarray(a, a + ALARM_SLOT);
  if (s[ALARM_SLOT - 1] !== 0) return null;
  if (s[1] !== 0x2e || s[3] !== 0x20) return null;
  if (s[0] < 0x30 || s[0] > 0x39 || s[2] < 0x30 || s[2] > 0x39) return null;
  for (let i = 4; i < ALARM_SLOT - 1; i++) if (s[i] < 0x20 || s[i] > 0x7e) return null;
  return { at: a, code: String.fromCharCode(s[0], s[1], s[2]),
    text: s.toString('latin1', 4, ALARM_SLOT - 1).trim() };
};

export function findAlarms(rom, min = 8) {
  let best = [];
  for (let a = 0; a + ALARM_SLOT <= rom.length; a += 2) {
    if (!alarmAt(rom, a)) continue;
    const run = [];
    for (let b = a; ; b += ALARM_SLOT) {
      const r = alarmAt(rom, b);
      if (!r) break;
      run.push(r);
    }
    if (run.length > best.length) best = run;
    a += (run.length - 1) * ALARM_SLOT;
  }
  return best.length >= min ? best : [];
}

if (!process.argv[1] || !process.argv[1].endsWith('epoch-tables.mjs')) {
} else main();

function main() {
const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: node tools/epoch-tables.mjs <game.g0> <game.g1> | <rom>');
  process.exit(2);
}
const rom = loadRom(args);
const inputs = findInputs(rom);
if (inputs) {
  const proof = inputs.proved ? `, ${inputs.proved} indices proved by the ROM's own placeholders` : '';
  console.log(`\n== inputs (test 4.1): ${inputs.records.length} records, shape ${inputs.shape}, at 0x${inputs.at.toString(16)}${proof}`);
  console.log('   fw  layout   lamp  name');
  for (const r of inputs.records) {
    console.log(`  ${String(r.number).padStart(3)}  ${String(r.number - 1).padStart(6)}  ` +
      `${r.lamp ? String(r.lamp - 1).padStart(5) : '     '}  ${r.name}`);
  }
} else {
  console.log('\n== inputs: none found in this image');
}
const arrays = findNameArrays(rom).filter((a) => a.at !== inputs?.at);
for (const a of arrays.slice(0, 2)) {
  console.log(`\n== name array: ${a.names.length} entries at 0x${a.at.toString(16)}` +
    `${a.numbered ? ` (${a.numbered} unnamed slots hold their own index)` : ''}`);
  console.log(`   ${a.names.map((s, i) => (s && !/^\d+$/.test(s.trim()) ? `${i}:${s.trim()}` : null)).filter(Boolean).slice(0, 40).join('  ')}`);
}
const tables = findTables(rom);
for (const t of tables) {
  const kind = t.some((r) => r.code !== 0) ? 'inputs (test 4.1)' : 'lamps (test 3.2)';
  console.log(`\n== ${kind}: ${t.length} records at 0x${t[0].at.toString(16)}`);
  console.log('   fw  layout   lamp  name');
  for (const r of t) {
    const lamp = r.code ? `${String(r.code - 1).padStart(5)}` : '     ';
    console.log(`  ${String(r.number).padStart(3)}  ${String(r.number - 1).padStart(6)}  ${lamp}  ${r.name}`);
  }
}
const alarms = findAlarms(rom);
if (alarms.length) {
  console.log(`\n== alarms: ${alarms.length} slots at 0x${alarms[0].at.toString(16)}`);
  for (const a of alarms) console.log(`  ${a.code}  ${a.text}`);
}
}
