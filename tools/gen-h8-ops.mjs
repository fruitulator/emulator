#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const LST = new URL('./vendor/h8.lst', import.meta.url);
const HELPERS = new URL('./vendor/h8-helpers.cpp', import.meta.url);

const DTYPE = 1;
const OTYPE = { o: 0, h: 1, s20: 2, s26: 3, g: 4 };

const fail = (why, line) => {
  process.stderr.write(`gen-h8-ops: ${why}\n  ${line}\n`);
  process.exit(1);
};

class Opcode {
  constructor(val, mask, skip, name, am1, am2, otype) {
    this.val = val;
    this.mask = mask;
    this.skip = Number(skip);
    this.name = name;
    this.am1 = am1;
    this.am2 = am2;
    this.otype = otype;
    this.body = [];
    this.enabled = otype === -1
      || (otype === 0 && DTYPE === 0)
      || (otype !== 0 && DTYPE >= otype);
    let extra = 0;
    const a16 = ['abs16', 'abs16e', 'abs22e', 'abs24e'];
    if ((a16.includes(am1) || am2 === 'abs16') && this.skip === 0) extra += 1;
    if ((am1 === 'abs32' || am2 === 'abs32') && this.skip === 0) extra += 2;
    if (am1 === 'imm16' || am1 === 'rel16'
      || am1 === 'r16d16h' || am2 === 'r16d16h'
      || am1 === 'r32d16h' || am2 === 'r32d16h') extra += 1;
    if (am1 === 'imm32' || am1 === 'r32d32hh' || am2 === 'r32d32hh') extra += 2;
    this.extraWords = extra;
  }

  get bytes() { return this.val.length / 2; }
}

const opcodes = [];
const specials = [];
const macros = new Map();
let cur = null;

for (const raw of readFileSync(LST, 'utf8').split('\n')) {
  if (raw.startsWith('#')) continue;
  const line = raw.replace(/\s+$/, '');
  if (!line) continue;
  if (/^[ \t]/.test(line)) {
    if (!cur) continue;
    const tokens = line.trim().split(/\s+/);
    const macro = macros.get(tokens[0]);
    if (macro) macro.apply(cur, tokens);
    else cur.body.push(line);
    continue;
  }
  const t = line.split(/\s+/);
  if (t[0] === 'macro') {
    const params = t.slice(2);
    const macro = {
      name: t[1],
      params,
      body: [],
      apply(target, tokens) {
        const values = [];
        for (let i = 0; i < params.length - 1; i++) values.push(tokens[i + 1]);
        values.push(tokens.slice(params.length).join(' '));
        for (const l of macro.body) {
          let out = l;
          params.forEach((p, j) => { out = out.split(p).join(values[j]); });
          target.body.push(out);
        }
      },
    };
    macros.set(macro.name, macro);
    cur = macro;
  } else if (t.length === 2 || t.length === 3) {
    const otype = t.length === 3 ? OTYPE[t[2]] : -1;
    cur = { special: t[1], id: parseInt(t[0], 16), otype, body: [] };
    specials.push(cur);
  } else if (t.length === 6 || t.length === 7) {
    const otype = t.length === 7 ? OTYPE[t[6]] : -1;
    if (otype === undefined) fail('unknown type flag', line);
    cur = new Opcode(t[0], t[1], t[2], t[3], t[4], t[5], otype);
    opcodes.push(cur);
  } else {
    fail('unparsable header', line);
  }
}

const kept = opcodes.filter((o) => o.enabled);

const METHODS = new Map(Object.entries({
  r8_r: 'r8r', r8_w: 'r8w', r16_r: 'r16r', r16_w: 'r16w',
  r32_r: 'r32r', r32_w: 'r32w',
  read8: 'read8', read16: 'read16', write8: 'write8', write16: 'write16',
  read16i: 'read16i', internal: 'internal',
  prefetch_done: 'prefetchDone',
  prefetch_done_noirq: 'prefetchDoneNoirq',
  prefetch_done_notrace: 'prefetchDoneNotrace',
  prefetch_switch: 'prefetchSwitch',
  update_irq_filter: 'updateIrqFilter',
  interrupt_taken: 'interruptTaken',
  irq_setup: 'irqSetup',
  debugger_exception_hook: 'exceptionHook',
  illegal: 'illegal',
}));

const FREE = new Map(Object.entries({
  set_nzv8: 'setNzv8', set_nzv16: 'setNzv16', set_nzv32: 'setNzv32',
  set_nz16: 'setNz16', set_nz32: 'setNz32',
}));

const VARS = new Map(Object.entries({
  m_TMP1: ['cpu.tmp1', 'u32'], m_TMP2: ['cpu.tmp2', 'u32'],
  m_PC: ['cpu.pc', 'u32'], m_NPC: ['cpu.npc', 'u32'], m_PIR: ['cpu.pir', 'u16'],
  m_CCR: ['cpu.ccr', 'u8'], m_EXR: ['cpu.exr', 'u8'],
  m_mode_advanced: ['cpu.modeAdvanced', null],
  m_taken_irq_vector: ['cpu.takenIrqVector', null],
  m_irq_vector: ['cpu.irqVector', null],
  m_has_hc: ['HAS_HC', null],
  m_has_mac: ['HAS_MAC', null],
  m_R: ['cpu.r', 'u16'],
  m_IR: ['cpu.ir', 'u16'],
}));

const NORMALISE = { u32: (e) => `(${e}) >>> 0`, u16: (e) => `(${e}) & 0xffff`, u8: (e) => `(${e}) & 0xff` };

const REJECT = /throw |logerror|emu_fatalerror|m_dma|m_dtc|m_MAC|m_sra|m_dar|standby|suspend|total_cycles|get_object|notify_|count_last|count_done|writeback_done|vector_done|get_waiting|get_vector_address|update_active|m_current_|trace_setup|m_has_exr|m_flags|m_id|m_base|m_cr|m_incs|m_incd|m_source|m_dest|m_count\b/;

function transpile(line, what) {
  let s = line.replace(/^\t/, '').replace(/\s+$/, '');
  if (!s.trim()) return '';
  if (s.trim().startsWith('//')) return s;
  s = s.replace(/\btrapa_setup\(\)/g, '8');
  s = s.replace(/\bexr_in_stack\(\)/g, 'false');
  if (REJECT.test(s)) fail(`unsupported construct in ${what}`, s);

  s = s.replace(/([A-Za-z_][A-Za-z0-9_]*) & 0x100000000ULL/g, 'bit32($1)');
  s = s.replace(/\bu64\(([^()]*)\)/g, '($1)');
  s = s.replace(/^(\s*)u64\s+([a-z][a-z0-9_]*)\s*=\s*(.*);$/, '$1let $2 = $3;');
  if (/ULL|u64/.test(s)) fail(`unhandled 64-bit expression in ${what}`, s);

  for (const [cxx, [ts]] of VARS) s = s.split(cxx).join(ts);
  for (const [cxx, ts] of METHODS) s = s.replace(new RegExp(`\\b${cxx}\\(`, 'g'), `cpu.${ts}(`);
  for (const [cxx, ts] of FREE) s = s.replace(new RegExp(`\\b${cxx}\\(`, 'g'), `${ts}(cpu, `);
  s = s.replace(/\bdo_([a-z0-9_]+)\(/g, (_, n) => {
    const camel = n.replace(/_([a-z0-9])/g, (__, ch) => ch.toUpperCase());
    return `do${camel[0].toUpperCase()}${camel.slice(1)}(cpu, `;
  });
  s = s.replace(/\bF_([A-Z]+)\b/g, 'F_$1');
  s = s.replace(/\babs\(/g, 'Math.abs(');

  s = s.replace(/^(\s*)int ([a-z][a-z0-9_]*), ([a-z][a-z0-9_]*);$/, '$1let $2 = 0, $3 = 0;');
  s = s.replace(/^(\s*)int ([a-z][a-z0-9_]*) = (.*);$/, '$1let $2 = Math.trunc($3);');
  s = s.replace(/([(=,])\s*-\s*(cpu\.tmp[12])\b/g, '$1u32(-$2)');
  s = s.replace(/^(\s*)([a-z][a-z0-9_]*) = ([^;]*\/[^;]*);$/, '$1$2 = Math.trunc($3);');

  s = s.replace(/^(\s*)(u8|u16|u32|s8|s16|s32)\s+([a-z][a-z0-9_]*)\s*=\s*(.*);$/,
    (_, ind, ty, name, expr) => {
      const cast = ty.startsWith('u') ? `${ty}(${expr})` : `${ty}(${expr})`;
      return `${ind}let ${name} = ${cast};`;
    });

  s = s.replace(/^(\s*)(cpu\.[a-z0-9]+(?:\[[^\]]*\])?)\s*(\|=|&=|\^=|\+=|-=|=)\s*(.*);$/,
    (m0, ind, lhs, op, expr) => {
      const key = [...VARS.values()].find(([ts]) => ts === lhs.replace(/\[.*/, ''));
      const width = key ? key[1] : null;
      const value = op === '=' ? expr : `${lhs} ${op[0]} (${expr})`;
      return `${ind}${lhs} = ${width ? NORMALISE[width](value) : value};`;
    });

  if (/m_[A-Za-z]/.test(s)) fail(`unmapped member in ${what}`, s);
  return s;
}

const helperSrc = readFileSync(HELPERS, 'utf8').split('\n');
const helpers = [];
for (let i = 0; i < helperSrc.length; i++) {
  const head = /^(u8|u16|u32|void) h8_device::([a-z0-9_]+)\((.*)\)$/.exec(helperSrc[i]);
  if (!head) continue;
  const [, ret, cname, argsSrc] = head;
  const params = argsSrc
    ? argsSrc.split(',').map((a) => {
      const [ty, nm] = a.trim().split(/\s+/);
      if (!/^(u8|u16|u32|s8|s16|s32)$/.test(ty)) fail('unhandled helper parameter type', a);
      return { ty, nm };
    })
    : [];
  const args = params.map((x) => x.nm);
  const name = cname.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
  const body = [];
  let depth = 0;
  for (i++; i < helperSrc.length; i++) {
    const l = helperSrc[i];
    if (l === '{') { depth++; continue; }
    if (l === '}') { depth--; if (!depth) break; continue; }
    let ts = transpile(l, cname);
    if (ret === 'u32' || params.some((x) => x.ty === 'u32')) ts = ts.replace(/(?<!>)>>(?!>)/g, '>>>');
    if (ret !== 'void') ts = ts.replace(/^(\s*)return (.*);$/, `$1return ${ret}($2);`);
    body.push(ts);
  }
  helpers.push({ name, args, params, ret, body });
}

const out = [];
const p = (s = '') => out.push(s);

p('/**');
p(' * H8/300H instruction set, generated from MAME\'s own opcode list.');
p(' *');
p(' *   tools/gen-h8-ops.mjs  <-  tools/vendor/h8.lst + tools/vendor/h8-helpers.cpp');
p(' *                            (MAME src/devices/cpu/h8/, BSD-3-Clause,');
p(' *                             copyright Olivier Galibert)');
p(' *');
p(' * Do not edit by hand — edit the generator. Every encoding, addressing mode');
p(' * and flag rule below is MAME\'s, transposed rather than re-derived: this is');
p(' * the table `h8make.py` expands into `h8.hxx`, filtered to the H8/300H');
p(' * subset the HD6413002FN16 implements.');
p(' *');
p(' * Bodies run to completion instead of MAME\'s per-bus-access substates, and');
p(' * cycles are charged the way `h8.cpp` charges them on a part with no EXR:');
p(' * every bus access is 2 states (`read8`/`read16`/`read16i`/`write8`/');
p(' * `write16`, h8.cpp:490-533) and `internal(n)` is n+1 (h8.cpp:599).');
p(' */');
p('');
p('/* eslint-disable */');
p('import type { H8 } from \'./h8\';');
p('');
p('/** CCR bits — h8.h:122-129. */');
p('export const F_I = 0x80;');
p('export const F_UI = 0x40;');
p('export const F_H = 0x20;');
p('export const F_U = 0x10;');
p('export const F_N = 0x08;');
p('export const F_Z = 0x04;');
p('export const F_V = 0x02;');
p('export const F_C = 0x01;');
p('');
p('/** `m_has_hc` — set true in h8_device\'s constructor (h8.cpp:52). */');
p('const HAS_HC = true;');
p('');
p('/** `m_has_mac` — only the H8S/2600 has the MAC unit (h8s2600.cpp), so the');
p(' *  multiply timings below take their non-MAC branch. */');
p('const HAS_MAC = false;');
p('');
p('/** EXR bits — h8.h:131-133. Present so the reset state can write it; the');
p(' *  H8/300H has no EXR of its own — bit 7 is EXR_T, the trace enable, which');
p(' *  only an H8S uses. */');
p('const EXR_NC = 0x78;');
p('const EXR_I = 0x07;')
p('');
p('const u8 = (v: number): number => v & 0xff;');
p('const u16 = (v: number): number => v & 0xffff;');
p('const u32 = (v: number): number => v >>> 0;');
p('const s8 = (v: number): number => (v << 24) >> 24;');
p('const s16 = (v: number): number => (v << 16) >> 16;');
p('const s32 = (v: number): number => v | 0;');
p('/** Bit 32 of a C++ u64 add/subtract, which JS holds as an exact Number. */');
p('const bit32 = (v: number): boolean => v < 0 || v >= 0x100000000;');
p('');

for (const h of helpers) {
  const args = h.args.map((a) => `${a}: number`).join(', ');
  p(`export function ${h.name}(cpu: H8${args ? `, ${args}` : ''}): ${h.ret === 'void' ? 'void' : 'number'} {`);
  for (const { ty, nm } of h.params) p(`  ${nm} = ${ty}(${nm});`);
  for (const l of h.body) p(l);
  p('}');
  p('');
}

const RUNTIME_BODIES = new Map([['sleep - -', 'sleep']]);

const seen = new Set();
const entries = [];
for (const o of kept) {
  const fn = `op_${[o.name.replace(/\./g, '_'), o.am1 === '-' ? null : o.am1, o.am2 === '-' ? null : o.am2].filter(Boolean).join('_')}`;
  if (seen.has(fn)) fail('duplicate encoding name', fn);
  seen.add(fn);

  const override = RUNTIME_BODIES.get(`${o.name} ${o.am1} ${o.am2}`);
  if (override) {
    p(`/** h8.lst: ${o.name} — body hand-written in the runtime, see H8.${override}(). */`);
    p(`function ${fn}(cpu: H8): void {`);
    p(`  cpu.${override}();`);
    p('}');
    p('');
    entries.push({ fn, ...slots(o), name: `${o.name} ${o.am1} ${o.am2}` });
    continue;
  }

  const lines = [];
  for (let w = 1; w < o.bytes / 2; w++) {
    lines.push(`  cpu.ir[${w}] = cpu.read16i(cpu.pc);`);
    lines.push('  cpu.pc = (cpu.pc + 2) >>> 0;');
  }
  const base = o.bytes / 2 + o.skip;
  for (let w = 0; w < o.extraWords; w++) {
    lines.push(`  cpu.ir[${base + w}] = cpu.read16i(cpu.pc);`);
    lines.push('  cpu.pc = (cpu.pc + 2) >>> 0;');
  }
  for (const l of o.body) {
    const ts = transpile(l, fn);
    if (ts.trim()) lines.push(`  ${ts.replace(/^\t*/, (m) => '  '.repeat(m.length))}`);
  }

  p(`function ${fn}(cpu: H8): void {`);
  for (const l of lines) p(l);
  p('}');
  p('');

  entries.push({ fn, ...slots(o), name: `${o.name} ${o.am1} ${o.am2}` });
}

function slots(o) {
  const b = [];
  for (let i = 0; i < o.val.length; i += 2) b.push([parseInt(o.val.slice(i, i + 2), 16), parseInt(o.mask.slice(i, i + 2), 16)]);
  let slot; let val; let mask; let val0 = 0; let mask0 = 0;
  if (b.length === 2) {
    slot = 0; val = (b[0][0] << 8) | b[1][0]; mask = (b[0][1] << 8) | b[1][1];
  } else if (b.length === 4) {
    slot = o.skip + 1;
    val = ((b[0][0] << 24) | (b[1][0] << 16) | (b[2][0] << 8) | b[3][0]) >>> 0;
    mask = ((b[0][1] << 24) | (b[1][1] << 16) | (b[2][1] << 8) | b[3][1]) >>> 0;
  } else if (b.length === 6) {
    slot = 4;
    val = ((b[2][0] << 24) | (b[3][0] << 16) | (b[4][0] << 8) | b[5][0]) >>> 0;
    mask = ((b[2][1] << 24) | (b[3][1] << 16) | (b[4][1] << 8) | b[5][1]) >>> 0;
    val0 = (b[0][0] << 8) | b[1][0];
    mask0 = (b[0][1] << 8) | b[1][1];
  } else {
    fail('unexpected encoding length', o.val);
  }
  return { slot, val, mask, val0, mask0 };
}

for (const sp of specials) {
  const wanted = sp.otype === -1 || sp.otype === DTYPE;
  if (!wanted || !['reset', 'irq'].includes(sp.special)) continue;
  p(`/** h8.lst state 0x${sp.id.toString(16)}: ${sp.special}. */`);
  p(`export function state${sp.special[0].toUpperCase()}${sp.special.slice(1)}(cpu: H8): void {`);
  for (const l of sp.body) {
    const ts = transpile(l, `state ${sp.special}`);
    if (ts.trim()) p(`  ${ts.replace(/^\t*/, (m) => '  '.repeat(m.length))}`);
  }
  p('}');
  p('');
}

p('/** One encoding: the match rule of h8d.cpp:270-284, plus its body. */');
p('export interface Encoding {');
p('  /** Which of the disassembler\'s five overlapping windows `val`/`mask` test. */');
p('  slot: number;');
p('  val: number;');
p('  mask: number;');
p('  /** Extra constraint on the first word, for the three-word encodings. */');
p('  val0: number;');
p('  mask0: number;');
p('  run: (cpu: H8) => void;');
p('  name: string;');
p('}');
p('');
p('/** In MAME\'s list order: the first entry that matches wins. */');
p('export const ENCODINGS: readonly Encoding[] = [');
for (const e of entries) {
  p(`  { slot: ${e.slot}, val: 0x${e.val.toString(16)}, mask: 0x${e.mask.toString(16)}, `
    + `val0: 0x${e.val0.toString(16)}, mask0: 0x${e.mask0.toString(16)}, run: ${e.fn}, name: '${e.name}' },`);
}
p('];');
p('');

process.stdout.write(out.join('\n'));
process.stderr.write(`gen-h8-ops: ${kept.length} encodings, ${helpers.length} helpers, `
  + `${opcodes.length - kept.length} skipped as not H8/300H\n`);
process.stderr.write(`gen-h8-ops: special states left to the runtime: ${specials.filter((s) => s.otype === -1 || s.otype === DTYPE).map((s) => s.special).join(', ')}\n`);
