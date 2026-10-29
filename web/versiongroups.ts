import { titleKey } from './versionkey';
import { hamming } from './thumbhash';

export const ART_DISTANCE = 6;

export interface VersionItem {
  id: string;
  maker: string;
  title: string;
  art?: string;
}

export interface Overrides {
  ungrouped?: ReadonlySet<string>;
  groupWith?: ReadonlyMap<string, string>;
}

export interface Link {
  a: string;
  b: string;
  rule: 'name' | 'art' | 'player';
  distance?: number;
}

export interface VersionGroup {
  ids: string[];
  links: Link[];
}

export interface GroupOptions {
  skipMaker?: string;
}

export function groupVersions(
  items: readonly VersionItem[],
  overrides: Overrides = {},
  opts: GroupOptions = {},
): VersionGroup[] {
  const index = new Map(items.map((it, i) => [it.id, i]));
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const links: Link[] = [];
  const join = (i: number, j: number, link: Link): void => {
    links.push(link);
    const a = find(i), b = find(j);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };

  const auto = items
    .map((it, i) => ({ it, i, key: titleKey(it.title) }))
    .filter(({ it }) => !overrides.ungrouped?.has(it.id) && it.maker !== opts.skipMaker);

  const byMaker = new Map<string, typeof auto>();
  for (const e of auto) {
    const list = byMaker.get(e.it.maker) ?? [];
    list.push(e);
    byMaker.set(e.it.maker, list);
  }
  for (const list of byMaker.values()) {
    const byKey = new Map<string, number>();
    for (const e of list) {
      if (!e.key) continue;
      const first = byKey.get(e.key);
      if (first === undefined) byKey.set(e.key, e.i);
      else join(first, e.i, { a: items[first].id, b: e.it.id, rule: 'name' });
    }
    for (let x = 0; x < list.length; x++) {
      const p = list[x];
      if (!p.it.art) continue;
      for (let y = x + 1; y < list.length; y++) {
        const q = list[y];
        if (!q.it.art) continue;
        const d = hamming(p.it.art, q.it.art);
        if (d <= ART_DISTANCE) join(p.i, q.i, { a: p.it.id, b: q.it.id, rule: 'art', distance: d });
      }
    }
  }

  for (const [id, other] of overrides.groupWith ?? []) {
    const i = index.get(id), j = index.get(other);
    if (i !== undefined && j !== undefined) join(i, j, { a: id, b: other, rule: 'player' });
  }

  const groups = new Map<number, VersionGroup>();
  items.forEach((it, i) => {
    const r = find(i);
    const g = groups.get(r) ?? { ids: [], links: [] };
    g.ids.push(it.id);
    groups.set(r, g);
  });
  for (const l of links) groups.get(find(index.get(l.a)!))!.links.push(l);
  return [...groups.values()];
}
