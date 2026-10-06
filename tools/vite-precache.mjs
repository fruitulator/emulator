import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export const MARKER = "/*PRECACHE*/ { build: 'dev', files: [] }";

export function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.push('/' + relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export const precached = (path) => path !== '/sw.js' && path !== '/_redirects' && !path.endsWith('.html');

export function manifestFor(dir) {
  const all = filesUnder(dir).filter((p) => p !== '/sw.js');
  const h = createHash('sha256');
  let bytes = 0;
  for (const p of all) {
    const buf = readFileSync(join(dir, p));
    if (precached(p)) bytes += buf.length;
    h.update(p).update('\0').update(createHash('sha256').update(buf).digest()).update('\0');
  }
  return { build: h.digest('hex').slice(0, 12), files: all.filter(precached), bytes };
}

export function injectInto(swSource, manifest) {
  if (!swSource.includes(MARKER)) {
    throw new Error(`vite-precache: sw.js no longer carries ${MARKER} -- the offline list cannot be written`);
  }
  const { build, files } = manifest;
  return swSource.replace(MARKER, JSON.stringify({ build, files }));
}

export function precachePlugin() {
  let outDir = 'dist';
  return {
    name: 'fruitulator-precache',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    closeBundle() {
      const sw = join(outDir, 'sw.js');
      const m = manifestFor(outDir);
      writeFileSync(sw, injectInto(readFileSync(sw, 'utf8'), m));
      console.log(`offline precache: ${m.files.length} files, ${(m.bytes / 1e6).toFixed(1)} MB, build ${m.build}`);
    },
  };
}
