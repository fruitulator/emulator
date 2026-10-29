import { loadingLine } from '../web/ui/progress';
import { avatarUrl } from './account';
import { machineTitle } from './machinelist';
import type { LeaderRow, LeadersReply } from './serverwire';
import type { ArcadeServer } from './share';
import { agoText } from '../web/gamelist';
import { pounds } from '../web/moneytext';
import { avatarFace } from '../web/ui/avatar';
import { nebulaOpenSpot } from '../web/ui/nebula-avatar.js';
import { escapeCloses, sheetLine, showSheet } from '../web/ui/sheet';
import { tabBar } from '../web/ui/tabs';
import { str } from '../web/i18n';

type Table = 'wins' | 'sessions' | 'regulars';
type Scope = 'machine' | 'arcade';

export interface LeaderboardSource {
  base: string;
  load: (machine?: string) => Promise<LeadersReply>;
  where: (row: LeaderRow) => string;
}

export function arcadeLeaders(api: ArcadeServer, arcadeId: string, own: boolean): LeaderboardSource {
  if (!own) return { base: api.base, load: (m) => api.leaders(arcadeId, m), where: () => '' };
  const names = new Map<string, string>();
  const room = api.resolve(arcadeId).then((r) => {
    for (const m of r?.doc.machines ?? []) names.set(m.id, machineTitle(m.name, null));
  }, () => undefined);
  return {
    base: api.base,
    load: async (m) => (await Promise.all([api.leaders(arcadeId, m), room]))[0],
    where: (r) => names.get(r.machine) ?? '',
  };
}

export function siteLeaders(api: ArcadeServer): LeaderboardSource {
  return { base: api.base, load: () => api.siteLeaders(), where: (r) => r.arcadeName ?? '' };
}

function emptyText(_t: Table): string {
  return str('arcade.leaderboard.no_data');
}

export function playedFor(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? str('arcade.leaderboard.n_min', { 0: m }) : str('arcade.leaderboard.n_h_m', { 0: Math.floor(m / 60), 1: m % 60 });
}

function lineOf(t: Table, r: LeaderRow, place: (row: LeaderRow) => string): { figure: string; sub: string } {
  const where = place(r);
  const parts = t === 'regulars'
    ? [str('arcade.leaderboard.n_visits', { n: r.sittings }), where]
    : [where, agoText(r.at)];
  return {
    figure: t === 'regulars' ? playedFor(r.value) : pounds(r.value),
    sub: parts.filter(Boolean).join(' · '),
  };
}

export function tableLines(t: Table, reply: LeadersReply, base: string, place: (row: LeaderRow) => string): HTMLElement[] {
  const rows = reply[t];
  if (!rows.length) return [sheetLine(emptyText(t), '', { quiet: true })];
  return rows.map((r, i) => {
    const { figure, sub } = lineOf(t, r, place);
    const line = sheetLine(`${i + 1}. ${r.name}`, sub, { icon: avatarFace(r.name, avatarUrl(base, { id: r.id, name: r.name, avatarAt: r.avatarAt }), 32) });
    const fig = document.createElement('span');
    fig.className = 'sheet-figure';
    fig.textContent = figure;
    line.append(fig);
    return line;
  });
}

export function leaderPanel(src: LeaderboardSource, o: { machine?: string; top?: number } = {}): { head: HTMLElement[]; list: HTMLElement } {
  const { machine, top } = o;
  let table: Table = 'wins';
  let scope: Scope = machine ? 'machine' : 'arcade';
  const got = new Map<Scope, LeadersReply | null>();
  const list = document.createElement('div');
  list.className = 'leader-list';

  const draw = (): void => {
    if (!got.has(scope)) {
      list.replaceChildren(loadingLine(str('arcade.leaderboard.loading')));
      const asked = scope;
      void src.load(asked === 'machine' ? machine : undefined).then(
        (r) => (r.ok ? r : null),
        (e) => { console.warn('[arcade] the leaderboards were not read', e); return null; },
      ).then((r) => {
        got.set(asked, r);
        if (scope === asked) draw();
      });
      return;
    }
    const r = got.get(scope);
    const shown = r && top ? { ...r, wins: r.wins.slice(0, top), sessions: r.sessions.slice(0, top), regulars: r.regulars.slice(0, top) } : r;
    list.replaceChildren(...(shown
      ? tableLines(table, shown, src.base, scope === 'machine' ? () => '' : src.where)
      : [sheetLine(str('arcade.leaderboard.could_not_load'), '', { quiet: true })]));
  };

  const tables = tabBar<Table>({
    label: str('arcade.leaderboard.leaderboards'),
    tabs: [
      { id: 'wins', label: str('arcade.leaderboard.biggest_win') },
      { id: 'sessions', label: str('arcade.leaderboard.best_session') },
      { id: 'regulars', label: str('arcade.leaderboard.regulars') },
    ],
    value: table,
    onChange: (id) => { table = id; draw(); },
  });
  const head: HTMLElement[] = [tables.el];
  if (machine) {
    const scopes = tabBar<Scope>({
      label: str('arcade.leaderboard.which_tables'),
      tabs: [
        { id: 'machine', label: str('arcade.leaderboard.this_machine') },
        { id: 'arcade', label: str('arcade.leaderboard.whole_arcade') },
      ],
      value: scope,
      onChange: (id) => { scope = id; draw(); },
    });
    head.push(scopes.el);
  }
  for (const h of head) h.classList.add('sheet-tabs');
  draw();
  return { head, list };
}

export function openLeaderboards(src: LeaderboardSource, returnTo: HTMLElement, machine?: string, title?: string): void {
  const { head, list } = leaderPanel(src, { machine });
  showSheet(title || str('arcade.leaderboard.leaderboards'), [...head, list], returnTo);
  escapeCloses();
}

const BOARD: { table: Table; label: () => string; wash: string }[] = [
  { table: 'wins', label: () => str('arcade.leaderboard.biggest_win'), wash: '' },
  { table: 'sessions', label: () => str('arcade.leaderboard.best_session'), wash: 'nb-lb--teal' },
  { table: 'regulars', label: () => str('arcade.leaderboard.regulars'), wash: 'nb-lb--gold' },
];

export interface BoardOptions { top?: number; mini?: boolean }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function leaderBoard(src: LeaderboardSource, o: BoardOptions = {}): HTMLElement {
  const { top = 5, mini = false } = o;
  const board = el('div', mini ? 'lb-board lb-mini' : 'lb-board');
  const boards = BOARD.map((b) => {
    const box = mini ? el('section', 'nb-mini') : el('section', `nb-lb nb-stars ${b.wash}`.trim());
    const head = mini ? el('h3', 'nb-stat__label lb-mini-head', b.label()) : el('div', 'nb-lb__head');
    if (!mini) head.append(el('h3', '', b.label()));
    box.append(head);
    board.append(box);
    return { b, box, head };
  });
  const fill = (r: LeadersReply | null): void => {
    for (const { b, box, head } of boards) {
      const rows = r ? r[b.table].slice(0, top) : [];
      box.replaceChildren(head);
      if (mini) {
        if (!r) box.append(el('p', 'nb-meta lb-mini-quiet', str('arcade.leaderboard.could_not_load')));
        else if (!rows.length) box.append(el('p', 'nb-meta lb-mini-quiet', str('arcade.leaderboard.no_data')));
        else box.append(...rows.map((row, i) => miniRow(b.table, row, i, src)));
        continue;
      }
      const podium = el('ol', 'nb-lb__podium');
      for (let i = 0; i < 3; i++) podium.append(place(b.table, rows[i] ?? null, i, src));
      box.append(podium);
      if (rows.length > 3) {
        const rest = el('ol', 'nb-lb__rest');
        rest.append(...rows.slice(3).map((row, i) => restRow(b.table, row, i + 3, src)));
        box.append(rest);
      }
      if (r && !rows.length) {
        const empty = el('div', 'nb-lb__empty');
        empty.append(el('p', '', str('arcade.leaderboard.no_data')));
        box.append(empty);
      } else if (!r) {
        const empty = el('div', 'nb-lb__empty');
        empty.append(el('p', '', str('arcade.leaderboard.could_not_load')));
        box.append(empty);
      }
    }
  };
  if (!mini) {
    for (const { box } of boards) {
      const podium = el('ol', 'nb-lb__podium');
      for (let i = 0; i < 3; i++) podium.append(place('wins', null, i, src));
      box.append(podium);
    }
  }
  void src.load().then((r) => (r.ok ? r : null), (e) => { console.warn('[arcade] the leaderboards were not read', e); return null; }).then(fill);
  return board;
}

function face(r: LeaderRow, src: LeaderboardSource, size: number): HTMLElement {
  return avatarFace(r.name, avatarUrl(src.base, { id: r.id, name: r.name, avatarAt: r.avatarAt }), size);
}

let coinIds = 0;
function coin(): SVGSVGElement {
  const id = `nb-coin-${++coinIds}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'nb-lb__coin');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<defs><radialGradient id="${id}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff3b0"/><stop offset=".55" stop-color="#ffc21a"/><stop offset="1" stop-color="#c47a00"/></radialGradient></defs>`
    + `<circle cx="20" cy="20" r="18" fill="url(#${id})" stroke="#a86400" stroke-width="1.5"/>`
    + '<circle cx="20" cy="20" r="13" fill="none" stroke="#fff0a0" stroke-opacity=".6" stroke-width="1.2"/>'
    + '<path d="M20 11l2.6 6 6.4.4-5 4 1.7 6.2-5.7-3.4-5.7 3.4 1.7-6.2-5-4 6.4-.4z" fill="#fff6d0"/>';
  return svg;
}

function place(t: Table, r: LeaderRow | null, i: number, src: LeaderboardSource): HTMLElement {
  const n = i + 1;
  const li = el('li', `nb-lb__place nb-lb__place--${n}${r ? '' : ' nb-lb__place--open'}`);
  const ring = el('span', `nb-ring nb-ring--${n}`);
  if (r) {
    ring.append(face(r, src, n === 1 ? 80 : 64));
  } else {
    ring.append(nebulaOpenSpot(n === 1 ? 80 : 64));
  }
  const pillar = el('div', 'nb-lb__pillar');
  const ord = el('span', 'nb-lb__ord', String(n));
  pillar.append(coin(), ord, el('span', 'nb-lb__value', r ? lineOf(t, r, () => '').figure : '\u2014'));
  li.append(ring, el('span', 'nb-lb__name', r ? r.name : '\u00a0'), pillar);
  return li;
}

function restRow(t: Table, r: LeaderRow, i: number, src: LeaderboardSource): HTMLElement {
  const li = el('li', 'nb-row');
  const { figure, sub } = lineOf(t, r, src.where);
  const main = el('span', 'nb-row__main');
  main.append(el('span', 'nb-row__name', r.name), el('span', 'nb-row__sub', sub));
  li.append(el('span', 'nb-row__rank', String(i + 1)), face(r, src, 34), main, el('span', 'nb-row__value', figure));
  return li;
}

function miniRow(t: Table, r: LeaderRow, i: number, src: LeaderboardSource): HTMLElement {
  const row = el('div', 'nb-row');
  const { figure, sub } = lineOf(t, r, src.where);
  const main = el('span', 'nb-row__main');
  main.append(el('span', 'nb-row__name', r.name), el('span', 'nb-row__sub', sub));
  row.append(
    el('span', `nb-medal nb-medal--${i + 1}`, String(i + 1)), face(r, src, 32), main,
    el('span', `nb-row__value${i === 0 ? ' nb-money' : ''}`, figure),
  );
  return row;
}
