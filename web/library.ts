import { renderOrbit, settleOrbitCaption, type OrbitDeps } from './orbit';
import {
  everPlayed, getMeta, lastPlayed, listGames, playCountOf, putMeta,
  type GameMeta,
} from './store';
import { localStateStore } from './statestore';
import { parseTitle } from './title';
import { clearArtwork, fillArtwork, releaseArtwork } from './ui/art';
import { chip } from './ui/list';
import {
  activity, displayTitle, gridArrowNav, groupVersionsRow, mountGameList, systemLabel, viewDropdown,
  type GameList, type SortKey,
} from './gamelist';
import { dangerRow, closeSheet, confirmInSheet, optionRow, sheetRow, showSheet } from './ui/sheet';
import { UI_ICONS } from './ui/icons';
import { orbitLogoOnce } from './ui/logoentrance';
import { showToast } from './ui/toast';

export { closeSheet };
import { APPLE, primaryModifier } from './shortcuts';
import { str } from './i18n';
import { textField } from './ui/field';

export { everPlayed, lastPlayed };
export {
  NEVER_PLAYED, activity, addedBucket, ageBucket, byTitle, displayTitle, playedBucket, systemLabel,
} from './gamelist';

import { siteNav } from './ui/sitenav';
import { isLocked } from './kioskmode';
import { bubbleTip } from './ui/tip';
import { groupLibrary, groupingOn, setGroupingOn, type Grouping } from './versions';
import { openGroupWith, openLibraryVersions, type VersionHost } from './libversions';

export interface LibraryHandlers {
  onOpen(hash: string, resume: boolean): void;
  unplayable(g: GameMeta): { label: string; detail: string } | null;
  onUnplayable(name: string, detail: string): void;
  onDelete(hash: string): Promise<void>;
  onEraseAll(): Promise<void>;
  onToggleAutoSave(hash: string, on: boolean): void;
  onRename(hash: string, title: string): void;
  onExport(hash: string): Promise<void>;
  onExportMany(): void;
  isSaving(): boolean;
}

const UNDO_MS = 10_000;

type ViewKey = 'orbit' | 'grid';

const VIEW_STORE = 'fruitulator.libView';

export const SCREEN_FADE_MS = 220;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function afterFrames(n: number): Promise<void> {
  return new Promise((r) => {
    const step = (k: number): void => { if (k <= 0) r(); else requestAnimationFrame(() => step(k - 1)); };
    step(n);
  });
}
let list: GameList | null = null;
let listH: LibraryHandlers | null = null;
function grid(h: LibraryHandlers): GameList {
  listH = h;
  list ??= mountGameList(document.getElementById('tiles')!, {
    mode: 'browse',
    unplayable: (g) => listH!.unplayable(g),
    onOpen: (g, hasState, blocked) => (blocked
      ? listH!.onUnplayable(displayTitle(g), blocked.detail)
      : listH!.onOpen(g.hash, true)),
    more: (g, hasState, members) => {
      const hh = listH!;
      const more = iconBtn('more', str('library.more_options'), () => openSheet(g, hasState, hh, more, members));
      more.className = 'nb-icon-btn card-more';
      return more;
    },
    versions: (members) => openLibraryVersions(members, versionHost(listH!)),
  });
  return list;
}

let drawn: { all: GameMeta[]; saved: ReadonlySet<string>; grouping: Grouping | null } = {
  all: [], saved: new Set(), grouping: null,
};

function versionHost(h: LibraryHandlers): VersionHost {
  return {
    saved: drawn.saved,
    open: (g) => {
      const why = h.unplayable(g);
      if (why) h.onUnplayable(displayTitle(g), why.detail);
      else h.onOpen(g.hash, true);
    },
    rerender: () => { void renderLibrary(h); },
  };
}

let ringReady = false;
let view: ViewKey = ((): ViewKey => {
  try {
    return localStorage.getItem(VIEW_STORE) === 'grid' ? 'grid' : 'orbit';
  } catch {
    return 'orbit';
  }
})();

const pendingDelete = new Map<string, number>();
const pendingToast = new Map<string, () => void>();

function forgetPending(hash: string): void {
  const t = pendingDelete.get(hash);
  if (t !== undefined) clearTimeout(t);
  pendingDelete.delete(hash);
  pendingToast.get(hash)?.();
  pendingToast.delete(hash);
}

export function cancelPendingDelete(hash: string): boolean {
  if (!pendingDelete.has(hash)) return false;
  forgetPending(hash);
  return true;
}

let firstRender = true;

export function renderLibrary(h: LibraryHandlers): Promise<void> {
  const run = renderQueue.then(() => render(h));
  renderQueue = run.then(() => {}, () => {});
  return run;
}

let renderQueue: Promise<void> = Promise.resolve();

export function commitPendingDeletes(h: LibraryHandlers): void {
  for (const hash of [...pendingDelete.keys()]) {
    forgetPending(hash);
    void h.onDelete(hash);
  }
}

function showcase(games: GameMeta[], h: LibraryHandlers): GameMeta[] {
  const playable = games.filter((g) => !h.unplayable(g));
  const now = Date.now();
  return playable
    .map((g) => ({ g, score: showcaseScore(g, now) }))
    .sort((a, b) => b.score - a.score
      || (b.g.playedAt ?? 0) - (a.g.playedAt ?? 0)
      || b.g.addedAt - a.g.addedAt)
    .map(({ g }) => g);
}

export function showcaseScore(g: GameMeta, now: number): number {
  if (!everPlayed(g)) return 0;
  const days = (now - (g.playedAt ?? g.lastPlayedAt)) / 86_400_000;
  return playCountOf(g) * Math.exp(-Math.max(0, days) / 30);
}

function orbitDeps(h: LibraryHandlers): OrbitDeps {
  return {
    h,
    displayTitle,
    systemLabel,
    activity,
    fillArtwork,
    clearArtwork,
    saveArtRatio: (hash, ratio) => {
      void getMeta(hash).then((m) => (m ? putMeta({ ...m, artRatio: ratio }) : undefined));
    },
    chip,
  };
}

async function render(h: LibraryHandlers): Promise<void> {
  const tiles = document.getElementById('tiles')!;
  const orbitWrap = document.getElementById('orbit-wrap')!;
  const empty = document.getElementById('lib-empty')!;
  const emptyMsg = document.getElementById('lib-empty-msg')!;
  const emptyActions = document.getElementById('lib-empty-actions')!;
  const emptyHint = document.getElementById('lib-empty-hint')!;
  const saving = document.getElementById('lib-saving')!;
  const quota = document.getElementById('lib-quota')!;

  let all: GameMeta[] = [];
  let saved = new Set<string>();
  let unreadable: string | null = null;
  try {
    [all, saved] = await Promise.all([listGames(), localStateStore.keys()]);
  } catch (e) {
    unreadable = e instanceof Error ? e.message : String(e);
    console.warn('[library] the library could not be read', e);
  }
  const lst = grid(h);
  const search = lst.search;
  const games = lst.visible(all.filter((g) => !pendingDelete.has(g.hash)));

  for (const f of document.querySelectorAll<HTMLElement>('.art')) releaseArtwork(f);

  const writing = h.isSaving();
  saving.hidden = !writing;
  empty.hidden = games.length > 0 || writing;
  emptyMsg.textContent = unreadable
    ? str('library.the_game_library_could_not', { 0: unreadable })
    : search
      ? str('library.no_game_matches_n', { 0: search })
      : str('library.no_games_yet');
  const welcome = !unreadable && !search;
  empty.classList.toggle('welcome', welcome);
  emptyActions.hidden = !welcome;
  emptyHint.hidden = !welcome;

  const ringGames = showcase(games, h);
  const useOrbit = isLocked() || (view === 'orbit' && ringGames.length >= 3);
  orbitWrap.hidden = !useOrbit;
  tiles.hidden = useOrbit;
  ringReady = ringGames.length >= 3;
  document.getElementById('to-orbit')!.hidden = !ringReady;
  document.body.classList.toggle('orbit-mode', useOrbit);
  if (firstRender && useOrbit) orbitLogoOnce();
  firstRender = false;

  if (useOrbit) {
    tiles.replaceChildren();
    renderOrbit(ringGames, saved, orbitDeps(h));
  } else {
    settleOrbitCaption();
    const library = all.filter((g) => !pendingDelete.has(g.hash));
    const grouping = groupingOn() ? groupLibrary(library) : null;
    drawn = { all: library, saved, grouping };
    lst.draw(games, saved, grouping);
  }

  const eager = [
    ...document.querySelectorAll<HTMLElement>('#tiles .art'),
  ].slice(0, 24);
  await Promise.race([
    Promise.allSettled(eager.map((f) => fillArtwork(f))),
    new Promise((r) => { setTimeout(r, 400); }),
  ]);

  document.body.classList.add('boot-settled');

  quota.replaceChildren();
  quota.onclick = null;
  if (all.length || unreadable) {
    let est: StorageEstimate = {};
    if (navigator.storage?.estimate) {
      try {
        est = await navigator.storage.estimate();
      } catch {
      }
    }
    quota.replaceChildren(...storageReadout(all.length, unreadable, est));
    quota.onclick = () => openStorageSheet(all.length, unreadable, est, h, quota);
  }
}

function fmtBytes(n?: number): string {
  if (n === undefined) return '?';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

function storageReadout(count: number, unreadable: string | null, est: StorageEstimate): Node[] {
  const left = document.createElement('span');
  left.textContent = unreadable ? str('library.library_unreadable') : str('library.n_cached', { 0: count });
  const more = document.createElement('span');
  more.className = 'more';
  more.textContent = '›';
  if (est.usage === undefined && est.quota === undefined) return [left, more];
  const meter = document.createElement('span');
  meter.className = 'nb-meter';
  const fill = document.createElement('span');
  const frac = est.usage !== undefined && est.quota ? Math.min(1, est.usage / est.quota) : 0;
  fill.style.width = `${(frac * 100).toFixed(3)}%`;
  meter.append(fill);
  const right = document.createElement('span');
  right.textContent = `${fmtBytes(est.usage)} / ${fmtBytes(est.quota)}`;
  return [left, meter, right, more];
}

export async function settleArtwork(capMs = 2000): Promise<void> {
  const margin = 100;
  const frames = [...document.querySelectorAll<HTMLElement>('#tiles .art[data-hash], #orbit-wrap .art[data-hash]')]
    .filter((f) => {
      const r = f.getBoundingClientRect();
      return r.width > 0 && r.bottom > -margin && r.top < window.innerHeight + margin;
    });
  if (!frames.length) return;
  await Promise.race([
    Promise.allSettled(frames.map((f) => fillArtwork(f))),
    new Promise((r) => { setTimeout(r, capMs); }),
  ]);
}

function openSheet(
  g: GameMeta, hasState: boolean, h: LibraryHandlers, returnTo: HTMLElement, members?: GameMeta[],
): void {
  const autoRow = document.createElement('label');
  autoRow.className = 'sheet-row nb-menu-item';
  const autoText = document.createElement('span');
  const autoSub = document.createElement('small');
  autoSub.textContent = str('library.keeps_this_game_where_you');
  autoText.append(str('library.auto_save_state'), autoSub);
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'nb-toggle';
  toggle.checked = g.autoSave;
  toggle.addEventListener('change', () => h.onToggleAutoSave(g.hash, toggle.checked));
  autoRow.append(autoText, toggle);

  const renameRow = renameField(g, h);

  const freshRow = sheetRow(str('library.fresh_boot'), str('library.starts_from_cold_keeping_the'));
  freshRow.addEventListener('click', () => {
    closeSheet();
    const why = h.unplayable(g);
    if (why) h.onUnplayable(displayTitle(g), why.detail);
    else h.onOpen(g.hash, false);
  });

  const exportRow = sheetRow(
    str('library.export_punnet'),
    hasState ? str('library.files_artwork_and_saved_state') : str('library.files_and_artwork_in_one'),
  );
  exportRow.addEventListener('click', () => { closeSheet(); void h.onExport(g.hash); });

  const delRow = sheetRow(str('library.remove_from_cache'), hasState ? str('library.discards_the_saved_state_too') : '');
  dangerRow(delRow);
  delRow.addEventListener('click', () => { closeSheet(); deferDelete(g, h); });

  const versionRows: HTMLElement[] = [];
  if (members) {
    const versionsRow = sheetRow(str('library.versions'), '');
    versionsRow.addEventListener('click', () => { closeSheet(); openLibraryVersions(members, versionHost(h)); });
    versionRows.push(versionsRow);
  }
  const groupRow = sheetRow(str('libversions.group_with'), '');
  groupRow.addEventListener('click', () => {
    closeSheet();
    const group = members ?? drawn.grouping?.members(g.hash) ?? [g];
    openGroupWith(g, group, drawn.all, h.unplayable, versionHost(h));
  });
  versionRows.push(groupRow);

  showSheet(displayTitle(g), [
    renameRow, autoRow, freshRow, ...versionRows, exportRow, delRow,
  ], returnTo);
}

function openStorageSheet(
  count: number, unreadable: string | null, est: StorageEstimate,
  h: LibraryHandlers, returnTo: HTMLElement,
): void {
  const info = sheetRow(
    unreadable ? str('library.library_unreadable_2') : str('library.n_games_cached', { n: count }),
    unreadable ? unreadable
      : est.usage !== undefined ? str('library.n_used_of_n_available', { 0: fmtBytes(est.usage), 1: fmtBytes(est.quota) }) : '',
  );
  info.classList.add('inert');

  const importing = h.isSaving();
  const del = sheetRow(
    str('library.delete_everything'),
    importing ? str('library.wait_for_the_import_to')
      : str('library.every_cached_game_saved_state'),
  );
  if (importing) del.classList.add('inert'); else dangerRow(del);
  del.addEventListener('click', () => {
    const what = count ? `${count} game${count === 1 ? '' : 's'}` : str('library.the_library');
    confirmInSheet({
      ask: str('library.delete_n_and_start_over', { 0: what }), sub: str('library.this_cannot_be_undone'),
      keep: count ? str('library.keep_my_games') : str('library.cancel'), yes: str('library.yes_delete_everything'),
      onYes: () => {
        for (const hash of [...pendingDelete.keys()]) forgetPending(hash);
        void h.onEraseAll();
      },
    });
  });

  const exp = sheetRow(str('library.export_games'), str('library.choose_games_or_all_of'));
  if (!count || unreadable) exp.classList.add('inert');
  else exp.addEventListener('click', () => { closeSheet(); h.onExportMany(); });

  showSheet(str('library.storage'), [info, exp, del], returnTo);
}

export async function openAddSheet(
  returnTo: HTMLElement, pick: (which: 'folder' | 'files') => void,
  more: HTMLElement[] = [],
): Promise<void> {
  const folder = optionRow(str('library.game_folder'), str('library.one_game_s_folder_or'), UI_ICONS.folder);
  folder.addEventListener('click', () => { closeSheet(); pick('folder'); });
  const files = optionRow(str('library.zip_punnet_files'), str('library.one_or_several_as_they'), UI_ICONS.archive);
  files.addEventListener('click', () => { closeSheet(); pick('files'); });

  let count = 0;
  try {
    count = (await listGames()).length;
  } catch {
  }
  let est: StorageEstimate = {};
  if (navigator.storage?.estimate) {
    try {
      est = await navigator.storage.estimate();
    } catch {
    }
  }
  const usage = document.createElement('div');
  usage.className = 'sheet-usage nb-meta';
  const left = document.createElement('span');
  left.textContent = str('library.n_games_in_this_browser', { n: count });
  usage.append(left);
  if (est.usage !== undefined || est.quota !== undefined) {
    const meter = document.createElement('div');
    meter.className = 'nb-meter';
    const fill = document.createElement('span');
    const frac = est.usage !== undefined && est.quota ? Math.min(1, est.usage / est.quota) : 0;
    fill.style.width = `${(frac * 100).toFixed(3)}%`;
    meter.append(fill);
    const right = document.createElement('span');
    right.textContent = `${fmtBytes(est.usage)} / ${fmtBytes(est.quota)}`;
    usage.append(meter, right);
  }

  const note = document.createElement('p');
  note.className = 'sheet-note nb-meta';
  note.textContent = str('library.nothing_is_uploaded_anywhere_a');

  showSheet(str('library.add_games'), [folder, files, ...more, usage, note], returnTo);
}

function renameField(g: GameMeta, h: LibraryHandlers): HTMLElement {
  const f = textField({ label: str('library.title'), value: displayTitle(g), placeholder: parseTitle(g.sourceName ?? g.name).title, spellcheck: true });
  const input = f.input;
  input.setAttribute('aria-label', str('library.game_title'));
  selectAllOnFocus(input);

  const commit = () => {
    const next = input.value.trim();
    const parsed = parseTitle(g.sourceName ?? g.name).title;
    const value = next === parsed ? '' : next;
    if ((g.title ?? '') === value) return;
    h.onRename(g.hash, value);
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); closeSheet(); }
    if (ev.key === 'Escape') { input.value = displayTitle(g); }
  });
  input.addEventListener('change', commit);
  f.el.classList.add('sheet-field');
  return f.el;
}

function selectAllOnFocus(input: HTMLInputElement): void {
  let pointer: string | null = null;
  let armed = false;
  input.addEventListener('pointerdown', (ev) => {
    pointer = document.activeElement === input ? null : ev.pointerType;
  });
  input.addEventListener('focus', () => {
    const from = pointer;
    pointer = null;
    input.select();
    armed = from !== null;
  });
  input.addEventListener('mouseup', (ev) => {
    if (!armed) return;
    armed = false;
    ev.preventDefault();
  });
  input.addEventListener('blur', () => { armed = false; pointer = null; });
}

function deferDelete(g: GameMeta, h: LibraryHandlers): void {
  const timer = window.setTimeout(() => {
    pendingDelete.delete(g.hash);
    pendingToast.delete(g.hash);
    void h.onDelete(g.hash);
  }, UNDO_MS);
  pendingDelete.set(g.hash, timer);
  void renderLibrary(h);
  pendingToast.set(g.hash, showToast(str('library.removed_n', { 0: displayTitle(g) }), {
    action: {
      label: str('library.undo'),
      run: () => {
        forgetPending(g.hash);
        void renderLibrary(h);
      },
    },
    ms: UNDO_MS,
  }));
}

const NOTICE_MS = 8_000;

export interface NoticeOptions {
  autoClose?: boolean;
  ms?: number;
}

export function showNotice(message: string, opts: NoticeOptions = {}): void {
  const { autoClose = true, ms = NOTICE_MS } = opts;
  showToast(message, { sticky: !autoClose, ms });
}

function chooseView(v: ViewKey, lst: GameList): void {
  view = v;
  if (v === 'orbit' && lst.search) {
    lst.setSearch('');
    const input = document.getElementById('lib-search') as HTMLInputElement | null;
    if (input) input.value = '';
    document.getElementById('search-wrap')?.classList.remove('open');
  }
  try { localStorage.setItem(VIEW_STORE, v); } catch {  }
}

let toGridView: (() => void) | null = null;

export function libraryToGrid(): void {
  toGridView?.();
}

let toOrbitChoice: (() => void) | null = null;

export function libraryChooseOrbit(): void {
  toOrbitChoice?.();
}

let beforeOrbit: (() => void) | null = null;
export function onBeforeOrbit(fn: () => void): void { beforeOrbit = fn; }

export function wireLibraryControls(h: LibraryHandlers): void {
  const input = document.getElementById('lib-search') as HTMLInputElement;
  const searchBtn = document.getElementById('searchBtn')!;
  const wrap = document.getElementById('search-wrap')!;
  const closeBtn = document.getElementById('search-close')!;
  const tiles = document.getElementById('tiles')!;
  const sortSel = document.getElementById('lib-sort') as HTMLSelectElement;
  const lst = grid(h);

  document.getElementById('search-kbd')!.textContent = APPLE ? str('library.k') : str('library.ctrl_k');
  searchBtn.title = str('library.search_your_games_n', { 0: APPLE ? '⌘K' : 'Ctrl+K' });
  searchBtn.setAttribute('aria-keyshortcuts', APPLE ? 'Meta+K' : 'Control+K');

  let returnFocus: HTMLElement | null = null;
  const openSearch = (): void => {
    if (!wrap.classList.contains('open')) {
      const a = document.activeElement;
      returnFocus = a instanceof HTMLElement && a !== document.body ? a : null;
      wrap.classList.add('open');
    }
    input.focus({ preventScroll: true });
    input.select();
  };
  const closeSearch = (): void => {
    wrap.classList.remove('open');
    if (lst.search) { lst.setSearch(''); input.value = ''; void renderLibrary(h); }
    const back = returnFocus;
    returnFocus = null;
    if (wrap.contains(document.activeElement)) {
      if (back?.isConnected) back.focus({ preventScroll: true });
      else (document.activeElement as HTMLElement).blur();
    }
  };

  selectAllOnFocus(input);

  searchBtn.addEventListener('click', () => {
    if (wrap.classList.contains('open')) closeSearch(); else openSearch();
  });
  closeBtn.addEventListener('click', closeSearch);
  input.addEventListener('input', () => {
    lst.setSearch(input.value.trim().toLowerCase());
    void renderLibrary(h).then(() => {
      if (tiles.getBoundingClientRect().top < 0) window.scrollTo({ top: 0 });
    });
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    closeSearch();
  });
  document.addEventListener('keydown', (ev) => {
    if (!searchChord(ev)) return;
    if (document.body.classList.contains('source-view')) return;
    ev.preventDefault();
    if (wrap.classList.contains('open') && document.activeElement === input) closeSearch();
    else openSearch();
  });
  sortSel.value = lst.sort;
  viewDropdown(sortSel, [groupVersionsRow(groupingOn(), (on) => {
    setGroupingOn(on);
    void renderLibrary(h);
  })]);
  sortSel.addEventListener('change', () => {
    lst.setSort(sortSel.value as SortKey);
    void renderLibrary(h);
  });

  let switching = false;
  const setView = async (v: ViewKey) => {
    if (view === v || switching) return;
    if (v === 'grid' && isLocked()) return;
    switching = true;
    document.body.classList.add('mode-fade');
    await new Promise((r) => { setTimeout(r, prefersReducedMotion() ? 0 : SCREEN_FADE_MS); });
    if (v === 'orbit') beforeOrbit?.();
    chooseView(v, lst);
    window.scrollTo(0, 0);
    await renderLibrary(h);
    await settleArtwork();
    await afterFrames(2);
    document.body.classList.remove('mode-fade');
    switching = false;
  };
  toGridView = () => { if (view !== 'grid') void setView('grid'); };
  toOrbitChoice = () => { beforeOrbit?.(); chooseView('orbit', lst); };
  document.querySelector('header h1')!.addEventListener('click', () => {
    const lib = document.getElementById('library') as HTMLElement;
    if (!lib.hidden && ringReady) setView('orbit');
  });
  document.getElementById('to-library')!.addEventListener('click', () => setView('grid'));
  bubbleTip(document.getElementById('to-library')!, str('ui.tip.library_name'), str('ui.tip.library'));
  bubbleTip(document.getElementById('to-orbit')!, str('ui.tip.home_name'), str('ui.tip.home'));
  document.getElementById('settingsBtn')!.before(siteNav({ here: 'games' }));
  document.getElementById('to-orbit')!.addEventListener('click', () => {
    if (ringReady) setView('orbit');
  });

  document.getElementById('library')!.addEventListener('keydown', gridArrowNav);

  document.addEventListener('keydown', (ev) => {
    if (!typeToSearch(ev)) return;
    openSearch();
    ev.stopPropagation();
  });
}

function gridInFront(): boolean {
  const lib = document.getElementById('library') as HTMLElement;
  const tiles = document.getElementById('tiles') as HTMLElement;
  if (lib.hidden || lib.inert || tiles.hidden) return false;
  for (const id of ['sheet', 'menu', 'importReport', 'schemPanel', 'errorPopup']) {
    const el = document.getElementById(id) as HTMLElement | null;
    if (el && !el.hidden) return false;
  }
  return true;
}

function searchChord(ev: KeyboardEvent): boolean {
  if (ev.key.toLowerCase() !== 'k' || ev.altKey || ev.shiftKey || ev.isComposing) return false;
  if (!primaryModifier(ev)) return false;
  if (!gridInFront()) return false;
  const t = ev.target;
  if (t instanceof HTMLInputElement && t.id !== 'lib-search') return false;
  return !(t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable));
}

function typeToSearch(ev: KeyboardEvent): boolean {
  if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.isComposing) return false;
  if (!/^[a-z0-9]$/i.test(ev.key)) return false;
  if (!gridInFront()) return false;
  const t = ev.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return false;
  if (t instanceof HTMLElement && t.isContentEditable) return false;
  return true;
}

const ICONS: Record<string, string> = {
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};

export function icon(name: keyof typeof ICONS | string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

function iconBtn(name: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nb-icon-btn';
  b.append(icon(name));
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('click', onClick);
  return b;
}
