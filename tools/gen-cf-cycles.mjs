#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const src = process.argv[2] || '/tmp/m68k_in.lst';
const lines = readFileSync(src, 'utf8').split('\n');

const rules = [];
for (const line of lines) {
  const m = /^([0-9a-f]{4}) ([0-9a-f]{4}) +(\S+) +(\S+) +(\S+)((?: +[0-9a-f]+:\d+)+)\s*$/.exec(line);
  if (!m) continue;
  const [, match, mask, name, , , groups] = m;
  let cycles = null;
  for (const g of groups.trim().split(/\s+/)) {
    const [cpus, n] = g.split(':');
    if (cpus.includes('c')) cycles = Number(n);
  }
  if (cycles === null) continue;
  rules.push({ match: parseInt(match, 16), mask: parseInt(mask, 16), cycles, name });
}

const popcount = (v) => { let n = 0; while (v) { v &= v - 1; n++; } return n; };
rules.sort((a, b) => popcount(a.mask) - popcount(b.mask));

const body = rules.map((r) =>
  `  0x${r.match.toString(16).padStart(4, '0')}, 0x${r.mask.toString(16).padStart(4, '0')}, ${r.cycles},`
  + ` // ${r.name}`).join('\n');

process.stdout.write(`/**
 * ColdFire instruction cycle counts, generated from MAME's opcode list.
 *
 *   tools/gen-cf-cycles.mjs  <-  src/devices/cpu/m68000/m68k_in.lst
 *
 * Do not edit by hand. ${rules.length} rules, as (match, mask, cycles) triples
 * ordered loosest-mask first so a specific rule overwrites a general one.
 *
 * A ColdFire charges no effective-address cycles on top of these — MAME's
 * \`ea_cycle_table\` is zero for every mode in the ColdFire column — so unlike
 * the 68000 path, where this core adds \`eaCost\` separately, the number here
 * is the whole cost of the instruction.
 */

/* eslint-disable */
const RULES = new Uint16Array([
${body}
]);

let table: Uint8Array | null = null;

/**
 * Cycles a ColdFire charges for an opcode, or 0 where MAME lists none — an
 * instruction the part does not have, which this core traps as illegal and
 * bills separately.
 */
export function coldfireCycles(op: number): number {
  if (!table) {
    table = new Uint8Array(0x10000);
    for (let i = 0; i < RULES.length; i += 3) {
      const match = RULES[i], mask = RULES[i + 1], cycles = RULES[i + 2];
      for (let o = 0; o < 0x10000; o++) if ((o & mask) === match) table[o] = cycles;
    }
  }
  return table[op & 0xffff];
}
`);
