import type { GameFile } from '../src/machine/registry';
import { sha256Hex } from './store';

export interface HostFile { name: string; sha256: string }

export async function fingerprints(files: readonly GameFile[]): Promise<HostFile[]> {
  return Promise.all(files.map(async (f) => ({ name: f.name, sha256: await sha256Hex(f.bytes) })));
}

export function readHostFiles(v: unknown): HostFile[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const out: HostFile[] = [];
  for (const x of v) {
    const r = x as Partial<HostFile> | null;
    if (typeof r?.name !== 'string' || !r.name || typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256)) return null;
    out.push({ name: r.name, sha256: r.sha256 });
  }
  return out;
}

export async function asHostFiles(
  files: readonly GameFile[], host: readonly HostFile[],
): Promise<{ files: GameFile[]; ownName: Map<string, string> }> {
  const names = new Map<string, string[]>();
  for (const h of host) names.set(h.sha256, [...(names.get(h.sha256) ?? []), h.name]);
  const out: GameFile[] = [];
  const ownName = new Map<string, string>();
  for (const f of files) {
    for (const name of names.get(await sha256Hex(f.bytes)) ?? []) {
      if (ownName.has(name)) continue;
      ownName.set(name, f.name);
      out.push({ name, bytes: f.bytes });
    }
  }
  return { files: out, ownName };
}
