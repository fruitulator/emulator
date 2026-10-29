import { getMeta, getThumb, putMeta, type GameMeta } from './store';
import { parseTitle } from './title';
import { cleanTitle } from './versionkey';
import { libraryMaker } from './maker';
import { groupTitle, preferredOf } from './versions';
import { openVersionPicker } from './versionpicker';
import { activity, displayTitle, mountGameList, systemLabel, type Unplayable } from './gamelist';
import { openDialog } from './ui/dialog';
import { str } from './i18n';

export interface VersionHost {
  saved: ReadonlySet<string>;
  open(g: GameMeta): void;
  rerender(): void;
}

async function update(hash: string, change: (m: GameMeta) => GameMeta): Promise<void> {
  const m = await getMeta(hash);
  if (m) await putMeta(change(m));
}

async function thumbUrl(g: GameMeta): Promise<string | null> {
  if (!g.hasThumb) return null;
  const bytes = await getThumb(g.hash);
  if (!bytes) return null;
  const type = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/webp';
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
}

export function versionTags(members: readonly { title: string; source: string; system: string }[]): string[][] {
  const each = members.map((m) => {
    const clean = new Set(cleanTitle(m.title).toLowerCase().split(/\s+/));
    const taken = m.title.split(/\s+/).filter((w) => w && !/^[-–—]$/.test(w) && !clean.has(w.toLowerCase()));
    return [...new Set([...taken, ...parseTitle(m.source).chips, systemLabel(m.system)])];
  });
  return each.map((tags) => tags.filter((t) => !each.every((other) => other.includes(t))));
}

export function openLibraryVersions(members: GameMeta[], host: VersionHost): void {
  const preferred = preferredOf(members);
  const tags = versionTags(members.map((m) => ({ title: displayTitle(m), source: m.sourceName ?? m.name, system: m.system })));
  openVersionPicker({
    title: groupTitle(preferred),
    maker: libraryMaker(preferred),
    rows: members.map((m, i) => ({
      title: displayTitle(m),
      tags: tags[i],
      status: [activity(m), ...(host.saved.has(m.hash) ? [str('orbit.state_saved')] : [])].join(' · '),
      resume: host.saved.has(m.hash),
      preferred: m === preferred,
      thumb: () => thumbUrl(m),
      revoke: true,
    })),
    onPlay: (i) => host.open(members[i]),
    onUngroup: () => {
      void Promise.all(members.map((m) => update(m.hash, (r) => {
        const { groupWith: _gone, ...rest } = r;
        return { ...rest, ungrouped: true as const };
      }))).then(host.rerender);
    },
  });
}

export function openGroupWith(
  g: GameMeta, members: readonly GameMeta[], all: readonly GameMeta[], unplayable: Unplayable, host: VersionHost,
): void {
  const inGroup = new Set(members.map((m) => m.hash));
  const grid = document.createElement('div');
  grid.className = 'ui-list';
  const list = mountGameList(grid, {
    mode: 'pick',
    unplayable,
    thumbSize: 'small',
    exclude: (x) => inGroup.has(x.hash),
    onPick: (x) => {
      dialog.close();
      void update(x.hash, (r) => {
        const { ungrouped: _gone, ...rest } = r;
        return { ...rest, groupWith: g.hash };
      }).then(host.rerender);
    },
  });
  const dialog = openDialog({
    title: str('libversions.group_with'),
    body: [...(list.controls ? [list.controls] : []), grid],
    actions: list.searchButton ? [list.searchButton] : [],
  });
  list.load([...all], host.saved);
  list.searchButton?.click();
}
