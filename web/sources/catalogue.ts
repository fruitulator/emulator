
export interface CatSet {
  id: string;
  layout: string;
  romset: string;
  config?: { variant?: string; market?: string; stake?: string; jackpot?: string; percentage?: string };
  download?: string;
  refs?: Record<string, string>;
  retired?: boolean;
  canDownload?: false;
}
export interface Machine {
  id: string; title: string; maker?: string; club?: boolean; edition?: string;
  thumb?: string; authors?: string[];
  page?: string;
  sets: CatSet[];
}
export interface Layout { id: string; file: string; info?: { caption?: string; authors?: string[]; cabinetStyle?: string; dx?: boolean } }
export interface Romset { id: string; board?: string; files: { name: string; sha256?: string }[]; contentId?: string }
export interface Catalogue { machines: Machine[]; layouts: Map<string, Layout>; romsets: Map<string, Romset>; page?: number; pages?: number }

const s = (v: unknown): string | undefined => typeof v === 'string' && v ? v : undefined;
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};

export function parseCatalogue(json: unknown): Catalogue {
  const doc = obj(json);
  if (doc.kind !== 'fme-catalogue') throw new Error('not a catalogue');
  const machines: Machine[] = [];
  for (const m of arr(doc.machines).map(obj)) {
    const id = s(m.id); const title = s(m.title);
    if (!id || !title) continue;
    const sets: CatSet[] = [];
    for (const x of arr(m.sets).map(obj)) {
      const sid = s(x.id); const layout = s(x.layout); const romset = s(x.romset);
      if (!sid || !layout || !romset || x.retired === true) continue;
      const refs = Object.fromEntries(Object.entries(obj(x.refs)).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
      sets.push({
        id: sid, layout, romset,
        ...(x.config ? { config: obj(x.config) as CatSet['config'] } : {}),
        ...(s(x.download) ? { download: s(x.download) } : {}),
        ...(Object.keys(refs).length ? { refs } : {}),
      });
    }
    if (!sets.length) continue;
    const thumb = s(m.thumb); const page = s(m.page);
    machines.push({
      id, title, sets,
      ...(s(m.maker) ? { maker: s(m.maker) } : {}), ...(m.club === true ? { club: true } : {}), ...(s(m.edition) ? { edition: s(m.edition) } : {}),
      ...(thumb && /^https:\/\//.test(thumb) ? { thumb } : {}),
      ...(page && /^https:\/\//.test(page) ? { page } : {}),
    });
  }
  const layouts = new Map<string, Layout>();
  for (const l of arr(doc.layouts).map(obj)) if (s(l.id) && s(l.file)) layouts.set(l.id as string, { id: l.id as string, file: l.file as string, ...(l.info ? { info: obj(l.info) as Layout['info'] } : {}) });
  const romsets = new Map<string, Romset>();
  for (const r of arr(doc.romsets).map(obj)) {
    if (!s(r.id)) continue;
    const files = arr(r.files).map(obj).filter((f) => s(f.name)).map((f) => ({ name: f.name as string, ...(s(f.sha256) ? { sha256: (f.sha256 as string).toLowerCase() } : {}) }));
    romsets.set(r.id as string, { id: r.id as string, files, ...(s(r.board) ? { board: s(r.board) } : {}), ...(s(r.contentId) ? { contentId: s(r.contentId) } : {}) });
  }
  return {
    machines, layouts, romsets,
    ...(typeof doc.page === 'number' ? { page: doc.page } : {}),
    ...(typeof doc.pages === 'number' ? { pages: doc.pages } : {}),
  };
}

export function setHashes(cat: Catalogue, set: CatSet): string[] {
  const out = /^[0-9a-f]{64}$/i.test(set.layout) ? [set.layout.toLowerCase()] : [];
  for (const f of cat.romsets.get(set.romset)?.files ?? []) if (f.sha256) out.push(f.sha256);
  return out;
}

export function rowKey(title: string): string {
  return title.toLowerCase()
    .replace(/\bdond\b/g, 'deal or no deal')
    .replace(/\s*(&|\bn\b|'n'|\+)\s*/g, ' and ')
    .replace(/\b(club|dx|wdx|pdx|classic|deluxe)\b/g, ' ')
    .replace(/^\s*(the|a|an)\s+/, '').replace(/,\s*(the|a|an)\s*$/, '')
    .replace(/'s\b/g, '').replace(/([a-z]{2})s\b/g, '$1')
    .replace(/[^a-z0-9]/g, '') || title.toLowerCase();
}

export interface Row { key: string; title: string; machines: Machine[] }

export function rollUp(machines: Machine[]): Row[] {
  const by = new Map<string, Machine[]>();
  for (const m of machines) {
    const k = rowKey(m.title);
    by.set(k, [...(by.get(k) ?? []), m]);
  }
  return [...by].map(([key, ms]) => {
    const count = new Map<string, number>();
    for (const m of ms) count.set(m.title, (count.get(m.title) ?? 0) + 1);
    const title = [...count.keys()].sort((a, b) => Number(/\bclub\b/i.test(a)) - Number(/\bclub\b/i.test(b))
      || count.get(b)! - count.get(a)! || a.length - b.length)[0];
    return { key, title, machines: ms };
  }).sort((a, b) => a.title.localeCompare(b.title));
}
