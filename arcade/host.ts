import { listGames, CONTENT_RULE, type GameMeta } from '../web/store';
import { MENU_ICONS, UI_ICONS, rowIcon } from '../web/ui/icons';
import { caption, card, menuRow, statRow } from '../web/ui/rows';
import type { DecorateSection } from './decorate';
import { artwork } from '../web/ui/art';
import { chip, emptyState, pillButton } from '../web/ui/list';
import { mountGameList } from '../web/gamelist';
import { unplayableReason } from '../web/libimport';
import { openDialog } from '../web/ui/dialog';
import { closeSheet, confirmInSheet, sheetRow, showSheet } from '../web/ui/sheet';
import { enhanceSelect } from '../web/ui/dropdown';
import { statusIcon, statusRow } from '../web/ui/status';
import { entriesFromDrop, filesFromDrop } from '../web/ingest';
import { uploadToLibrary, type UploadProblem, type UploadResult } from './upload';
import {
  ARCADE_MAX_MACHINES, FLOOR_CENTRE, FLOOR_COLS, FLOOR_GEOM, FLOOR_ROWS, FLOOR_STEP, addMachine, addProp, cannotAdd, duplicateMachine, fits, moveMachine, moveProp,
  faceProp, propFits, propSize, propStand, removeMachine, removeProp, snapProp, turnMachine, turnOf, turnProp, type ArcadeDoc, type DocMachine, type Place, type Turn,
} from './doc';
import { cellCentre, doorway } from './floor';
import { posterArt, POSTER_FRAME, POSTER_H, POSTERS, PROP_KINDS, propKind, PROPS_MAX, type PosterArt, type Prop, type PropKind } from './proplist';
import { moneyTrust, NO_BOOKKEEPING } from './moneygate';
import { deleteArcade, listArcades, putArcade, setCurrentArcade, currentArcade } from './docstore';
import { arcadeSettingsParts, openArcadeSettings, type SettingsHooks, type SettingsParts } from './hostsettings';
import { ArcadeServer, arcadeServer, NAME_TAKEN, nameTakenHere, newHostKey, publishRefusal, shareHooks, syncArcade, floorLink } from './share';
import { showToast } from '../web/ui/toast';
import { invalidateRec } from './cache';
import { lostCreditText, serverMoney, statsMoney, type StatsMoney } from './moneyrecord';
import { serverFlag } from './remote';
import { mountAvatar } from './avatar';
import { str } from '../web/i18n';
import { moneyInText, moneyOutText } from '../web/moneytext';
import { siteNav } from '../web/ui/sitenav';
import { betaBrand } from '../web/ui/beta';

let dockBody: HTMLElement | null = null;
let onPlaced: ((places: Map<string, Place>) => void) | null = null;
let onProps: ((props: Prop[]) => void) | null = null;
let onChanged: (() => Promise<boolean>) | null = null;
let onDialog: ((open: boolean) => void) | null = null;
let dockRoot: HTMLElement | null = null;
let tappedCell: Place | null = null;

let decorateMaker: ((panel: { show(nodes: Node[], slide?: 'in' | 'out' | 'none'): void; back(): void }) => DecorateSection) | null = null;
let decorating: DecorateSection | null = null;
let dockShow: ((nodes: Node[], slide?: 'in' | 'out' | 'none') => void) | null = null;

const root = (): HTMLElement => dockBody ?? (document.getElementById('host') as HTMLElement);

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, text?: string | null, attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function button(text: string, onClick: () => void | Promise<void>, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = pillButton(text, () => { void onClick(); });
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  return b;
}

export function iconButton(icon: string, label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'iconbtn';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.append(rowIcon(icon, 'row-icon', 18).firstElementChild!);
  b.addEventListener('click', () => { void onClick(); });
  return b;
}

export function exitButton(onExit: () => void): HTMLButtonElement {
  const b = iconButton(UI_ICONS.cross, str('arcade.host.exit'), onExit);
  b.classList.add('wz-exit');
  b.setAttribute('aria-label', str('arcade.host.exit_to_the_arcade'));
  return b;
}

let doc: ArcadeDoc | null = null;

function say(text: string): void {
  showToast(text);
}

const go = (q: string): void => {
  if (!dockBody) { location.href = `/arcade/?host${q}`; return; }
  const p = new URLSearchParams(q.replace(/^&/, ''));
  if (!q) void leaveDialog();
  else if (p.has('add')) {
    const col = Number(p.get('col'));
    const row = Number(p.get('row'));
    tappedCell = p.has('col') && p.has('row') && Number.isInteger(col) && Number.isInteger(row) ? { col, row } : null;
    void openPickerOver();
  } else if (p.get('install') || p.get('edit')) {
    void openWizardOver((p.get('install') ?? p.get('edit'))!, p.has('edit') ? 'edit' : 'add');
  }
};

export async function openHost(): Promise<void> {
  for (const id of ['room', 'bar', 'stats']) document.getElementById(id)?.setAttribute('hidden', '');
  document.body.classList.add('hosting');
  const top = el('div', null, { class: 'host-top' });
  const home = document.getElementById('home');
  if (home) top.append(betaBrand(home));
  const right = el('div', null, { class: 'host-top-right' });
  right.append(siteNav({ here: 'arcades', about: true }));
  top.append(right);
  void mountAvatar(right);
  root().before(top);
  root().hidden = false;
  const q = new URLSearchParams(location.search);
  const install = q.get('install');
  const edit = q.get('edit');
  const picking = q.has('add') && !q.has('start');
  const dlg = install || edit || picking ? dialogFrame(picking ? 'host-picker' : '') : null;
  doc = await currentArcade();
  if (dlg && !doc) closeDialog();
  if ((install || edit) && doc) {
    await render();
    top.inert = true;
    const back = (): void => go('');
    await (await import('./wizard')).openWizard(dlg!, doc, (install ?? edit)!, edit ? 'edit' : 'add', back);
    return;
  }
  if (q.has('start') || !doc) {
    location.replace('/arcade/');
    return;
  }
  if (picking) {
    await render();
    top.inert = true;
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented || ev.repeat) return;
      ev.preventDefault();
      go('');
    });
    await renderPicker(doc);
    return;
  }
  void syncArcade(doc);
  location.replace(floorLink(doc.id));
}

export async function openFloorDock(o: {
  doc: ArcadeDoc; placed?: (places: Map<string, Place>) => void; props?: (props: Prop[]) => void;
  changed?: () => Promise<boolean>; dialog?: (open: boolean) => void; onClose?: () => void;
  decorate?: typeof decorateMaker;
}): Promise<void> {
  const { openDock } = await import('../web/ui/dock');
  doc = o.doc;
  onPlaced = o.placed ?? null;
  onProps = o.props ?? null;
  onChanged = o.changed ?? null;
  onDialog = o.dialog ?? null;
  decorateMaker = o.decorate ?? null;
  decorating = null;
  const body = el('div', null, { class: 'floor-dock host-settings' });
  dockBody = body;
  const dock = openDock({
    title: str('arcade.landing.your_arcade'),
    body: [body],
    onEscape: () => {
      if (frame) {
        if (!document.querySelector('.ui-alert, .ui-dialog')) frame.querySelector<HTMLElement>('.wz-exit')?.click();
        return true;
      }
      if (!decorating) return false;
      if (!decorating.escape()) { decorating = null; dock.show([body], 'out'); }
      return true;
    },
    onClose: () => {
      decorating?.leave();
      decorating = null;
      dockShow = null;
      void dockSettings?.keepName().then((why) => { if (why) showToast(why); });
      if (frame) closeDialog();
      if (dockBody === body) { dockRoot = null; dockBody = null; onPlaced = null; onProps = null; onChanged = null; dockSettings = null; }
      o.onClose?.();
    },
  });
  dock.root.classList.add('ui-dock-wide');
  dockRoot = dock.root;
  dockShow = (nodes, slide) => dock.show(nodes, slide);
  await render();
}

let scrim: HTMLElement | null = null;
let frame: HTMLElement | null = null;

function dialogFrame(cls: string): HTMLElement {
  if (dockBody && !overlay) {
    overlay = document.getElementById('host');
    if (overlay) {
      overlay.hidden = false;
      overlay.classList.add('host-over');
    }
    if (dockRoot) dockRoot.inert = true;
    onDialog?.(true);
  }
  const r = overlay ?? root();
  if (!scrim) {
    scrim = el('div', null, { class: 'ui-dialog-backdrop ui-dialog-frost' });
    r.append(scrim);
    document.body.classList.add('host-dialog');
  }
  const f = el('div', null, { class: `host-dlg ${cls}`.trim() });
  if (frame) frame.replaceWith(f); else r.append(f);
  frame = f;
  return f;
}

let overlay: HTMLElement | null = null;

function closeDialog(): void {
  if (overlay) {
    overlay.hidden = true;
    overlay.classList.remove('host-over');
    overlay = null;
    if (dockRoot) dockRoot.inert = false;
    onDialog?.(false);
  }
  scrim?.remove();
  frame?.remove();
  scrim = frame = null;
  document.body.classList.remove('host-dialog');
}

async function openPickerOver(): Promise<void> {
  if (!doc) return;
  await renderPicker(doc);
}

async function openWizardOver(id: string, mode: 'add' | 'edit'): Promise<void> {
  if (!doc) return;
  const dlg = dialogFrame('');
  await (await import('./wizard')).openWizard(dlg, doc, id, mode, () => go(''));
}

async function leaveDialog(): Promise<void> {
  closeDialog();
  await refreshIn();
}

async function saveDoc(): Promise<void> {
  if (!doc) return;
  await putArcade(doc);
  void syncArcade(doc);
}

export async function render(): Promise<void> {
  const r = root();
  const d = doc!;
  if (dockBody) { await renderDock(r, d); return; }
  const head = el('div', null, { class: 'host-head' });
  const acts = el('div', null, { class: 'host-actions' });
  const view = button(str('arcade.host.view_arcade'), () => { location.href = `/arcade/?arcade=${d.id}`; });
  if (!d.machines.some((m) => m.status === 'installed')) view.disabled = true;
  acts.append(view, settingsButton(d));
  head.append(nameHeading(d), acts);
  const nodes: HTMLElement[] = [head];

  if (!d.machines.length) {
    nodes.push(emptyState({
      welcome: false,
      message: str('arcade.host.you_have_no_machines_installed'),
      actions: [button(str('arcade.host.add_your_first_machine'), () => addAt(null))],
    }));
  } else {
    const row = el('div', null, { class: 'host-actions' });
    row.append(el('p', str('arcade.host.n_of_n_machines', { 0: d.machines.length, 1: ARCADE_MAX_MACHINES }), { class: 'host-count readout' }));
    nodes.push(row);
  }
  if (d.machines.length) {
    const library = await listGames().catch(() => [] as GameMeta[]);
    const byContent = new Map<string, GameMeta>();
    for (const g of library) byContent.set(g.contentHash ?? g.hash, g);
    nodes.push(floorplan(d, byContent));
  }
  if (scrim) for (const n of nodes) n.inert = true;
  r.replaceChildren(...nodes, ...(scrim && frame ? [scrim, frame] : []));
}

async function renderDock(r: HTMLElement, d: ArcadeDoc): Promise<void> {
  dockSettings = arcadeSettingsParts(settingsHooks(d, await arcadeServer()));
  const acts = el('div', null, { class: 'host-actions floor-dock-actions' });
  if (d.machines.length) {
    acts.append(el('span', str('arcade.host.n_of_n_machines', { 0: d.machines.length, 1: ARCADE_MAX_MACHINES }), { class: 'host-count readout' }));
  } else {
    acts.append(el('span', str('arcade.host.you_have_no_machines_installed'), { class: 'host-note' }), button(str('arcade.host.add_machine'), () => addAt(null)));
  }
  const nodes: Node[] = [...dockSettings.top];
  const make = decorateMaker;
  const show = dockShow;
  if (make && show) {
    const deco = card();
    deco.append(menuRow(str('arcade.decorate.title'), UI_ICONS.edit, () => {
      decorating = make({ show, back: () => { decorating = null; show([r], 'out'); } });
      decorating.open('in');
    }, true));
    nodes.push(caption(str('arcade.host.room')), deco);
  }
  nodes.push(caption(str('arcade.host.machines')), acts);
  if (d.machines.length) {
    const library = await listGames().catch(() => [] as GameMeta[]);
    const byContent = new Map<string, GameMeta>();
    for (const g of library) byContent.set(g.contentHash ?? g.hash, g);
    nodes.push(floorplan(d, byContent));
  }
  nodes.push(...dockSettings.danger);
  r.replaceChildren(...nodes);
}

let dockSettings: SettingsParts | null = null;

async function refresh(): Promise<void> {
  if (dockBody) { location.replace(floorLink(doc!.id)); return; }
  await render();
}

async function refreshIn(): Promise<void> {
  if (dockBody && onChanged && await onChanged()) { await render(); return; }
  await refresh();
}

function nameHeading(d: ArcadeDoc): HTMLElement {
  const h = el('h1', null, { class: 'host-title host-name' });
  h.append(el('span', d.name || str('arcade.host.no_name'), { class: 'host-name-text' }));
  return h;
}

function settingsButton(d: ArcadeDoc): HTMLButtonElement {
  const b = iconButton(UI_ICONS.tool, str('arcade.host.arcade_settings'), async () => {
    openArcadeSettings(settingsHooks(d, await arcadeServer()));
  });
  b.classList.add('host-tool');
  return b;
}

function settingsHooks(d: ArcadeDoc, server: ArcadeServer | null): SettingsHooks {
  return {
      doc: d,
      save: saveDoc,
      share: server ? shareHooks(server, d) : null,
      renamed: () => {
        root().querySelector('.host-name')?.replaceWith(nameHeading(d));
        say(str('arcade.host.saved'));
      },
      claimName: async (n) => {
        if (!server) return (await nameTakenHere(n, d.id)) ? NAME_TAKEN : null;
        const was = { name: d.name, key: d.hostKey };
        if (!d.hostKey) d.hostKey = newHostKey();
        d.name = n;
        const r = await server.publish(d).catch(() => null);
        d.name = was.name;
        if (r?.ok) return null;
        if (!was.key) d.hostKey = undefined;
        return publishRefusal(r);
      },
      remove: async () => {
        if (d.hostKey && server) {
          const r = await server.remove(d).catch(() => null);
          if (!r?.ok) {
            showToast(str('arcade.host.the_arcade_could_not_be'));
            return;
          }
        }
        await deleteArcade(d.id);
        const next = (await listArcades())[0] ?? null;
        if (next) await setCurrentArcade(next.id);
        go('');
      },
  };
}

const addAt = (p: Place | null): void => go(p ? `&add&col=${p.col}&row=${p.row}` : '&add');

const GEOM = FLOOR_GEOM;

function pointOn(grid: HTMLElement, x: number, y: number): { col: number; row: number } | null {
  const r = grid.getBoundingClientRect();
  const col = ((x - r.left) / r.width) * FLOOR_COLS;
  const row = ((y - r.top) / r.height) * FLOOR_ROWS;
  return col >= 0 && col < FLOOR_COLS && row >= 0 && row < FLOOR_ROWS ? { col, row } : null;
}

function placeUnder(at: { col: number; row: number }, turn?: Turn): Place {
  const col = Math.max(0, Math.min(FLOOR_COLS - FLOOR_STEP, Math.round(at.col - FLOOR_STEP / 2)));
  const row = Math.max(0, Math.min(FLOOR_ROWS - FLOOR_STEP, Math.round(at.row - FLOOR_STEP / 2)));
  return turn ? { col, row, turn } : { col, row };
}

function propPlaceUnder(at: { col: number; row: number }, p: Prop): { x: number; z: number } {
  const c = cellCentre({ col: Math.floor(at.col), row: Math.floor(at.row) }, GEOM);
  return snapProp(c.x, c.z, p);
}

const pctX = (cells: number): string => `${(cells / FLOOR_COLS) * 100}%`;
const pctY = (cells: number): string => `${(cells / FLOOR_ROWS) * 100}%`;

function putMachine(c: HTMLElement, p: { col: number; row: number }): void {
  c.style.left = pctX(p.col);
  c.style.top = pctY(p.row);
  c.style.width = pctX(FLOOR_STEP);
  c.style.height = pctY(FLOOR_STEP);
}

function putProp(c: HTMLElement, p: Prop): void {
  const b = GEOM.box;
  const W = b.maxX - b.minX, D = b.maxZ - b.minZ;
  const s = propStand(p);
  let { w, d } = propSize(p.kind);
  let x = s.x, z = s.z;
  if (propKind(p.kind).wall) {
    if (p.kind === 'poster') {
      w = POSTER_H * posterArt(p.art).aspect + POSTER_FRAME * 2;
      d = 0.14;
    }
    x += Math.sin(s.yaw) * d / 2;
    z += Math.cos(s.yaw) * d / 2;
  }
  c.style.left = `${((x - b.minX) / W) * 100}%`;
  c.style.top = `${((z - b.minZ) / D) * 100}%`;
  c.style.width = `${(w / W) * 100}%`;
  c.style.height = `${(d / D) * 100}%`;
  c.style.transform = `translate(-50%, -50%) rotate(${-s.yaw}rad)`;
}

function facingEdge(p: Place): 'down' | 'left' | 'up' | 'right' {
  const edges = ['down', 'left', 'up', 'right'] as const;
  return edges[turnOf(p)];
}

function floorplan(d: ArcadeDoc, byContent: Map<string, GameMeta>): HTMLElement {
  const plan = el('div', null, { class: 'fp', role: 'group', 'aria-label': str('arcade.host.floorplan') });
  const full = d.machines.length >= ARCADE_MAX_MACHINES;
  const scroll = el('div', null, { class: 'fp-scroll' });
  const grid = el('div', null, { class: 'fp-grid' });
  grid.style.setProperty('--fp-cols', String(FLOOR_COLS));
  grid.style.setProperty('--fp-rows', String(FLOOR_ROWS));
  grid.style.setProperty('--fp-step', String(FLOOR_STEP));
  const dw = doorway(FLOOR_COLS);
  const mark = (text: string, cls: string, col0: number, col1: number, row0: number, row1: number): HTMLElement => {
    const m = el('div', text, { class: `fp-mark ${cls}`, 'aria-hidden': 'true' });
    m.style.left = pctX(col0);
    m.style.width = pctX(col1 - col0 + 1);
    m.style.top = pctY(row0);
    m.style.height = pctY(row1 - row0 + 1);
    return m;
  };
  grid.append(
    mark(str('arcade.host.doors'), 'fp-mark-doors', dw.from, dw.to, FLOOR_ROWS - FLOOR_STEP, FLOOR_ROWS - 1),
    mark(str('arcade.host.window'), 'fp-mark-window', 0, 0, GEOM.window.from, GEOM.window.to),
  );
  for (const m of d.machines) if (m.place) grid.append(machineCard(d, m, byContent.get(m.contentHash) ?? null));
  for (const p of d.props ?? []) grid.append(propCard(d, p));
  const ghost = el('div', null, { class: 'fp-ghost', 'aria-hidden': 'true' });
  ghost.append(rowIcon(UI_ICONS.plus, 'fp-plus', 18));
  ghost.hidden = true;
  grid.append(ghost);
  const onFloor = (e: PointerEvent): Place | null => {
    const t = e.target as HTMLElement;
    if (t.closest('.fp-machine, .fp-prop') || document.body.classList.contains('fp-dragging')) return null;
    const at = pointOn(grid, e.clientX, e.clientY);
    return at ? placeUnder(at) : null;
  };
  grid.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || full) { ghost.hidden = true; return; }
    const p = onFloor(e);
    ghost.hidden = !p;
    if (!p) return;
    putMachine(ghost, p);
    ghost.classList.toggle('fp-blocked', !fits(d, p));
  });
  grid.addEventListener('pointerleave', () => { ghost.hidden = true; });
  grid.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.fp-machine, .fp-prop') || dragged) return;
    const at = pointOn(grid, e.clientX, e.clientY);
    if (!at) return;
    openFloorMenu(d, at, grid, full);
  });
  scroll.append(grid);
  plan.append(scroll);
  return plan;
}

function machineCard(d: ArcadeDoc, m: DocMachine, held: GameMeta | null): HTMLElement {
  const p = m.place!;
  const c = el('div', null, { class: 'fp-machine', tabindex: '0', 'aria-label': m.name, 'data-id': m.id, role: 'button' });
  c.dataset.face = facingEdge(p);
  c.title = m.name;
  putMachine(c, p);
  const art = artwork(held?.hasThumb ? held.hash : null, m.name, () => {
    if (!dragged) openMachineMenu(d, m, c);
  });
  c.append(art);
  if (m.outOfService || m.status !== 'installed') c.classList.add('fp-dim');
  c.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === c) { ev.preventDefault(); openMachineMenu(d, m, c); return; }
    if (ev.target !== c) return;
    if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); void turn(d, m, ev.shiftKey ? -1 : 1, true); return; }
    const n = ev.shiftKey ? FLOOR_STEP : 1;
    const to = ev.key === 'ArrowLeft' ? { ...p, col: p.col - n } : ev.key === 'ArrowRight' ? { ...p, col: p.col + n }
      : ev.key === 'ArrowUp' ? { ...p, row: p.row - n } : ev.key === 'ArrowDown' ? { ...p, row: p.row + n } : null;
    if (!to) return;
    ev.preventDefault();
    void place(d, m, {
      col: Math.max(0, Math.min(FLOOR_COLS - FLOOR_STEP, to.col)), row: Math.max(0, Math.min(FLOOR_ROWS - FLOOR_STEP, to.row)), turn: to.turn,
    }, true);
  });
  dragOn(c, {
    follow: (at) => {
      const to = placeUnder(at, turnOf(p));
      putMachine(c, to);
      return fits(d, to, m.id) ? to : null;
    },
    drop: (to) => { void place(d, m, to, false); },
    back: () => putMachine(c, p),
  });
  return c;
}

function propName(d: ArcadeDoc, p: Prop): string {
  const k = propKind(p.kind);
  if (p.kind === 'poster') return `${k.label}: ${posterArt(p.art).label}`;
  const same = (d.props ?? []).filter((q) => q.kind === p.kind);
  return same.length > 1 ? `${k.label} ${same.indexOf(p) + 1}` : k.label;
}

function propCard(d: ArcadeDoc, p: Prop): HTMLElement {
  const name = propName(d, p);
  const c = el('div', null, { class: `fp-prop fp-prop-${p.kind}`, tabindex: '0', 'aria-label': name, 'data-prop': p.id, role: 'button' });
  c.title = name;
  putProp(c, p);
  c.addEventListener('click', () => { if (!dragged) openPropMenu(d, p, c); });
  c.addEventListener('keydown', (ev) => {
    if (ev.target !== c) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPropMenu(d, p, c); return; }
    if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); void propTurned(d, p, true); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); void propRemoved(d, p); return; }
    const n = GEOM.cell * (ev.shiftKey ? FLOOR_STEP : 1);
    const to = ev.key === 'ArrowLeft' ? { x: p.x - n, z: p.z } : ev.key === 'ArrowRight' ? { x: p.x + n, z: p.z }
      : ev.key === 'ArrowUp' ? { x: p.x, z: p.z - n } : ev.key === 'ArrowDown' ? { x: p.x, z: p.z + n } : null;
    if (!to) return;
    ev.preventDefault();
    void propMoved(d, p, to, true);
  });
  if (propKind(p.kind).wall) {
    dragOn(c, {
      follow: (at) => {
        const w = cellCentre({ col: at.col - 0.5, row: at.row - 0.5 }, GEOM);
        const to = { x: w.x - FLOOR_CENTRE.x, z: w.z - FLOOR_CENTRE.z };
        putProp(c, { ...p, ...to });
        return propFits(d, { ...p, ...to }) ? to : null;
      },
      drop: (to) => { void propMoved(d, p, to, false); },
      back: () => putProp(c, p),
    });
    return c;
  }
  dragOn(c, {
    follow: (at) => {
      const to = propPlaceUnder(at, p);
      putProp(c, { ...p, ...to });
      return propFits(d, { ...p, ...to }) ? to : null;
    },
    drop: (to) => { void propMoved(d, p, to, false); },
    back: () => putProp(c, p),
  });
  return c;
}

const DRAG_PX = 6;
const HOLD_MS = 280;
let dragged = false;

function dragOn<T>(c: HTMLElement, h: { follow(at: { col: number; row: number }): T | null; drop(to: T): void; back(): void }): void {
  c.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const touch = ev.pointerType !== 'mouse';
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    const grid = c.parentElement!;
    let lifted = false;
    let to: T | null = null;
    let held = !touch;
    const timer = touch ? window.setTimeout(() => { held = true; lift(); }, HOLD_MS) : 0;
    dragged = false;

    const lift = (): void => {
      if (lifted) return;
      lifted = true;
      try { c.setPointerCapture(ev.pointerId); } catch {  }
      c.classList.add('fp-lifted');
      document.body.classList.add('fp-dragging');
    };
    const follow = (x: number, y: number): void => {
      const at = pointOn(grid, x, y);
      if (!at) return;
      to = h.follow(at);
      c.classList.toggle('fp-blocked', to === null);
    };
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== ev.pointerId) return;
      const far = Math.hypot(e.clientX - x0, e.clientY - y0) > DRAG_PX;
      if (!held) {
        if (far) end(false);
        return;
      }
      if (!lifted && far) lift();
      if (lifted) follow(e.clientX, e.clientY);
    };
    const noScroll = (e: TouchEvent): void => { if (lifted) e.preventDefault(); };
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== ev.pointerId) return;
      end(e.type === 'pointerup');
    };
    const end = (drop: boolean): void => {
      clearTimeout(timer);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      removeEventListener('touchmove', noScroll);
      document.body.classList.remove('fp-dragging');
      c.classList.remove('fp-lifted', 'fp-blocked');
      if (!lifted) return;
      dragged = true;
      setTimeout(() => { dragged = false; }, 0);
      if (drop && to !== null) { h.drop(to); return; }
      h.back();
      if (drop) say(str('arcade.host.there_is_no_room_there'));
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('touchmove', noScroll, { passive: false });
  });
  c.addEventListener('contextmenu', (ev) => ev.preventDefault());
}

async function place(d: ArcadeDoc, m: DocMachine, to: Place, refocus: boolean): Promise<void> {
  if (!moveMachine(d, m.id, to)) {
    if (refocus) say(str('arcade.host.there_is_no_room_there_2'));
    return;
  }
  await placed(d, m, refocus);
}

const FACINGS = [
  { glyph: '←', label: str('arcade.host.face_left'), turn: 1 as Turn, yaw: -Math.PI / 2 },
  { glyph: '↑', label: str('arcade.host.face_the_back_wall'), turn: 2 as Turn, yaw: Math.PI },
  { glyph: '↓', label: str('arcade.host.face_the_doors'), turn: 0 as Turn, yaw: 0 },
  { glyph: '→', label: str('arcade.host.face_right'), turn: 3 as Turn, yaw: Math.PI / 2 },
];

function facingRow(now: (f: typeof FACINGS[number]) => boolean, pick: (f: typeof FACINGS[number]) => void, off: boolean): HTMLElement {
  const row = el('div', null, { class: 'sheet-row sheet-facing' });
  if (off) row.classList.add('inert');
  row.append(el('span', str('arcade.host.facing'), { class: 'sheet-facing-label' }));
  for (const f of FACINGS) {
    const b = el('button', f.glyph, { class: 'sheet-facing-btn', type: 'button', 'aria-label': f.label }) as HTMLButtonElement;
    b.setAttribute('aria-pressed', String(now(f)));
    b.addEventListener('click', () => pick(f));
    row.append(b);
  }
  return row;
}

async function turn(d: ArcadeDoc, m: DocMachine, quarters: number, refocus: boolean): Promise<void> {
  if (!turnMachine(d, m.id, quarters)) return;
  await placed(d, m, refocus);
}

const placesOf = (d: ArcadeDoc): Map<string, Place> => {
  const places = new Map<string, Place>();
  for (const x of d.machines) if (x.place) places.set(x.id, x.place);
  return places;
};

async function placed(d: ArcadeDoc, m: DocMachine, refocus: boolean): Promise<void> {
  await saveDoc();
  await render();
  if (onPlaced) {
    onPlaced(placesOf(d));
  }
  if (refocus) root().querySelector<HTMLElement>(`.fp-machine[data-id="${CSS.escape(m.id)}"]`)?.focus();
}

async function propsChanged(d: ArcadeDoc, focus: string | null): Promise<void> {
  await saveDoc();
  await render();
  onProps?.(d.props ?? []);
  if (focus) root().querySelector<HTMLElement>(`.fp-prop[data-prop="${CSS.escape(focus)}"]`)?.focus();
}

async function propMoved(d: ArcadeDoc, p: Prop, to: { x: number; z: number }, refocus: boolean): Promise<void> {
  if (!moveProp(d, p.id, to)) {
    if (refocus) say(str('arcade.host.there_is_no_room_there_2'));
    return;
  }
  await propsChanged(d, refocus ? p.id : null);
}

async function propTurned(d: ArcadeDoc, p: Prop, refocus: boolean): Promise<void> {
  if (!turnProp(d, p.id)) return;
  await propsChanged(d, refocus ? p.id : null);
}

async function propRemoved(d: ArcadeDoc, p: Prop): Promise<void> {
  const name = propName(d, p);
  if (!removeProp(d, p.id)) return;
  await propsChanged(d, null);
  say(str('arcade.host.n_was_taken_out_of_the_room', { 0: name }));
}

function openPropMenu(d: ArcadeDoc, p: Prop, returnTo: HTMLElement): void {
  const rows: HTMLElement[] = [];
  if (!propKind(p.kind).wall) {
    rows.push(facingRow((f) => Math.abs((((f.yaw - p.yaw) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) < 1e-6, (f) => {
      closeSheet();
      if (faceProp(d, p.id, f.yaw)) void propsChanged(d, null);
    }, false));
  }
  const del = sheetRow(str('arcade.host.delete'), str('arcade.host.takes_it_out_of_the_room'));
  del.classList.add('destructive');
  del.addEventListener('click', () => { closeSheet(); void propRemoved(d, p); });
  rows.push(del);
  showSheet(propName(d, p), rows, returnTo);
}

function openFloorMenu(d: ArcadeDoc, at: { col: number; row: number }, returnTo: HTMLElement, full: boolean): void {
  const machine = sheetRow(str('arcade.host.add_machine'), full ? fullNote() : '', { disabled: full });
  machine.addEventListener('click', () => {
    if (full) return;
    closeSheet();
    const p = placeUnder(at);
    if (fits(d, p)) addAt(p);
    else say(str('arcade.host.there_is_no_room_for'));
  });
  const prop = sheetRow(str('arcade.host.add_prop'), '');
  prop.append(rowIcon(MENU_ICONS.chevRight, 'row-chev', 16));
  prop.addEventListener('click', () => openAddProp(d, returnTo, at));
  showSheet(str('arcade.host.add_here'), [machine, prop], returnTo);
}

const fullNote = (): string => str('arcade.host.full_n_machines', { 0: ARCADE_MAX_MACHINES });

function openAddProp(d: ArcadeDoc, returnTo: HTMLElement, at?: { col: number; row: number }): void {
  const add = (kind: PropKind, art?: PosterArt): void => {
    closeSheet();
    if ((d.props?.length ?? 0) >= PROPS_MAX) { say(str('arcade.host.there_is_no_clear_floor_for_it')); return; }
    let to: { x: number; z: number } | null = null;
    if (at) {
      const c = cellCentre({ col: Math.floor(at.col), row: Math.floor(at.row) }, GEOM);
      to = propKind(kind).wall ? { x: c.x - FLOOR_CENTRE.x, z: c.z - FLOOR_CENTRE.z } : snapProp(c.x, c.z, { id: '', kind, x: 0, z: 0, yaw: 0 });
    }
    const p = addProp(d, kind, art, to);
    if (!p) { say(str(to ? 'arcade.host.there_is_no_room_there_2' : 'arcade.host.there_is_no_clear_floor_for_it')); return; }
    void propsChanged(d, p.id);
  };
  const posters = (): void => {
    showSheet(str('arcade.host.posters'), POSTERS.map((a) => {
      const r = sheetRow(a.label, '');
      r.addEventListener('click', () => add('poster', a.id));
      return r;
    }), returnTo);
  };
  showSheet(str('arcade.host.add_a_prop'), PROP_KINDS.map((k) => {
    const r = sheetRow(k.label, '');
    r.addEventListener('click', () => (k.id === 'poster' ? posters() : add(k.id)));
    return r;
  }), returnTo);
}

export const COINS_STOPPED_HOST_TEXT = str('arcade.host.this_machine_has_stopped_recording');
export const COINS_STOPPED_HOST_NOTE = str('arcade.host.two_coins_did_not_match');

const LOST_SHOWN = 5;

const pounds = (p: number): string => `${p < 0 ? '-' : ''}£${(Math.abs(p) / 100).toFixed(2)}`;

function openStats(m: DocMachine, d: ArcadeDoc): void {
  const box = card();
  let playsRow: HTMLElement | null = null;
  const noBooks = moneyTrust(m.board).trust === 'none';
  const st = m.stats;
  if (noBooks) {
    const row = el('div', null, { class: 'menu-row menu-stat' });
    row.append(el('span', NO_BOOKKEEPING, { class: 'row-label' }));
    box.append(row);
  } else {
    const inRow = statRow(box, str('arcade.host.money_in'));
    const outRow = statRow(box, str('arcade.host.money_out'));
    const tokRow = statRow(box, str('arcade.host.tokens_out'));
    tokRow.parentElement!.hidden = true;
    const show = (f: StatsMoney): void => {
      inRow.textContent = moneyInText(f);
      outRow.textContent = moneyOutText(f);
      if (f.tokenOutPence || f.tokenInPence) {
        tokRow.textContent = pounds(f.tokenOutPence);
        tokRow.parentElement!.hidden = false;
      }
      for (const x of f.lost.slice(0, LOST_SHOWN)) {
        const r = statRow(box, str('arcade.host.credit_lost_n', { 0: new Date(x.at).toLocaleString() }));
        r.textContent = lostCreditText(x.sinceGame);
        if (playsRow) box.insertBefore(r.parentElement!, playsRow);
      }
    };
    if (serverFlag()) {
      inRow.textContent = '…';
      outRow.textContent = '…';
      void serverMoney(d.id, m.id).then((r) => {
        if (r === undefined) { inRow.textContent = '-'; outRow.textContent = '-'; return; }
        show(statsMoney(m, r));
        if (r?.coinsStopped !== undefined) box.prepend(statusRow('warn', COINS_STOPPED_HOST_TEXT, COINS_STOPPED_HOST_NOTE));
      });
    } else {
      show(statsMoney(m));
    }
  }
  const plays = statRow(box, str('arcade.host.times_played'));
  plays.textContent = String(st?.plays ?? 0);
  playsRow = plays.parentElement;
  statRow(box, str('arcade.host.last_played')).textContent = st?.lastPlayedAt ? new Date(st.lastPlayedAt).toLocaleString() : 'never';
  openDialog({ title: m.name, body: [box] });
}

function openMachineMenu(d: ArcadeDoc, m: DocMachine, returnTo: HTMLElement): void {
  const installed = m.status === 'installed';
  const edit = sheetRow(installed ? str('arcade.host.edit') : str('arcade.host.install'), installed
    ? str('arcade.host.settings_look_and_the_test') : str('arcade.host.carry_on_with_the_add'));
  edit.addEventListener('click', () => {
    closeSheet();
    go(installed ? `&edit=${encodeURIComponent(m.id)}` : `&install=${encodeURIComponent(m.id)}`);
  });
  const stopped = !!m.outOfService;
  const power = sheetRow(stopped ? str('arcade.host.power_on') : str('arcade.host.power_off'), !installed ? str('arcade.host.install_it_first')
    : stopped ? str('arcade.host.back_in_service_in_the') : str('arcade.host.stands_dark_in_the_room'));
  if (!installed) power.classList.add('inert');
  power.addEventListener('click', async () => {
    closeSheet();
    m.outOfService = !stopped;
    await saveDoc();
    if (m.hash) await invalidateRec(m.hash).catch(() => undefined);
    await refreshIn();
    say(m.outOfService ? str('arcade.host.n_is_out_of_service', { 0: m.name }) : str('arcade.host.n_is_back_in_service', { 0: m.name }));
  });
  const turnRow = facingRow((f) => turnOf(m.place) === f.turn, (f) => {
    closeSheet();
    void turn(d, m, f.turn - turnOf(m.place), false);
  }, !m.place);
  const full = !!cannotAdd(d);
  const dup = sheetRow(str('arcade.host.duplicate'),
    full ? fullNote() : installed ? str('arcade.host.another_of_it_set_up') : str('arcade.host.install_it_first'),
    { disabled: full || !installed });
  dup.addEventListener('click', () => {
    if (full || !installed) return;
    closeSheet();
    void (async () => {
      let copy: DocMachine | null;
      try { copy = duplicateMachine(d, m.id); } catch (e) { say((e as Error).message); return; }
      if (!copy) return;
      await saveDoc();
      await refreshIn();
      say(str('arcade.host.another_n_was_added', { 0: m.name }));
    })();
  });
  const stats = sheetRow(str('arcade.host.stats'), str('arcade.host.money_in_and_out_and'));
  stats.addEventListener('click', () => { closeSheet(); openStats(m, d); });
  const del = sheetRow(str('arcade.host.delete'), str('arcade.host.takes_it_out_of_this'));
  del.classList.add('destructive');
  del.addEventListener('click', () => {
    confirmInSheet({
      ask: str('arcade.host.delete_n_from_this_arcade', { 0: m.name }), sub: str('arcade.host.its_settings_and_stats_go'),
      keep: str('arcade.host.keep_it'), yes: str('arcade.host.yes_delete_it'),
      onYes: () => {
        void (async () => {
          removeMachine(d, m.id);
          await saveDoc();
          await refreshIn();
          say(str('arcade.host.n_was_deleted_from_this', { 0: m.name }));
        })();
      },
    });
  });
  showSheet(m.name, [edit, power, turnRow, dup, stats, del], returnTo);
}

interface AfterUpload { fresh: Set<string>; problems: UploadProblem[]; note?: string }

async function renderPicker(d: ArcadeDoc, after?: AfterUpload): Promise<void> {
  const page = dialogFrame('host-picker');
  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-modal', 'true');
  page.setAttribute('aria-labelledby', 'hostPickTitle');
  const head = el('div', null, { class: 'host-head' });
  head.append(el('h1', str('arcade.host.add_a_machine'), { class: 'host-title', id: 'hostPickTitle' }));
  const acts = el('div', null, { class: 'host-actions' });
  const input = el('input', null, { type: 'file', multiple: '', hidden: '', 'aria-hidden': 'true' });
  const upload = iconButton(UI_ICONS.plus, str('arcade.host.upload_a_zip_or_punnet'), () => { input.click(); });
  acts.append(upload, exitButton(() => go('')));
  head.append(acts, input);
  const games = await listGames().catch(() => [] as GameMeta[]);
  const here = new Map<string, DocMachine[]>();
  for (const m of d.machines) here.set(m.contentHash, [...(here.get(m.contentHash) ?? []), m]);
  const copiesOf = (g: GameMeta): DocMachine[] => here.get(g.contentHash ?? g.hash) ?? [];
  const free = games.filter((g) => !copiesOf(g).length);
  let onlyNew = true;
  const none = el('div');
  const grid = el('div', null, { class: 'ui-list' });
  const list = mountGameList(grid, {
    mode: 'pick',
    unplayable: unplayableReason,
    thumbSize: 'small',
    onPick: (g) => { void install(d, g, copiesOf(g)); },
    exclude: (g) => onlyNew && copiesOf(g).length > 0,
    fresh: after?.fresh,
    chips: (g) => {
      const n = copiesOf(g).length;
      return n ? [chip(str('arcade.host.added_n', { n }))] : [];
    },
    onDrawn: (shown) => {
      none.replaceChildren();
      if (shown) return;
      const allHere = onlyNew && !free.length && games.length > 0;
      none.append(emptyState({
        welcome: false,
        message: list.search && !allHere ? str('arcade.host.no_game_matches_n', { 0: list.search })
          : allHere ? str('arcade.host.every_game_in_your_library') : str('arcade.host.your_library_is_empty'),
        hint: allHere ? str('arcade.host.show_all_games_to_add') : games.length ? undefined : str('arcade.host.use_to_upload_a_game'),
        actions: games.length ? [] : [button(str('arcade.host.open_the_library'), () => { location.href = '/'; })],
      }));
    },
  });
  const show = showSelect(onlyNew, (v) => { onlyNew = v; list.load(games); });

  const progress = el('div', null, { class: 'host-upload', role: 'status', 'aria-live': 'polite' });
  progress.hidden = true;
  const progressText = el('span', '', { class: 'host-upload-text' });
  const bar = el('div', null, { class: 'host-bar' });
  const fillBar = el('i');
  bar.append(fillBar);
  progress.append(statusIcon('running', str('arcade.host.importing')), progressText, bar);
  const report = el('div', null, { class: 'host-report' });
  if (after) showReport(report, after);

  let running = false;
  const run = async (files: File[]): Promise<void> => {
    if (running || !files.length) return;
    running = true;
    upload.disabled = true;
    report.replaceChildren();
    none.hidden = true;
    progress.hidden = false;
    bar.hidden = true;
    const leaving = (ev: BeforeUnloadEvent): void => { ev.preventDefault(); };
    window.addEventListener('beforeunload', leaving);
    let result: UploadResult;
    try {
      result = await uploadToLibrary(files, (text, done) => {
        progressText.textContent = text;
        if (done !== undefined) { bar.hidden = false; fillBar.style.width = `${Math.round(done * 100)}%`; }
      });
    } catch (e) {
      result = { games: [], empty: false, problems: [{ name: files.length === 1 ? files[0].name : `${files.length} files`,
        reason: (e as Error).message || str('arcade.host.the_import_failed') }] };
    } finally {
      window.removeEventListener('beforeunload', leaving);
      running = false;
    }
    if (result.empty) {
      progress.hidden = true;
      none.hidden = false;
      upload.disabled = false;
      showReport(report, { fresh: new Set(), problems: [], note: str('arcade.host.nothing_in_that_looked_like') });
      return;
    }
    const addable = cannotAdd(d) ? [] : result.games;
    if (result.games.length === 1 && addable.length === 1 && !result.problems.length) {
      await install(d, addable[0], copiesOf(addable[0]));
      return;
    }
    const inHere = result.games.filter((g) => copiesOf(g).length > 0);
    const n = result.games.length;
    await renderPicker(d, {
      fresh: new Set(result.games.map((g) => g.hash)),
      problems: result.problems,
      note: n === 0 ? undefined
        : (inHere.length ? str('arcade.host.n_games_ready_to_add_some_here', { n, here: inHere.length }) : str('arcade.host.n_games_ready_to_add', { n })),
    });
  };
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    void run(files);
  });
  page.addEventListener('dragover', (ev) => {
    if (![...(ev.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) return;
    ev.preventDefault();
    page.classList.add('host-dropping');
  });
  page.addEventListener('dragleave', (ev) => {
    if (!page.contains(ev.relatedTarget as Node | null)) page.classList.remove('host-dropping');
  });
  page.addEventListener('drop', (ev) => {
    page.classList.remove('host-dropping');
    if (!ev.dataTransfer) return;
    ev.preventDefault();
    const entries = entriesFromDrop(ev.dataTransfer.items);
    void filesFromDrop(entries).then(run).catch((e: Error) => {
      showReport(report, { fresh: new Set(), problems: [], note: str('arcade.host.could_not_read_what_was', { 0: e.message }) });
    });
  });
  const scroll = el('div', null, { class: 'host-pick-scroll' });
  scroll.append(report, grid, none);
  if (list.searchButton) acts.prepend(list.searchButton);
  const controls = el('div', null, { class: 'host-pick-controls' });
  controls.append(show, list.controls!);
  page.append(head, progress, controls, scroll);
  list.load(games);
}

function showSelect(onlyNew: boolean, onChange: (onlyNew: boolean) => void): HTMLElement {
  const wrap = el('div', null, { class: 'ui-sort-wrap' });
  const lab = el('span', str('arcade.host.show'), { class: 'ui-sort-label', id: 'host-show-label' });
  const sel = el('select', null, { id: 'host-show', 'aria-labelledby': lab.id }) as HTMLSelectElement;
  sel.append(el('option', str('arcade.host.not_yet_added'), { value: 'new' }), el('option', str('arcade.host.all_games'), { value: 'all' }));
  sel.value = onlyNew ? 'new' : 'all';
  sel.addEventListener('change', () => onChange(sel.value === 'new'));
  wrap.append(lab, sel);
  enhanceSelect(sel);
  return wrap;
}

function showReport(box: HTMLElement, a: AfterUpload): void {
  box.replaceChildren();
  if (a.note) box.append(el('p', a.note, { class: 'host-note' }));
  if (!a.problems.length) return;
  const c = card();
  c.classList.add('host-problems');
  for (const p of a.problems) {
    const row = el('div', null, { class: 'host-problem' });
    row.append(statusIcon('fail', str('arcade.host.not_added')), el('span', `${p.name} - ${p.reason}`));
    c.append(row);
  }
  box.append(c);
}

async function install(d: ArcadeDoc, g: GameMeta, copies: DocMachine[] = []): Promise<void> {
  const why = cannotAdd(d);
  if (why) { say(why); return; }
  const src = copies.find((m) => m.status === 'installed') ?? copies[0];
  if (src) {
    const copy = duplicateMachine(d, src.id, wantedCell());
    if (!copy) return;
    await saveDoc();
    if (copy.status === 'installed') {
      go('');
      say(str('arcade.host.another_n_was_added', { 0: src.name }));
    } else go(`&install=${encodeURIComponent(copy.id)}`);
    return;
  }
  const ch = g.contentHash ?? g.hash;
  const m = addMachine(d, {
    contentHash: ch, contentRule: CONTENT_RULE, hash: g.hash, name: g.name, board: g.system,
    ...(g.programHash ? { programHash: g.programHash } : {}),
  }, wantedCell());
  await saveDoc();
  go(`&install=${encodeURIComponent(m.id)}`);
}

function wantedCell(): Place | null {
  if (dockBody) return tappedCell;
  const q = new URLSearchParams(location.search);
  const col = Number(q.get('col'));
  const row = Number(q.get('row'));
  return q.has('col') && q.has('row') && Number.isInteger(col) && Number.isInteger(row) ? { col, row } : null;
}

export function headRow(cells: string[]): HTMLTableRowElement {
  const tr = el('tr');
  for (const c of cells) tr.append(el('th', c));
  return tr;
}
