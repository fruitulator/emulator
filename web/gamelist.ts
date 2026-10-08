import { everPlayed, lastPlayed, type GameMeta } from './store';
import { parseTitle } from './title';
import { libraryMaker } from './maker';
import { enhanceSelect } from './ui/dropdown';
import { artwork, releaseArtwork } from './ui/art';
import { chip, searchBar, sectionHeading, tileCard, tileGrid, type SearchBar } from './ui/list';
import { UI_ICONS } from './ui/icons';
import { str } from './i18n';

export { everPlayed, lastPlayed };

const SYSTEM_LABELS: Record<string, string> = {
  SCORPION4: 'SC4',
  SCORPION2: 'SC2',
  MPU4: 'MPU4',
  MPU4VIDEO: 'MPU4 Video',
  IMPACT: 'IMPACT',
  SPACE: 'sp.ACE',
  M1AB: 'M1A/B',
  MPU5: 'MPU5',
  SCORPION5: 'SC5',
};

export function systemLabel(system: string): string {
  return SYSTEM_LABELS[system] ?? system;
}

export type SortKey = 'played' | 'newest' | 'oldest' | 'name' | 'platform' | 'maker';

export const SORT_CHOICES: readonly { key: SortKey; label: string }[] = [
  { key: 'played', label: str('gamelist.played') },
  { key: 'newest', label: str('gamelist.newest') },
  { key: 'oldest', label: str('gamelist.oldest') },
  { key: 'name', label: str('gamelist.name') },
  { key: 'platform', label: str('gamelist.platform') },
  { key: 'maker', label: str('gamelist.manufacturer') },
];

const DEFAULT_SORT: SortKey = 'played';
export const NEVER_PLAYED = str('gamelist.not_yet_played');

const SORT_STORE = 'fruitulator.libSort';

function storedSort(): SortKey {
  try {
    const s = localStorage.getItem(SORT_STORE);
    return s === 'newest' || s === 'oldest' || s === 'name' || s === 'platform' || s === 'maker'
      ? s : DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}

function storeSort(k: SortKey): void {
  try { localStorage.setItem(SORT_STORE, k); } catch {  }
}

export function displayTitle(g: GameMeta): string {
  return g.title?.trim() || parseTitle(g.sourceName ?? g.name).title;
}

export function matches(g: GameMeta, q: string): boolean {
  if (!q) return true;
  const t = parseTitle(g.sourceName ?? g.name);
  const hay = `${displayTitle(g)} ${t.chips.join(' ')} ${t.raw} ${SYSTEM_LABELS[g.system] ?? g.system}`;
  return hay.toLowerCase().includes(q);
}

export function byTitle(a: GameMeta, b: GameMeta): number {
  return displayTitle(a).localeCompare(displayTitle(b), undefined, { numeric: true, sensitivity: 'base' });
}

function byPlayed(a: GameMeta, b: GameMeta): number {
  const pa = lastPlayed(a);
  const pb = lastPlayed(b);
  if (pa === undefined && pb === undefined) return byTitle(a, b);
  if (pa === undefined) return 1;
  if (pb === undefined) return -1;
  return pb - pa;
}

export function sortGames(games: GameMeta[], sortBy: SortKey): GameMeta[] {
  const by = {
    played: byPlayed,
    newest: (a: GameMeta, b: GameMeta) => b.addedAt - a.addedAt,
    oldest: (a: GameMeta, b: GameMeta) => a.addedAt - b.addedAt,
    name: byTitle,
    platform: (a: GameMeta, b: GameMeta) =>
      systemLabel(a.system).localeCompare(systemLabel(b.system)),
    maker: (a: GameMeta, b: GameMeta) => libraryMaker(a).localeCompare(libraryMaker(b)),
  }[sortBy];
  return [...games].sort(by);
}

export function ageBucket(ts: number, now = Date.now()): string {
  const t = new Date(ts);
  const n = new Date(now);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((day(n) - day(t)) / 86_400_000);
  if (daysAgo <= 0) return str('gamelist.today');
  if (daysAgo === 1) return str('gamelist.yesterday');
  const weekStart = (d: Date) => day(d) - ((d.getDay() + 6) % 7) * 86_400_000;
  const weeksAgo = Math.round((weekStart(n) - weekStart(t)) / (7 * 86_400_000));
  if (weeksAgo === 0) return str('gamelist.this_week');
  if (weeksAgo === 1) return str('gamelist.last_week');
  const monthsAgo = (n.getFullYear() - t.getFullYear()) * 12 + n.getMonth() - t.getMonth();
  if (monthsAgo === 0) return str('gamelist.this_month');
  if (monthsAgo === 1) return str('gamelist.last_month');
  if (monthsAgo < 12) return str('gamelist.n_months_ago', { 0: monthsAgo });
  const yearsAgo = Math.floor(monthsAgo / 12);
  return yearsAgo === 1 ? str('gamelist.last_year') : str('gamelist.n_years_ago', { 0: yearsAgo });
}

export function addedBucket(g: GameMeta, now = Date.now()): string {
  return ageBucket(g.addedAt, now);
}

export function playedBucket(g: GameMeta, now = Date.now()): string {
  const ts = lastPlayed(g);
  return ts === undefined ? NEVER_PLAYED : ageBucket(ts, now);
}

export function groupGames(games: GameMeta[], sortBy: SortKey): { label: string; games: GameMeta[] }[] {
  const keyOf = {
    played: (g: GameMeta) => playedBucket(g),
    platform: (g: GameMeta) => systemLabel(g.system),
    maker: (g: GameMeta) => libraryMaker(g),
    name: (g: GameMeta) => {
      const c = displayTitle(g).charAt(0).toUpperCase();
      if (c >= 'A' && c <= 'Z') return c;
      if (c >= '0' && c <= '9') return '0-9';
      return '#';
    },
    newest: (g: GameMeta) => addedBucket(g),
    oldest: (g: GameMeta) => addedBucket(g),
  }[sortBy];
  const out: { label: string; games: GameMeta[] }[] = [];
  for (const g of games) {
    const label = keyOf(g);
    const last = out[out.length - 1];
    if (last && last.label === label) last.games.push(g);
    else out.push({ label, games: [g] });
  }
  if (sortBy !== 'played') for (const s of out) s.games.sort(byTitle);
  return out;
}

const reveal = typeof IntersectionObserver === 'undefined' ? null
  : new IntersectionObserver((entries, obs) => {
    const crossfading = document.body.classList.contains('mode-fade');
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      if (!crossfading) e.target.classList.add('card-in');
      animated.add((e.target as HTMLElement).dataset.hash ?? '');
      obs.unobserve(e.target);
    }
  }, { rootMargin: '80px 0px' });

const animated = new Set<string>();

function played(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 90) return str('gamelist.just_now');
  if (s < 3600) return str('gamelist.nm_ago', { 0: Math.round(s / 60) });
  if (s < 86400) return str('gamelist.nh_ago', { 0: Math.round(s / 3600) });
  return str('gamelist.nd_ago', { 0: Math.round(s / 86400) });
}

export function activity(g: GameMeta): string {
  const ts = lastPlayed(g);
  if (ts === undefined) return `added ${played(g.addedAt)}`;
  return `played ${played(ts)}`;
}

export type Unplayable = (g: GameMeta) => { label: string; detail: string } | null;

interface CardOptions {
  hasState: boolean;
  unplayable: Unplayable;
  activate(blocked: { label: string; detail: string } | null): void;
  more?: HTMLElement | null;
  lead?: HTMLElement[];
}

function gameCard(g: GameMeta, o: CardOptions): HTMLElement {
  const parsed = parseTitle(g.sourceName ?? g.name);
  const shown = displayTitle(g);

  const blocked = o.unplayable(g);
  const open = () => o.activate(blocked);
  const art = artwork(g.hasThumb ? g.hash : null, parsed.title, open);

  let flag: HTMLElement | null = null;
  if (blocked) {
    flag = document.createElement('span');
    flag.className = 'card-flag';
    flag.textContent = '!';
    flag.title = blocked.detail;
    flag.setAttribute('aria-hidden', 'true');
  }

  const plat: HTMLElement[] = [...(o.lead ?? []), chip(systemLabel(g.system), 'plat')];
  if (blocked) {
    const badge = chip(blocked.label, 'warn');
    badge.title = blocked.detail;
    plat.push(badge);
  }

  const inner: HTMLElement[] = [];

  if (parsed.chips.length || g.decodeStatus !== 'ok' || g.missingSound?.length) {
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const c of parsed.chips) chips.append(chip(c));
    if (g.missingSound?.length && !blocked) {
      const badge = chip(str('gamelist.no_sound'), 'warn');
      badge.title = str('gamelist.the_gam_names_sound_roms', { 0: g.missingSound.join(', ') });
      chips.append(badge);
    }
    if (g.decodeStatus === 'fallback') {
      const badge = chip(str('gamelist.no_artwork'), 'warn');
      badge.title = str('gamelist.the_layout_could_not_be');
      chips.append(badge);
    } else if (g.decodeStatus === 'partial') {
      const d = g.decode;
      const badge = chip(d ? str('gamelist.n_unread', { 0: d.total - d.clean }) : str('gamelist.partly_read'), 'warn');
      badge.title = d
        ? str('gamelist.n_of_n_layout_components', { 0: d.clean, 1: d.total })
        : str('gamelist.some_layout_components_were_not');
      chips.append(badge);
    }
    inner.push(chips);
  }

  const sub = document.createElement('div');
  sub.className = 'readout';
  sub.textContent = `${activity(g)}${o.hasState ? ' · state saved' : ''}`;
  inner.push(sub);

  const el = tileCard({
    label: blocked ? `${shown} - ${blocked.detail}` : shown,
    art, flag, title: shown, titleTip: parsed.raw, chips: plat, body: inner, more: o.more ?? null,
  });
  if (blocked) el.classList.add('cannot-run');

  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target === el) { ev.preventDefault(); open(); }
  });
  el.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) ev.preventDefault();
  });
  el.dataset.hash = g.hash;
  if (!animated.has(g.hash)) reveal?.observe(el);
  return el;
}

function markChosen(card: HTMLElement, on: boolean): void {
  card.classList.toggle('chosen', on);
  card.setAttribute('aria-checked', String(on));
}

function pickHeading(label: string, onToggle: () => void): HTMLElement {
  const head = sectionHeading('');
  head.classList.add('group-pick');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'group-pick-btn';
  btn.setAttribute('role', 'checkbox');
  btn.setAttribute('aria-label', str('gamelist.choose_every_game_under_n', { 0: label }));
  const tick = document.createElement('span');
  tick.className = 'group-tick';
  tick.setAttribute('aria-hidden', 'true');
  tick.innerHTML = '<svg viewBox="0 0 24 24" focusable="false">'
    + '<path class="t-all" d="M5 12.5l4.5 4.5L19 7.5"/><path class="t-some" d="M6 12h12"/></svg>';
  const text = document.createElement('span');
  text.textContent = label;
  btn.append(tick, text);
  btn.addEventListener('click', onToggle);
  head.append(btn);
  return head;
}

function markHeading(head: HTMLElement, games: GameMeta[], chosen: (g: GameMeta) => boolean): void {
  const n = games.filter(chosen).length;
  const all = n > 0 && n === games.length;
  const some = n > 0 && !all;
  head.classList.toggle('chosen', all);
  head.classList.toggle('mixed', some);
  head.querySelector('.group-pick-btn')?.setAttribute('aria-checked', all ? 'true' : some ? 'mixed' : 'false');
}

export function gridArrowNav(ev: KeyboardEvent): void {
  if (!ev.key.startsWith('Arrow')) return;
  const target = ev.target as HTMLElement;
  const card = target.closest('.card') as HTMLElement | null;
  if (!card) return;
  const container = card.parentElement!;
  const cards = [...container.querySelectorAll<HTMLElement>('.card')];
  const i = cards.indexOf(card);
  if (i < 0) return;
  const perRow = Math.max(1, cards.filter((c) => c.offsetTop === cards[0].offsetTop).length);
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRow, ArrowUp: -perRow }[ev.key];
  if (step === undefined) return;
  const next = cards[i + step];
  if (!next) return;
  ev.preventDefault();
  next.focus();
}

interface CommonOptions {
  unplayable: Unplayable;
  thumbSize?: 'large' | 'small';
}

export interface BrowseOptions extends CommonOptions {
  mode: 'browse';
  onOpen(g: GameMeta, hasState: boolean, blocked: { label: string; detail: string } | null): void;
  more(g: GameMeta, hasState: boolean): HTMLElement;
}

export interface PickOptions extends CommonOptions {
  mode: 'pick';
  onPick(g: GameMeta): void;
  exclude?(g: GameMeta): boolean;
  fresh?: ReadonlySet<string>;
  onDrawn?(shown: number): void;
  chosen?(g: GameMeta): boolean;
  flat?: boolean;
}

export type GameListOptions = BrowseOptions | PickOptions;

export interface GameList {
  readonly controls: HTMLElement | null;
  readonly searchButton: HTMLButtonElement | null;
  readonly search: string;
  setSearch(q: string): void;
  readonly sort: SortKey;
  setSort(k: SortKey): void;
  visible(all: GameMeta[]): GameMeta[];
  draw(games: GameMeta[], saved?: ReadonlySet<string>): void;
  load(all: GameMeta[], saved?: ReadonlySet<string>): void;
  refresh(): void;
}

export function mountGameList(root: HTMLElement, o: GameListOptions): GameList {
  let search = '';
  let sort = storedSort();
  let all: GameMeta[] = [];
  let saved: ReadonlySet<string> = new Set();
  let controls: HTMLElement | null = null;
  let sortSel: HTMLSelectElement | null = null;
  let searchButton: HTMLButtonElement | null = null;
  let bar: SearchBar | null = null;
  let heads: { head: HTMLElement; games: GameMeta[] }[] = [];
  const markHeadings = (): void => {
    if (o.mode !== 'pick' || !o.chosen) return;
    for (const h of heads) markHeading(h.head, h.games, o.chosen);
  };
  root.classList.toggle('tiles-small', o.thumbSize === 'small');

  const flat = o.mode === 'pick' && !!o.flat;
  const visible = (games: GameMeta[]): GameMeta[] => {
    const kept = games.filter((g) => matches(g, search) && !(o.mode === 'pick' && o.exclude?.(g)));
    return flat ? kept : sortGames(kept, sort);
  };

  const cardFor = (g: GameMeta): HTMLElement => {
    const hasState = saved.has(g.hash);
    if (o.mode === 'browse') {
      return gameCard(g, {
        hasState, unplayable: o.unplayable,
        activate: (blocked) => o.onOpen(g, hasState, blocked),
        more: o.more(g, hasState),
      });
    }
    const fresh = !!o.fresh?.has(g.hash);
    const card = gameCard(g, {
      hasState, unplayable: o.unplayable,
      activate: () => {
        o.onPick(g);
        if (o.chosen) markChosen(card, o.chosen(g));
        markHeadings();
      },
      lead: fresh ? [chip(str('gamelist.new'))] : [],
    });
    if (o.chosen) {
      const tick = document.createElement('span');
      tick.className = 'card-tick';
      tick.setAttribute('aria-hidden', 'true');
      tick.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
      card.querySelector('.art')?.append(tick);
      card.setAttribute('role', 'checkbox');
      markChosen(card, o.chosen(g));
    }
    return card;
  };

  const draw = (games: GameMeta[], s: ReadonlySet<string> = saved): void => {
    saved = s;
    let sections = flat ? [{ label: '', games }] : groupGames(games, sort);
    if (o.mode === 'pick' && !flat) {
      for (const f of root.querySelectorAll<HTMLElement>('.art')) releaseArtwork(f);
      const fresh = o.fresh;
      if (fresh?.size) {
        const news = games.filter((g) => fresh.has(g.hash));
        if (news.length) {
          sections = [
            { label: str('gamelist.new'), games: news },
            ...groupGames(games.filter((g) => !fresh.has(g.hash)), sort),
          ];
        }
      }
    }
    heads = [];
    for (const c of [...root.children]) if (c !== bar?.wrap) c.remove();
    if (bar && bar.wrap.parentNode !== root) root.prepend(bar.wrap);
    root.append(...sections.flatMap(({ label, games: gs }) => {
      if (flat) return [tileGrid(gs.map(cardFor))];
      let head: HTMLElement;
      if (o.mode === 'pick' && o.chosen) {
        const chosen = o.chosen;
        head = pickHeading(label, () => {
          const on = !gs.every(chosen);
          for (const g of gs) if (chosen(g) !== on) o.onPick(g);
          api.refresh();
        });
        heads.push({ head, games: gs });
      } else {
        head = sectionHeading(label);
      }
      return [head, tileGrid(gs.map(cardFor))];
    }));
    markHeadings();
    if (o.mode === 'pick') o.onDrawn?.(games.length);
  };

  const redraw = (): void => { if (o.mode === 'pick') draw(visible(all)); };

  if (o.mode === 'pick') {
    const sb = searchBar({
      placeholder: str('gamelist.search_your_games'), label: str('gamelist.search_your_games_2'),
      onInput: (v) => { search = v.toLowerCase(); redraw(); },
    });
    bar = sb;
    const find = document.createElement('button');
    find.type = 'button';
    find.className = 'iconbtn';
    find.setAttribute('aria-label', str('gamelist.search_your_games_2'));
    find.title = str('gamelist.search_your_games_2');
    const glass = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    glass.setAttribute('viewBox', '0 0 24 24');
    glass.setAttribute('aria-hidden', 'true');
    glass.innerHTML = UI_ICONS.search;
    find.append(glass);
    find.addEventListener('click', () => {
      if (!sb.wrap.classList.contains('open')) { sb.open(); return; }
      if (sb.input.value) { sb.input.value = ''; search = ''; redraw(); }
      sb.close();
    });
    searchButton = find;
    root.prepend(sb.wrap);
    root.addEventListener('keydown', gridArrowNav);
  }
  if (o.mode === 'pick' && !flat) {
    const wrap = document.createElement('div');
    wrap.className = 'ui-sort-wrap';
    const lab = document.createElement('span');
    lab.className = 'ui-sort-label';
    lab.id = 'pick-sort-label';
    lab.textContent = str('gamelist.view');
    sortSel = document.createElement('select');
    sortSel.id = 'pick-sort';
    sortSel.setAttribute('aria-labelledby', lab.id);
    for (const c of SORT_CHOICES) {
      const opt = document.createElement('option');
      opt.value = c.key;
      opt.textContent = c.label;
      sortSel.append(opt);
    }
    sortSel.value = sort;
    wrap.append(lab, sortSel);
    const sel = sortSel;
    sel.addEventListener('change', () => { sort = sel.value as SortKey; storeSort(sort); redraw(); });
    controls = wrap;
    enhanceSelect(sel);
  }

  const api: GameList = {
    refresh() {
      if (o.mode !== 'pick' || !o.chosen) return;
      const byHash = new Map(all.map((g) => [g.hash, g]));
      for (const card of root.querySelectorAll<HTMLElement>('.card')) {
        const g = byHash.get(card.dataset.hash ?? '');
        if (g) markChosen(card, o.chosen(g));
      }
      markHeadings();
    },
    get controls() { return controls; },
    get searchButton() { return searchButton; },
    get search() { return search; },
    setSearch(q: string) { search = q; },
    get sort() { return sort; },
    setSort(k: SortKey) { sort = k; storeSort(k); },
    visible,
    draw,
    load(games: GameMeta[], s?: ReadonlySet<string>) {
      all = games;
      if (s) saved = s;
      redraw();
    },
  };
  return api;
}
