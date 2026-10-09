import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export function tsFiles(root, dir, out = []) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) tsFiles(root, rel, out);
    else if (e.name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

export function parseImports(root, file) {
  const out = new Set();
  let src;
  try {
    src = readFileSync(join(root, file), 'utf8');
  } catch {
    return out;
  }
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)'([^']+)'/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const abs = resolve(join(root, dirname(file)), spec);
    const rel = relative(root, abs).replaceAll('\\', '/');
    for (const cand of [rel, `${rel}.ts`, `${rel}/index.ts`]) {
      if (existsSync(join(root, cand)) && statSync(join(root, cand)).isFile()) {
        out.add(cand);
        break;
      }
    }
  }
  return out;
}

export function importGraph(root, dirs = ['src', 'web']) {
  const files = dirs.flatMap((d) => tsFiles(root, d));
  return new Map(files.map((f) => [f, parseImports(root, f)]));
}

export function forwardClosure(graph, roots, walks = () => true) {
  const hit = new Set();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop();
    if (hit.has(f) || !walks(f)) continue;
    hit.add(f);
    for (const d of graph.get(f) ?? []) stack.push(d);
  }
  return hit;
}

export const REGISTRY = 'src/machine/registry.ts';

export const STAMP_COMMON = ['web/snapshot.ts'];

export function stampWalks(file) {
  return file !== REGISTRY && !file.startsWith('web/');
}

export const SYSTEM_BOARD = {
  SCORPION1: ['src/machine/sc1.ts'],
  SCORPION2: ['src/machine/sc2.ts'],
  SCORPION4: ['src/machine/sc4.ts'],
  SCORPION5: ['src/machine/sc5.ts'],
  ADDER5: ['src/machine/sc5.ts'],
  SYS85: ['src/machine/sys85.ts'],
  SYS5: ['src/machine/sys5.ts'],
  MPU3: ['src/machine/mpu3.ts'],
  MMM: ['src/machine/mmm.ts'],
  ACEVIDEO: ['src/machine/acevideo.ts'],
  PLUTO5: ['src/machine/pluto5.ts'],
  MPU2: ['src/machine/mpu2.ts'],
  SYS83: ['src/machine/sys83.ts'],
  MPU4: ['src/machine/mpu4.ts'],
  MPU4VIDEO: ['src/machine/mpu4.ts', 'src/machine/mpu4video.ts'],
  MPU4PLASMA: ['src/machine/mpu4.ts', 'src/machine/mpu4plasma.ts'],
  MPU5: ['src/machine/mpu5.ts'],
  IMPACT: ['src/machine/impact.ts'],
  SPACE: ['src/machine/acesp.ts'],
  M1AB: ['src/machine/m1ab.ts'],
  EPOCH: ['src/machine/epoch.ts'],
  MPS2: ['src/machine/mps2.ts'],
  SYSTEM80: ['src/machine/sys80.ts'],
  SRU: ['src/machine/sru.ts'],
  SYS1: ['src/machine/sys1.ts'],
  PROCONN: ['src/machine/proconn.ts'],
  ELECTROCOIN: ['src/machine/electrocoin.ts'],
  PHOENIX: ['src/machine/phoenix.ts'],
  PHOENIX2: ['src/machine/phoenix.ts'],
  BLACKBOX: ['src/machine/blackbox.ts'],
  ASTRASYSA1: ['src/machine/astra.ts'],
};

export function stampFiles(graph, system) {
  const roots = SYSTEM_BOARD[system];
  if (!roots) return null;
  const files = forwardClosure(graph, roots, stampWalks);
  for (const f of STAMP_COMMON) files.add(f);
  return [...files].sort();
}

export function boardStamps(root, { graph = importGraph(root), read = (f) => readFileSync(join(root, f)) } = {}) {
  const out = {};
  for (const system of Object.keys(SYSTEM_BOARD)) {
    const h = createHash('sha256');
    for (const f of stampFiles(graph, system)) {
      h.update(f);
      h.update('\0');
      h.update(read(f));
      h.update('\0');
    }
    out[system] = h.digest('hex').slice(0, 12);
  }
  return out;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const root = join(import.meta.dirname, '..');
  const graph = importGraph(root);
  const stamps = boardStamps(root, { graph });
  for (const s of Object.keys(stamps).sort()) {
    console.log(`${s.padEnd(12)} ${stamps[s]}  ${stampFiles(graph, s).length} files`);
  }
}
