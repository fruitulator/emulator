import { CONTENT_RULE, byContentKey, contentIdentityOf, getMeta, getPak, putMeta, type GameMeta } from '../web/store';
import { decodePak, decodeSrcs } from '../web/gamepak';
import type { ArcadeDoc } from './doc';

export function isCurrent(g: Pick<GameMeta, 'contentRule' | 'formerContentHashes'>): boolean {
  return g.contentRule === CONTENT_RULE && g.formerContentHashes !== undefined;
}

export async function rekeyRecord(g: GameMeta): Promise<GameMeta> {
  if (isCurrent(g)) return g;
  try {
    const bytes = await getPak(g.hash);
    if (!bytes) return g;
    const identity = await contentIdentityOf(decodeSrcs(decodePak(bytes).chunk('SRCS')));
    const now = (await getMeta(g.hash)) ?? g;
    const out: GameMeta = { ...now, ...identity };
    await putMeta(out);
    return out;
  } catch (e) {
    console.warn('[arcade] a library record could not be re-keyed', e);
    return g;
  }
}

interface Wanted { contentHash: string; formerContentHashes?: string[]; programHash?: string }

export async function rekeyHolders<M extends Wanted>(library: GameMeta[], machines: readonly M[]): Promise<GameMeta[]> {
  const by = byContentKey(library);
  const programs = new Set<string>();
  for (const m of machines) {
    if (!m.programHash) continue;
    if (by.has(m.contentHash) || (m.formerContentHashes ?? []).some((k) => by.has(k))) continue;
    programs.add(m.programHash);
  }
  if (!programs.size) return library;
  const out: GameMeta[] = [];
  for (const g of library) out.push(g.programHash && programs.has(g.programHash) && !isCurrent(g) ? await rekeyRecord(g) : g);
  return out;
}

export async function restampMachines(doc: ArcadeDoc, library: GameMeta[]): Promise<boolean> {
  const stale = doc.machines.filter((m) => m.contentRule !== CONTENT_RULE);
  if (!stale.length) return false;
  const byKey = new Map(library.map((g) => [g.hash, g]));
  let by = byContentKey(library);
  let changed = false;
  for (const m of stale) {
    let g = by.get(m.contentHash) ?? (m.hash ? byKey.get(m.hash) : undefined);
    if (!g?.contentHash) continue;
    if (!isCurrent(g)) {
      const was = g;
      g = await rekeyRecord(g);
      if (g === was) continue;
      library = library.map((x) => (x.hash === g!.hash ? g! : x));
      by = byContentKey(library);
    }
    if (!g.contentHash) continue;
    if (g.contentHash !== m.contentHash) {
      m.formerContentHashes = [...new Set([...(m.formerContentHashes ?? []), m.contentHash])];
      m.contentHash = g.contentHash;
    }
    m.contentRule = CONTENT_RULE;
    changed = true;
  }
  return changed;
}
