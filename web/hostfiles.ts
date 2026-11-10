import type { GameFile } from '../src/machine/registry';
import { layoutPrintText, printableLayout } from '../src/layout/layoutprint';
import { sha256Hex } from './store';

export interface HostFile { name: string; sha256: string; print?: string }

export async function layoutPrint(bytes: Uint8Array): Promise<string | null> {
  const text = layoutPrintText(bytes);
  return text === null ? null : sha256Hex(new TextEncoder().encode(text));
}

export async function fingerprints(files: readonly GameFile[]): Promise<HostFile[]> {
  return Promise.all(files.map(async (f) => {
    const out: HostFile = { name: f.name, sha256: await sha256Hex(f.bytes) };
    const print = printableLayout(f.name) ? await layoutPrint(f.bytes) : null;
    if (print) out.print = print;
    return out;
  }));
}

export function wantsPrint(h: HostFile): boolean {
  return !h.print && printableLayout(h.name);
}

export function readHostFiles(v: unknown): HostFile[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const out: HostFile[] = [];
  for (const x of v) {
    const r = x as Partial<HostFile> | null;
    if (typeof r?.name !== 'string' || !r.name || typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256)) return null;
    out.push(typeof r.print === 'string' && /^[0-9a-f]{64}$/.test(r.print) ? { name: r.name, sha256: r.sha256, print: r.print } : { name: r.name, sha256: r.sha256 });
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
  const unnamed = host.filter((h) => h.print && !ownName.has(h.name));
  if (unnamed.length) {
    const used = new Set(ownName.values());
    for (const f of files) {
      if (used.has(f.name) || !printableLayout(f.name)) continue;
      const print = await layoutPrint(f.bytes);
      for (const h of unnamed) {
        if (h.print !== print || ownName.has(h.name)) continue;
        ownName.set(h.name, f.name);
        out.push({ name: h.name, bytes: f.bytes });
      }
    }
  }
  return { files: out, ownName };
}
