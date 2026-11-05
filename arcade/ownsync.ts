import type { ArcadeDoc, DocMachine } from './doc';
import type { ArcadeListing } from './serverwire';
import { putArcade } from './docstore';
import { newHostKey, type ArcadeServer } from './share';

export function mergeFromServer(local: ArcadeDoc | null, fresh: ArcadeDoc): ArcadeDoc {
  const out = { ...fresh } as ArcadeDoc & Record<string, unknown>;
  if (local) {
    for (const [k, v] of Object.entries(local)) if (!(k in out)) out[k] = v;
    const byId = new Map(local.machines.map((m) => [m.id ?? m.contentHash, m]));
    out.machines = fresh.machines.map((m) => {
      const was = byId.get(m.id ?? m.contentHash);
      if (!was) return m;
      const merged = { ...m } as DocMachine & Record<string, unknown>;
      for (const [k, v] of Object.entries(was)) if (!(k in merged)) merged[k] = v;
      if (was.balance?.length && !m.balance?.length) merged.balance = was.balance;
      return merged;
    });
  }
  if (!out.hostKey) out.hostKey = newHostKey();
  return out;
}

export async function syncOwnArcades(server: ArcadeServer, held: ArcadeDoc[], mine: readonly ArcadeListing[]): Promise<ArcadeDoc[]> {
  const out = [...held];
  for (const a of mine) {
    const i = out.findIndex((d) => d.id === a.id);
    const local = i >= 0 ? out[i]! : null;
    if (local && a.updatedAt <= local.updatedAt) continue;
    const r = await server.resolve(a.id).catch(() => null);
    if (!r || (local && r.at <= local.updatedAt)) continue;
    const doc = mergeFromServer(local, r.doc);
    if (!(await putArcade(doc, { replace: true }).catch(() => false))) continue;
    if (i >= 0) out[i] = doc; else out.push(doc);
  }
  return out;
}
