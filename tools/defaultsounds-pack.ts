import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { buildEffectPack } from '../src/machine/effectpack';

const repo = join(import.meta.dirname, '..');
const root = process.argv[2] ?? join(repo, 'DefaultSounds');
const out = process.argv[3] ?? join(repo, 'public', 'sounds.pack');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(root)
  .filter((p) => /\.wav$/i.test(p))
  .map((p) => ({ path: relative(root, p).split(sep).join('/'), bytes: new Uint8Array(readFileSync(p)) }))
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
const pack = buildEffectPack(files);
writeFileSync(out, pack);
console.log(`${files.length} files, ${(pack.length / 1048576).toFixed(1)} MB -> ${out}`);
