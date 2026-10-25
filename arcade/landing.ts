import { listGames, type GameMeta } from '../web/store';
import { openDialog } from '../web/ui/dialog';
import { MENU_ICONS, UI_ICONS } from '../web/ui/icons';
import { artwork, thumbMosaic, thumbStack } from '../web/ui/art';
import { actionButton, chip, chipButton, emptyState, searchBar, sectionHeading, tileCard, tileGrid, tileStrip } from '../web/ui/list';
import { caption, card } from '../web/ui/rows';
import { fillProgramHashes, newArcade, standing, type ArcadeDoc } from './doc';
import { exportArcadeGames } from './punnet';
import { openMachineList } from './machinelist';
import { listArcades, putArcade, setCurrentArcade } from './docstore';
import { ARCADE_NAME_MAX, cleanName } from './machines';
import { avatarUrl, needLogin, serverArcades } from './account';
import { avatarFace } from '../web/ui/avatar';
import { mountAvatar } from './avatar';
import { showToast } from '../web/ui/toast';
import { arcadeServer, HAVE_ONE, NAME_TAKEN, nameTakenHere, newHostKey, offerLink, publishRefusal, shareArcade, shareHooks, shareLink, floorLink, syncArcade } from './share';
import { arcadeFigures, pounds, publicSwitch, type ArcadeFigures, type ShareHooks } from './hostsettings';
import { ARCADES_PER_PLAYER, MACHINE_ID_LEN, type ArcadeListing, type ArcadeSort } from './serverwire';
import { tabBar } from '../web/ui/tabs';
import { siteNav } from '../web/ui/sitenav';
import { betaBrand, betaNotice } from '../web/ui/beta';
import { bubbleTip } from '../web/ui/tip';
import { ratingChip } from '../web/ui/stars';
import { str } from '../web/i18n';

const HOST_PAGE = '/arcade/?host';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string | null, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

const machinesChip = (n: number, list: (() => void) | null = null): HTMLElement => {
  const label = str('arcade.landing.n_machines', { n });
  return list ? chipButton(label, str('arcade.machinelist.machines_in_this_arcade'), list) : chip(label);
};

type Community = { kind: 'none' } | { kind: 'down' } | { kind: 'ok'; arcades: ArcadeListing[] };

const ROWS: { sort: ArcadeSort; label: () => string }[] = [
  { sort: 'top', label: () => str('arcade.landing.top_rated') },
  { sort: 'visits', label: () => str('arcade.landing.most_visited') },
  { sort: 'latest', label: () => str('arcade.landing.latest') },
];

export async function openLanding(): Promise<void> {
  for (const id of ['room', 'bar', 'at', 'stats']) document.getElementById(id)?.setAttribute('hidden', '');
  document.body.classList.add('hosting', 'landing');
  const root = document.getElementById('host') as HTMLElement;
  const top = el('div', null, 'host-top');
  const home = document.getElementById('home');
  if (home) top.append(betaBrand(home));
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'iconbtn landing-plus';
  plus.setAttribute('aria-label', str('arcade.landing.create_arcade'));
  bubbleTip(plus, str('arcade.landing.create_arcade'), str('ui.tip.create_arcade'));
  plus.hidden = true;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = UI_ICONS.plus;
  plus.append(svg);
  plus.addEventListener('click', () => { void signedInThen(() => { void openCreate(); }); });
  const lib = siteNav({ here: 'arcades', about: true });
  const right = el('div', null, 'landing-right host-top-right');
  right.append(lib, plus);
  top.append(right);
  void mountAvatar(right);
  root.before(top);
  root.hidden = false;

  const server = await arcadeServer();
  const fetchList = (s: ArcadeSort): Promise<Community> => (server
    ? server.list(s).then((arcades): Community => ({ kind: 'ok', arcades })).catch((): Community => ({ kind: 'down' }))
    : Promise.resolve<Community>({ kind: 'none' }));
  const [mine, library, rowLists, onServer] = await Promise.all([
    listArcades().catch(() => [] as ArcadeDoc[]),
    listGames().catch(() => [] as GameMeta[]),
    Promise.all(ROWS.map((r) => fetchList(r.sort))),
    serverArcades().catch(() => [] as ArcadeListing[]),
  ]);
  for (const d of mine) {
    if (fillProgramHashes(d, library)) void putArcade(d).then(() => syncArcade(d)).catch((e) => console.warn('[arcade] the program hashes were not kept', e));
  }
  const byRow = new Map(ROWS.map((r, i) => [r.sort, rowLists[i]]));
  const firstList: Community = rowLists.find((c) => c.kind === 'ok') ?? rowLists[0];
  const elsewhere = onServer.filter((a) => !mine.some((m) => m.id === a.id));
  const count = mine.length + elsewhere.length;
  plus.hidden = count >= ARCADES_PER_PLAYER;
  const thumbs = new Map<string, string>();
  for (const g of library) if (g.contentHash && g.hasThumb && !thumbs.has(g.contentHash)) thumbs.set(g.contentHash, g.hash);
  const mineById = new Map<string, GameMeta>();
  for (const g of library) if (g.contentHash && !mineById.has(g.contentHash.slice(0, MACHINE_ID_LEN))) mineById.set(g.contentHash.slice(0, MACHINE_ID_LEN), g);
  const ownedIn = (a: ArcadeListing): GameMeta[] => (a.machineIds ?? []).map((id) => mineById.get(id)).filter((g): g is GameMeta => !!g);
  const listMachines = (a: ArcadeListing): void => {
    if (!server) return;
    void server.resolve(a.id).catch(() => null).then((r) => {
      if (!r) { showToast(str('arcade.roompage.this_arcade_cannot_be_found')); return; }
      void openMachineList(r.doc, { onLanded: (games) => {
        for (const g of games) if (g.contentHash && !mineById.has(g.contentHash.slice(0, MACHINE_ID_LEN))) mineById.set(g.contentHash.slice(0, MACHINE_ID_LEN), g);
        draw();
      } });
    });
  };
  let community = firstList;
  const listed = new Set(rowLists.flatMap((c) => (c.kind === 'ok' ? c.arcades.map((a) => a.id) : [])));
  const viewOf = (id: string, viewAt: number | undefined): string | null => (server && viewAt ? server.viewUrl(id, viewAt) : null);
  const othersOf = (c: Community): ArcadeListing[] => (c.kind === 'ok'
    ? c.arcades.filter((a) => !mine.some((m) => m.id === a.id) && !elsewhere.some((m) => m.id === a.id)) : []);
  let others = othersOf(community);
  const anyOthers = rowLists.some((c) => othersOf(c).length);
  let showing: 'rows' | 'all' = 'rows';
  let sort: ArcadeSort = 'latest';
  let asked = 0;
  const sorts = tabBar<ArcadeSort>({
    label: str('arcade.landing.order'),
    value: sort,
    tabs: [
      { id: 'latest', label: str('arcade.landing.latest') },
      { id: 'top', label: str('arcade.landing.top_rated') },
      { id: 'visits', label: str('arcade.landing.most_visited') },
    ],
    onChange: (s) => {
      sort = s;
      const n = ++asked;
      void fetchList(s)
        .then((c) => {
          if (n !== asked) return;
          community = c;
          others = othersOf(c);
          draw();
        });
    },
  });
  sorts.el.classList.add('landing-sorts');

  const head = el('div', null, 'host-head');
  head.append(el('h1', count ? str('arcade.landing.your_arcade') : str('arcade.landing.arcades'), 'host-title'));
  const nodes: HTMLElement[] = [head, betaNotice({ label: str('arcade.guide.how_the_arcade_works'), run: () => { void import('./guide').then((m) => m.openGuide()); } })];
  let filter = '';
  const yours = el('section', null, 'landing-sec');
  const theirs = el('section', null, 'landing-sec');
  const draw = (): void => {
    const f = filter.toLocaleLowerCase();
    const match = (name: string): boolean => !f || name.toLocaleLowerCase().includes(f);
    if (drawn) { drawTheirs(match); return; }
    drawn = true;
    yours.replaceChildren();
    if (count) {
      const d = mine[0];
      yours.append(d
        ? hero(d.name, standing(d).length, listed.has(d.id),
          viewArt(viewOf(d.id, onServer.find((a) => a.id === d.id)?.viewAt), d.name, () => enter(d.id),
            () => { const m = firstThumb(d, thumbs); return artwork(m, d.name, () => enter(d.id)); }),
          d.id, server ? () => { void signedInThen(() => { void shareArcade(server, d); }); } : null,
          () => { void exportArcadeGames(d, library); },
          server ? shareHooks(server, d) : null, arcadeFigures(d, !!server), () => { void openMachineList(d); })
        : hero(elsewhere[0].name, elsewhere[0].machines, listed.has(elsewhere[0].id),
          viewArt(viewOf(elsewhere[0].id, elsewhere[0].viewAt), elsewhere[0].name, () => enter(elsewhere[0].id),
            () => artwork(null, elsewhere[0].name, () => enter(elsewhere[0].id))),
          elsewhere[0].id, () => { void offerLink(elsewhere[0].name, shareLink(elsewhere[0].id)); }, null, null, null,
          server ? () => listMachines(elsewhere[0]) : null));
      const rest = [
        ...mine.slice(1).map((m) => ownTile(m, thumbs, listed.has(m.id), viewOf(m.id, onServer.find((a) => a.id === m.id)?.viewAt))),
        ...elsewhere.slice(d ? 0 : 1).map((a) => elsewhereTile(a, listed.has(a.id), viewOf(a.id, a.viewAt), server ? () => listMachines(a) : null)),
      ];
      if (rest.length) yours.append(tileGrid(rest));
    } else if (community.kind !== 'ok' || !others.length) {
      yours.append(emptyState({
        message: str('arcade.landing.you_have_no_arcades_yet'),
        actions: [actionButton(str('arcade.landing.create_arcade'), 'primary', () => { void signedInThen(() => { void openCreate(); }); }, UI_ICONS.plus)],
      }));
    }
    drawTheirs(match);
  };
  let drawn = false;
  const search = searchBar({ placeholder: str('arcade.landing.search_arcades'), label: str('arcade.landing.search_arcades_2'), inline: true, onInput: (t) => { filter = t; draw(); } });
  search.wrap.classList.add('landing-search');
  const openAll = (s: ArcadeSort): void => {
    showing = 'all';
    sorts.set(s);
    sort = s;
    community = byRow.get(s) ?? community;
    others = othersOf(community);
    draw();
    theirs.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const drawTheirs = (match: (name: string) => boolean): void => {
    theirs.replaceChildren();
    if (community.kind === 'none') return;
    if (showing === 'rows' && community.kind === 'ok' && anyOthers) {
      for (const r of ROWS) {
        const c = byRow.get(r.sort);
        const items = c ? othersOf(c).filter((a) => r.sort !== 'top' || a.ratings > 0) : [];
        if (!items.length) continue;
        const row = el('section', null, 'landing-row');
        if (items.length > 4) row.classList.add('landing-row-more');
        row.append(rowHead(r.label(), str('arcade.landing.see_all'), () => openAll(r.sort)), tileStrip(items.map((a) => communityTile(a, viewOf(a.id, a.viewAt), ownedIn(a), server ? () => listMachines(a) : null, server?.base ?? null))));
        theirs.append(row);
      }
      return;
    }
    if (showing === 'all') {
      theirs.append(rowHead(str('arcade.landing.community_arcades'), str('arcade.landing.back'), () => {
        showing = 'rows';
        filter = '';
        search.input.value = '';
        draw();
      }));
      theirs.append(sorts.el, search.wrap);
    } else {
      theirs.append(sectionHeading(str('arcade.landing.community_arcades')));
    }
    if (community.kind === 'down') {
      theirs.append(emptyState({
        welcome: false,
        message: str('arcade.landing.the_arcades_list_cannot_be'),
        hint: count >= ARCADES_PER_PLAYER ? str('arcade.landing.try_again_in_a_moment') : str('arcade.landing.try_again_in_a_moment_2'),
        actions: [actionButton(str('arcade.landing.try_again'), 'secondary', () => location.reload())],
      }));
      return;
    }
    const shown = others.filter((a) => match(a.name));
    if (!others.length) {
      theirs.append(emptyState({
        welcome: false,
        message: str('arcade.landing.no_community_arcades_yet'),
        hint: count >= ARCADES_PER_PLAYER
          ? str('arcade.landing.turn_on_public_in_your')
          : str('arcade.landing.make_yours_with_then_turn'),
      }));
    } else if (!shown.length) {
      theirs.append(emptyState({ welcome: false, message: str('arcade.landing.no_arcade_matches_n', { 0: filter }) }));
    } else {
      theirs.append(tileGrid(shown.map((a) => communityTile(a, viewOf(a.id, a.viewAt), ownedIn(a), server ? () => listMachines(a) : null, server?.base ?? null))));
    }
  };
  nodes.push(yours);
  draw();
  nodes.push(theirs);
  root.replaceChildren(...nodes);
  document.getElementById('loading')?.classList.add('done');
}

function rowHead(title: string, action: string, run: () => void): HTMLElement {
  const head = el('div', null, 'landing-rowhead');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'landing-seeall';
  b.textContent = action;
  b.addEventListener('click', run);
  head.append(sectionHeading(title), b);
  return head;
}

async function signedInThen(then: () => void): Promise<void> {
  if (await needLogin()) then();
}

function enter(id: string): void {
  void signedInThen(() => { location.href = shareLink(id); });
}

function firstThumb(d: ArcadeDoc, thumbs: Map<string, string>): string | null {
  const m = standing(d).find((x) => thumbs.has(x.contentHash)) ?? d.machines.find((x) => thumbs.has(x.contentHash));
  return m ? thumbs.get(m.contentHash)! : null;
}

function hero(
  name: string, machines: number, isPublic: boolean, art: HTMLElement, id: string,
  share: (() => void) | null, exportGames: (() => void) | null, visibility: ShareHooks | null,
  figures: Promise<ArcadeFigures> | null, listMachines: (() => void) | null,
): HTMLElement {
  const box = el('article', null, 'landing-hero');
  box.setAttribute('aria-label', name || str('arcade.landing.your_arcade'));
  const body = el('div', null, 'landing-hero-body');
  const head = el('div', null, 'landing-hero-head');
  head.append(el('h2', name || str('arcade.landing.no_name'), 'landing-hero-name'));
  const chips = el('div', null, 'chips');
  chips.append(machinesChip(machines, listMachines));
  const stateName = (on: boolean): string => (on ? str('arcade.landing.public') : str('arcade.landing.private'));
  if (visibility) {
    const sw = publicSwitch(visibility, undefined, stateName);
    sw.row.classList.add('landing-hero-vis');
    sw.note.className = 'landing-hero-line';
    const vis = el('div', null, 'landing-hero-vis-block');
    vis.append(sw.row, sw.note);
    head.append(vis);
  } else {
    chips.append(chip(stateName(isPublic)));
  }
  const acts = el('div', null, 'landing-hero-actions');
  const go = actionButton(str('arcade.landing.enter'), 'primary', () => {
    if (machines) enter(id);
    else void signedInThen(() => { void setCurrentArcade(id).catch(() => undefined).then(() => { location.href = floorLink(id); }); });
  });
  acts.append(go);
  if (share) acts.append(actionButton(str('arcade.landing.share'), 'secondary', share, UI_ICONS.share));
  if (exportGames) acts.append(actionButton(str('arcade.landing.export_games'), 'secondary', exportGames, MENU_ICONS.download));
  body.append(head, chips, acts);
  if (figures) {
    const strip = el('dl', null, 'landing-hero-stats');
    body.insertBefore(strip, acts);
    void figures.then((f) => { strip.replaceChildren(...figureCells(f)); }).catch(() => undefined);
  }
  box.append(art, body);
  return box;
}

function figureCells(f: ArcadeFigures): HTMLElement[] {
  const cell = (label: string, value: string, tone?: 'up' | 'down'): HTMLElement => {
    const c = el('div', null, 'landing-stat');
    if (tone) c.classList.add(tone);
    c.append(el('dt', label, 'landing-stat-label'), el('dd', value, 'landing-stat-value'));
    return c;
  };
  const cells: HTMLElement[] = [];
  if (f.money) {
    const profit = f.money.inPence - f.money.outPence;
    cells.push(
      cell(str('arcade.host.money_in'), pounds(f.money.inPence)),
      cell(str('arcade.host.money_out'), pounds(f.money.outPence)),
      cell(str('arcade.landing.profit'), `${profit > 0 ? '+' : ''}${pounds(profit)}`, profit < 0 ? 'down' : 'up'),
    );
  }
  cells.push(cell(str('arcade.landing.plays'), String(f.plays)));
  if (f.machines) cells.push(cell(str('arcade.landing.per_machine'), String(Math.round(f.plays / f.machines))));
  return cells;
}

function ownTile(d: ArcadeDoc, thumbs: Map<string, string>, isPublic: boolean, view: string | null): HTMLElement {
  const open = (): void => {
    void signedInThen(() => { void setCurrentArcade(d.id).then(() => { location.href = HOST_PAGE; }); });
  };
  const art = viewArt(view, d.name, open, () => artwork(firstThumb(d, thumbs), d.name, open));
  const chips = [machinesChip(standing(d).length, () => { void openMachineList(d); })];
  if (isPublic) chips.push(chip(str('arcade.landing.public')));
  const t = tileCard({ label: d.name || str('arcade.landing.your_arcade'), art, title: d.name || str('arcade.landing.no_name'), titleTip: d.name, chips });
  t.classList.add('landing-tile');
  t.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === t) open(); });
  return t;
}

function elsewhereTile(a: ArcadeListing, isPublic: boolean, view: string | null, listMachines: (() => void) | null): HTMLElement {
  const enter = (): void => { void signedInThen(() => { location.href = shareLink(a.id); }); };
  const art = viewArt(view, a.name, enter, () => artwork(null, a.name, enter));
  const chips = [machinesChip(a.machines, listMachines)];
  if (isPublic) chips.push(chip(str('arcade.landing.public')));
  const t = tileCard({ label: a.name || str('arcade.landing.your_arcade'), art, title: a.name || str('arcade.landing.no_name'), titleTip: a.name, chips });
  t.classList.add('landing-tile');
  t.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === t) enter(); });
  return t;
}

export async function mayCreate(): Promise<boolean> {
  const [mine, onServer] = await Promise.all([listArcades().catch(() => [] as ArcadeDoc[]), serverArcades().catch(() => [] as ArcadeListing[])]);
  const ids = new Set([...mine.map((d) => d.id), ...onServer.map((a) => a.id)]);
  return ids.size < ARCADES_PER_PLAYER;
}

function viewArt(url: string | null, alt: string, onTap: () => void, fallback: () => HTMLElement): HTMLElement {
  if (!url) return fallback();
  const frame = document.createElement('div');
  frame.className = 'art';
  frame.addEventListener('click', onTap);
  const img = document.createElement('img');
  img.className = 'art-img landing-view';
  img.alt = alt;
  img.draggable = false;
  img.decoding = 'async';
  img.loading = 'lazy';
  img.addEventListener('load', () => img.classList.add('in'));
  img.addEventListener('error', () => {
    const f = fallback();
    f.append(...frame.querySelectorAll('.on-art'));
    frame.replaceWith(f);
  });
  img.src = url;
  frame.append(img);
  return frame;
}

function ownerLine(a: ArcadeListing, serverBase: string | null): HTMLElement | null {
  const o = a.owner;
  if (!o) return null;
  const line = el('div', null, 'card-byline');
  line.append(avatarFace(o.name, serverBase ? avatarUrl(serverBase, o) : null, 18), el('span', o.name));
  return line;
}

function communityTile(a: ArcadeListing, view: string | null, owned: GameMeta[], listMachines: (() => void) | null, serverBase: string | null): HTMLElement {
  const enter = (): void => { void signedInThen(() => { location.href = shareLink(a.id); }); };
  const thumbed = owned.filter((g) => g.hasThumb).map((g) => g.hash);
  const nameOf = (h: string): string => owned.find((g) => g.hash === h)?.name ?? '';
  const art = viewArt(view, a.name, enter, () => thumbMosaic(thumbed, a.name, enter));
  if (view) {
    const stack = thumbStack(thumbed, nameOf);
    if (stack) art.append(stack);
  }
  const count = owned.length
    ? str('arcade.landing.playable_n_n', { 0: owned.length, 1: a.machines })
    : str('arcade.landing.n_machines', { n: a.machines });
  const machines = listMachines ? chipButton(count, str('arcade.machinelist.machines_in_this_arcade'), listMachines) : chip(count);
  if (owned.length) machines.classList.add('landing-own');
  const chips: HTMLElement[] = [machines];
  const stars = ratingChip(a.rating, a.ratings, { count: false });
  if (stars) chips.push(stars);
  const t = tileCard({ label: a.name, art, title: a.name, titleTip: a.name, titleOnArt: true, chips, flag: ownerLine(a, serverBase) });
  t.classList.add('landing-tile');
  t.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === t) enter(); });
  return t;
}

export async function openCreate(): Promise<void> {
  if (!(await mayCreate())) {
    showToast(HAVE_ONE);
    document.querySelector('.landing-plus')?.setAttribute('hidden', '');
    return;
  }
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'host-set-field';
  field.maxLength = ARCADE_NAME_MAX;
  field.setAttribute('aria-label', str('arcade.landing.arcade_name'));
  field.autocomplete = 'off';
  field.spellcheck = false;
  const row = document.createElement('label');
  row.className = 'menu-row host-set-name';
  row.append(field);
  const nameCard = card();
  nameCard.append(row);
  const create = actionButton(str('arcade.landing.create'), 'primary', () => { void go(); });
  const acts = el('div', null, 'landing-create-actions');
  acts.append(create);
  const err = el('div', '', 'host-set-note name-error');
  err.setAttribute('role', 'alert');
  err.hidden = true;
  const say = (t: string): void => { err.textContent = t; err.hidden = !t; field.setAttribute('aria-invalid', t ? 'true' : 'false'); };
  const wrap = el('div', null, 'host-settings landing-create');
  wrap.append(caption(str('arcade.landing.name')), nameCard, err, betaNotice(), acts);
  const sync = (): void => { create.disabled = !cleanName(field.value); };
  let busy = false;
  const go = async (): Promise<void> => {
    const n = cleanName(field.value);
    if (!n || busy) { field.focus(); return; }
    busy = true;
    create.disabled = true;
    const refuse = (t: string): void => { say(t); busy = false; sync(); field.focus(); };
    if (!(await mayCreate())) { refuse(HAVE_ONE); return; }
    const d = newArcade(n);
    const server = await arcadeServer();
    if (server) {
      d.hostKey = newHostKey();
      const r = await server.publish(d).catch(() => null);
      if (!r?.ok) { refuse(publishRefusal(r)); return; }
    } else if (await nameTakenHere(n)) {
      refuse(NAME_TAKEN);
      return;
    }
    await putArcade(d);
    await setCurrentArcade(d.id);
    location.href = HOST_PAGE;
  };
  field.addEventListener('input', () => { say(''); sync(); });
  field.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void go(); } });
  sync();
  openDialog({ title: str('arcade.landing.create_arcade'), body: [wrap], frost: true });
  field.focus();
}
