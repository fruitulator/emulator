import { everPlayed, lastPlayed, type GameMeta } from './store';
import { parseTitle } from './title';
import { groupTitle, preferredOf, type Grouping } from './versions';
import { libraryMaker } from './maker';
import { enhanceSelect, type Dropdown } from './ui/dropdown';
import { artwork, releaseArtwork } from './ui/art';
import { actionButton, chip, searchBar, sectionHeading, tileCard, tileGrid, type SearchBar } from './ui/list';
import { UI_ICONS } from './ui/icons';
import { str } from './i18n';
import { bubbleTip } from './ui/tip';

export { everPlayed, lastPlayed };

const SYSTEM_LABELS: Record<string, string> = {
  SCORPION4: 'SC4',
  SCORPION2: 'SC2',
  MPU4: 'MPU4',
  MPU4VIDEO: 'MPU4 Video',
  MPU4PLASMA: 'MPU4 Plasma',
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

export function viewDropdown(sel: HTMLSelectElement, extra?: HTMLElement[]): Dropdown {
  return enhanceSelect(sel, { icon: 'M4 6h16M4 12h11M4 18h6', name: (c) => str('library.view_n', { 0: c }), extra });
}

export function groupVersionsRow(on: boolean, onChange: (on: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'nb-row-toggle dd-toggle';
  const text = document.createElement('span');
  text.textContent = str('gamelist.group_versions');
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'nb-toggle';
  toggle.checked = on;
  toggle.addEventListener('change', () => onChange(toggle.checked));
  row.append(text, toggle);
  return row;
}

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

export function agoText(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 90) return str('gamelist.just_now');
  if (s < 3600) return str('gamelist.nm_ago', { 0: Math.round(s / 60) });
  if (s < 86400) return str('gamelist.nh_ago', { 0: Math.round(s / 3600) });
  return str('gamelist.nd_ago', { 0: Math.round(s / 86400) });
}

export function activity(g: GameMeta): string {
  const ts = lastPlayed(g);
  if (ts === undefined) return str('gamelist.added_n', { 0: agoText(g.addedAt) });
  return str('gamelist.played_n', { 0: agoText(ts) });
}

export type Unplayable = (g: GameMeta) => { label: string; detail: string } | null;

interface CardOptions {
  hasState: boolean;
  unplayable: Unplayable;
  activate(blocked: { label: string; detail: string } | null): void;
  more?: HTMLElement | null;
  lead?: HTMLElement[];
  versions?: { count: number; open(): void };
}

export function versionsChip(count: number, open: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nb-chip nb-chip--versions chip-btn';
  const label = str('gamelist.n_versions', { n: count });
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${UI_ICONS.stack}</svg>`;
  b.append(label);
  b.addEventListener('click', (ev) => { ev.stopPropagation(); open(); });
  b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.stopPropagation(); });
  return b;
}

function gameCard(g: GameMeta, o: CardOptions): HTMLElement {
  const parsed = parseTitle(g.sourceName ?? g.name);
  const shown = o.versions ? groupTitle(g) : displayTitle(g);

  const blocked = o.unplayable(g);
  const open = () => o.activate(blocked);
  const art = artwork(g.hasThumb ? g.hash : null, parsed.title, open,
    g.hasThumb ? undefined : g.hash);

  let flag: HTMLElement | null = null;
  if (blocked) {
    flag = document.createElement('span');
    flag.className = 'card-flag nb-chip nb-chip--cherry';
    flag.textContent = '!';
    flag.title = blocked.detail;
    flag.setAttribute('aria-hidden', 'true');
  }

  const plat: HTMLElement[] = [...(o.lead ?? []), chip(systemLabel(g.system), 'plat')];
  if (o.versions) plat.push(versionsChip(o.versions.count, o.versions.open));
  if (blocked) {
    const badge = chip(blocked.label, 'warn');
    badge.title = blocked.detail;
    plat.push(badge);
  } else if (g.damagedRoms?.length) {
    const badge = chip(str('gamelist.damaged_file'), 'warn');
    badge.title = str('gamelist.n_this_file_looks_damaged', { 0: g.damagedRoms.join(', ') });
    plat.push(badge);
  }

  const inner: HTMLElement[] = [];

  const chips = document.createElement('div');
  chips.className = 'chips panel-tags';
  {
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
  }
  chips.append(...parsed.chips.map((t) => chip(t)));
  if (chips.childElementCount) inner.push(chips);

  const sub = document.createElement('div');
  sub.className = 'nb-meta panel-activity';
  sub.textContent = [activity(g), ...(o.hasState ? [str('orbit.state_saved')] : [])].join(' · ');
  inner.push(sub);

  const el = tileCard({
    label: blocked ? `${shown} - ${blocked.detail}` : shown,
    art, flag, title: shown, titleTip: parsed.raw, chips: plat, body: inner, more: o.more ?? null,
  });
  if (blocked) el.classList.add('cannot-run');
  if (o.versions) el.classList.add('nb-card--stack');

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

function featuredCard(
  g: GameMeta, hasState: boolean, blocked: { label: string; detail: string } | null, open: () => void,
): HTMLElement {
  const title = displayTitle(g);
  const box = document.createElement('article');
  box.className = 'nb-glass nb-glass--hero lib-featured';
  box.setAttribute('aria-label', title);
  const art = artwork(g.hasThumb ? g.hash : null, title, open, g.hasThumb ? undefined : g.hash);
  art.classList.add('lib-featured-art');
  const body = document.createElement('div');
  body.className = 'lib-featured-body';
  const name = document.createElement('h3');
  name.className = 'nb-display lib-featured-title';
  name.textContent = title;
  const chips = document.createElement('div');
  chips.className = 'chips';
  chips.append(chip(systemLabel(g.system), 'plat'), chip(activity(g)));
  if (hasState) chips.append(chip(str('orbit.state_saved'), 'on'));
  if (blocked) {
    const tag = chip(blocked.label);
    tag.title = blocked.detail;
    chips.append(tag);
  }
  body.append(name, chips);
  box.append(art, body);
  if (!blocked) {
    const go = actionButton(hasState ? str('orbit.resume') : str('orbit.play'), 'primary', open);
    go.classList.add('lib-featured-go');
    box.append(go);
  }
  return box;
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
  head.querySelector('h2')!.append(btn);
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
  more(g: GameMeta, hasState: boolean, members?: GameMeta[]): HTMLElement;
  versions?(members: GameMeta[], preferred: GameMeta): void;
}

export interface PickOptions extends CommonOptions {
  mode: 'pick';
  onPick(g: GameMeta): void;
  exclude?(g: GameMeta): boolean;
  fresh?: ReadonlySet<string>;
  chips?(g: GameMeta): HTMLElement[];
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
  draw(games: GameMeta[], saved?: ReadonlySet<string>, grouping?: Grouping | null): void;
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

  let groupOf = new Map<string, GameMeta[]>();

  const cardFor = (g: GameMeta): HTMLElement => {
    const hasState = saved.has(g.hash);
    if (o.mode === 'browse') {
      const members = groupOf.get(g.hash);
      const pick = o.versions;
      return gameCard(g, {
        hasState, unplayable: o.unplayable,
        activate: (blocked) => (members && pick ? pick(members, g) : o.onOpen(g, hasState, blocked)),
        more: o.more(g, hasState, members),
        ...(members && pick ? { versions: { count: members.length, open: () => pick(members, g) } } : {}),
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
      lead: [...(fresh ? [chip(str('gamelist.new'))] : []), ...(o.chips?.(g) ?? [])],
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

  const draw = (games: GameMeta[], s: ReadonlySet<string> = saved, grouping?: Grouping | null): void => {
    saved = s;
    groupOf = new Map();
    let cards = games;
    if (o.mode === 'browse' && grouping) {
      const seen = new Set<GameMeta[]>();
      cards = [];
      for (const g of games) {
        const members = grouping.members(g.hash);
        if (members.length < 2) { cards.push(g); continue; }
        if (seen.has(members)) continue;
        seen.add(members);
        const lead = preferredOf(members);
        groupOf.set(lead.hash, members);
        cards.push(lead);
      }
    }
    let sections = flat ? [{ label: '', games: cards }] : groupGames(cards, sort);
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
    if (o.mode === 'browse' && sort === 'played' && !search) {
      const last = games.find((g) => lastPlayed(g) !== undefined);
      if (last) {
        const hasState = saved.has(last.hash);
        const blocked = o.unplayable(last);
        root.append(sectionHeading(str('gamelist.continue_playing')),
          featuredCard(last, hasState, blocked, () => o.onOpen(last, hasState, blocked)));
      }
    }
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
        head = sectionHeading(label, chip(str('gamelist.n_games', { n: gs.length })));
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
    find.className = 'nb-icon-btn';
    find.setAttribute('aria-label', str('gamelist.search_your_games_2'));
    bubbleTip(find, str('gamelist.search_your_games_2'), str('gamelist.search_tip'));
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
    sortSel = document.createElement('select');
    sortSel.id = 'pick-sort';
    for (const c of SORT_CHOICES) {
      const opt = document.createElement('option');
      opt.value = c.key;
      opt.textContent = c.label;
      sortSel.append(opt);
    }
    sortSel.value = sort;
    wrap.append(sortSel);
    const sel = sortSel;
    sel.addEventListener('change', () => { sort = sel.value as SortKey; storeSort(sort); redraw(); });
    controls = wrap;
    viewDropdown(sel);
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
