#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const src = process.argv[2] || '/tmp/m68kops.cpp';
const lines = readFileSync(src, 'utf8').split('\n');

const CPU_FSCPU32 = 6;

const names = [];
for (const line of lines) {
  const m = /^\s*&m68000_musashi_device::x[0-9a-f]{4}_(.+?)_[071234fc]+,\s*$/.exec(line);
  if (m) names.push(m[1]);
}

const rules = [];
let row = 0;
for (const line of lines) {
  const m = /^\s*\{ 0x([0-9a-f]{4}), 0x([0-9a-f]{4}), \{([^}]*)\}\},\s*$/.exec(line);
  if (!m) continue;
  const name = names[row++] ?? '';
  const cycles = m[3].split(',').map((n) => Number(n.trim()));
  const c = cycles[CPU_FSCPU32];
  if (c === 255) continue;
  rules.push({ value: parseInt(m[1], 16), mask: parseInt(m[2], 16), cycles: c, name });
}

if (!rules.length) {
  console.error(`no opcode rows found in ${src} — is it MAME's generated m68kops.cpp?`);
  process.exit(1);
}
const max = Math.max(...rules.map((r) => r.cycles));
if (max >= 255) {
  console.error(`a CPU32 entry costs ${max} cycles, which collides with the 255 sentinel`);
  process.exit(1);
}

const body = rules.map((r) =>
  `  0x${r.value.toString(16).padStart(4, '0')}, 0x${r.mask.toString(16).padStart(4, '0')}, ${r.cycles},`
  + ` // ${r.name}`).join('\n');

process.stdout.write(`/**
 * CPU32 instruction cycle counts, generated from MAME's expanded opcode table.
 *
 *   tools/gen-cpu32-cycles.mjs  <-  m68kmake.py(src/devices/cpu/m68000/m68k_in.lst)
 *
 * Do not edit by hand. ${rules.length} rules, as (match, mask, cycles) triples in
 * MAME's own order — loosest mask first, so a specific rule overwrites a
 * general one.
 *
 * **The effective-address cost is already inside these numbers.** MAME's CPU32
 * EA column is not zero the way ColdFire's is (\`m68kmake.py: ea_cycle_table\`,
 * FSCPU32 column: 4 for (An), 5 for -(An)/(d16,An), 7 for (d8,An,Xn), …), and
 * m68kmake folds it into each addressing-mode variant when it expands the
 * list. So, as on the ColdFire path, the number here is the whole cost of the
 * instruction and the \`eaCost\` this core adds for a 68000 has no counterpart.
 */

/* eslint-disable */
const RULES = new Uint16Array([
${body}
]);

/** Cycles for an opcode CPU32 does not implement. Real entries top out at
 *  ${max}, so the sentinel cannot collide with one. */
export const CPU32_NO_ENTRY = 0xff;

let table: Uint8Array | null = null;

/** Build (once) and return the full 64K opcode→cycles table. A CPU32 core
 *  holds this reference and indexes it directly on the hot path, for the same
 *  reason the ColdFire one does: the module boundary, not the work, is the
 *  cost of a per-instruction call.
 *
 *  Each rule is replayed over exactly the opcodes it matches — the subset walk
 *  over the mask's zero bits — rather than over all 64K, which is ${rules.length} x
 *  65536 comparisons for the same answer. */
export function cpu32CycleTable(): Uint8Array {
  if (!table) {
    table = new Uint8Array(0x10000).fill(CPU32_NO_ENTRY);
    for (let i = 0; i < RULES.length; i += 3) {
      const value = RULES[i], free = (~RULES[i + 1]) & 0xffff, cycles = RULES[i + 2];
      for (let s = free; ; s = (s - 1) & free) {
        table[value | s] = cycles;
        if (s === 0) break;
      }
    }
  }
  return table;
}

/**
 * Cycles a CPU32 charges for an opcode, or \`CPU32_NO_ENTRY\` where MAME lists
 * none — an instruction the part does not have, which this core traps as
 * illegal and bills separately.
 */
export function cpu32Cycles(op: number): number {
  return cpu32CycleTable()[op & 0xffff];
}

/**
 * Cycles CPU32 exception processing costs, by vector.
 * MAME \`m68kcpu.cpp: m68ki_exception_cycle_table[6]\` (the FSCPU32 column);
 * vectors past the end of this array all read 4 there.
 *
 * Cross-checked against CPU32RM (Motorola CPU32 Reference Manual, Aug 1990)
 * table 8.3.13, which agrees on the entry that dominates a running machine —
 * Interrupt = 30 — and differs on the rare ones: it gives 25 for
 * ILLEGAL/A-line/F-line/privilege against MAME's 20/20/20/34, 29 for TRAP #
 * against 20, and 36 for divide-by-zero against 38. MAME's column is used
 * because it is the one the rest of this table came from, and mixing the two
 * would make no entry citable.
 */
const EXCEPTION_CYCLES = new Uint8Array([
  4, 4, 50, 50, 20, 38, 40, 20, 34, 25, 20, 20, 4, 4, 4, 30,
  4, 4, 4, 4, 4, 4, 4, 4, 30, 30, 30, 30, 30, 30, 30, 30,
  20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20,
]);

export function cpu32ExceptionCycles(vector: number): number {
  return vector < EXCEPTION_CYCLES.length ? EXCEPTION_CYCLES[vector] : 4;
}
`);
