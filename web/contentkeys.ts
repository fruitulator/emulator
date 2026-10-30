
interface Keyed { contentHash?: string; formerContentHashes?: string[] }

export function contentKeys(g: Keyed): string[] {
  return g.contentHash ? [g.contentHash, ...(g.formerContentHashes ?? [])] : [];
}

export function byContentKey<G extends Keyed>(library: readonly G[]): Map<string, G> {
  const out = new Map<string, G>();
  for (const g of library) for (const k of contentKeys(g)) if (!out.has(k)) out.set(k, g);
  return out;
}
