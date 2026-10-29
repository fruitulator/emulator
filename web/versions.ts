import { lastPlayed, type GameMeta } from './store';
import { libraryMaker, UNKNOWN_MAKER } from './maker';
import { parseTitle } from './title';
import { cleanTitle } from './versionkey';
import { groupVersions } from './versiongroups';

const GROUP_STORE = 'fruitulator.libGroup';

export function groupingOn(): boolean {
  try { return localStorage.getItem(GROUP_STORE) !== 'off'; } catch { return true; }
}

export function setGroupingOn(on: boolean): void {
  try { localStorage.setItem(GROUP_STORE, on ? 'on' : 'off'); } catch {  }
}

const shownTitle = (g: GameMeta): string => g.title?.trim() || parseTitle(g.sourceName ?? g.name).title;

export function groupTitle(g: GameMeta): string {
  return cleanTitle(shownTitle(g));
}

export interface Grouping {
  members(hash: string): GameMeta[];
}

export function groupLibrary(all: readonly GameMeta[], own = true): Grouping {
  const items = all.map((g) => ({ id: g.hash, maker: libraryMaker(g), title: shownTitle(g), art: g.artHash }));
  const ungrouped = new Set<string>();
  const groupWith = new Map<string, string>();
  if (own) {
    for (const g of all) {
      if (g.ungrouped) ungrouped.add(g.hash);
      if (g.groupWith) groupWith.set(g.hash, g.groupWith);
    }
  }
  const groups = groupVersions(items, { ungrouped, groupWith }, { skipMaker: UNKNOWN_MAKER });
  const byHash = new Map(all.map((g) => [g.hash, g]));
  const of = new Map<string, GameMeta[]>();
  for (const grp of groups) {
    const members = grp.ids.map((id) => byHash.get(id)!);
    for (const id of grp.ids) of.set(id, members);
  }
  return { members: (hash) => of.get(hash) ?? [byHash.get(hash)!].filter(Boolean) };
}

export function preferredOf(members: readonly GameMeta[]): GameMeta {
  const played = members.filter((g) => lastPlayed(g) !== undefined);
  if (played.length) return played.reduce((a, b) => (lastPlayed(b)! > lastPlayed(a)! ? b : a));
  return members.reduce((a, b) => (b.addedAt < a.addedAt ? b : a));
}
