import { helpButton } from '../web/help/help';
import { listGames, CONTENT_RULE, type GameMeta } from '../web/store';
import { contentKeys } from '../web/contentkeys';

const keysOf = (g: GameMeta): string[] => (g.contentHash ? contentKeys(g) : [g.hash]);
import { MENU_ICONS, UI_ICONS, rowIcon } from '../web/ui/icons';
import { card, menuRow, setKvValue, statRow } from '../web/ui/rows';
import type { DecorateSection } from './decorate';
import { POSTER_URLS } from './posterurls';
import { artwork } from '../web/ui/art';
import { chip, emptyState, pillButton } from '../web/ui/list';
import { mountGameList } from '../web/gamelist';
import { unplayableReason } from '../web/libimport';
import { openDialog } from '../web/ui/dialog';
import { dangerRow, closeSheet, confirmInSheet, escapeCloses, optionRow, sheetRow, showSheet } from '../web/ui/sheet';
import { statusRow } from '../web/ui/status';
import {
  ARCADE_MAX_MACHINES, FLOOR_CENTRE, FLOOR_COLS, FLOOR_GEOM, FLOOR_ROWS, FLOOR_STEP, addMachine, addProp, aligned, arrange, cannotAdd, distributed, duplicateMachine, facedAll, fits, moveMachine, moveProp, turnedAsGroup, turnedEach, type AlignEdge, type Arranged, type ArrangeTarget,
  faceProp, groupMoved, moveGroup, propFits, propSize, propStand, removeMachine, removeProp, switchedOff, snapProp, turnMachine, turnOf, turnProp, type ArcadeDoc, type DocMachine, type FloorGroup, type Place, type Turn,
} from './doc';
import { cellCentre, doorway } from './floor';
import { posterArt, POSTER_FRAME, POSTER_H, POSTERS, PROP_KINDS, propKind, PROPS_MAX, type PosterArt, type Prop, type PropKind } from './proplist';
import { moneyTrust, NO_BOOKKEEPING } from './moneygate';
import { deleteArcade, listArcades, putArcade, setCurrentArcade, currentArcade } from './docstore';
import { arcadeSettingsParts, darkNote, openArcadeSettings, type SettingsHooks, type SettingsParts } from './hostsettings';
import { lookOf, THEMES, themeOfLook } from './roomlook';
import { ArcadeServer, arcadeServer, NAME_TAKEN, nameTakenHere, newHostKey, publishRefusal, shareHooks, syncArcade, floorLink } from './share';
import { showToast } from '../web/ui/toast';
import { invalidateRec } from './cache';
import { lostCreditText, serverMoney, statsMoney, type StatsMoney } from './moneyrecord';
import { serverFlag } from './remote';
import { mountAvatar } from './avatar';
import { str } from '../web/i18n';
import { moneyInParts, moneyOutParts } from '../web/moneytext';
import { siteNav } from '../web/ui/sitenav';
import { betaBrand } from '../web/ui/beta';
import { bubbleTip, hideBubble, showBubble } from '../web/ui/tip';
import { openAlert } from '../web/ui/dialog';
import { fillDocSources, librarySource } from './sourceget';
import { SourceStore } from '../web/sources/store';

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
const planCard = (sel: string): HTMLElement | null =>
  editor?.stage.querySelector<HTMLElement>(sel) ?? root().querySelector<HTMLElement>(sel);

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

export function iconButton(icon: string, label: string, onClick: () => void | Promise<void>, what?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'iconbtn';
  b.setAttribute('aria-label', label);
  if (what) bubbleTip(b, label, what);
  else b.title = label;
  b.append(rowIcon(icon, 'row-icon', 18).firstElementChild!);
  b.addEventListener('click', () => { void onClick(); });
  return b;
}

export function exitButton(onExit: () => void): HTMLButtonElement {
  const b = iconButton(UI_ICONS.cross, str('arcade.host.exit'), onExit, str('arcade.host.exit_tip'));
  b.className = 'nb-icon-btn wz-exit';
  b.setAttribute('aria-label', str('arcade.host.exit_to_the_arcade'));
  return b;
}

let doc: ArcadeDoc | null = null;

function say(text: string): void {
  showToast(text);
}

function sayNoRoom(): void {
  showToast(str('arcade.host.no_room_there'), { ms: 1500 });
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
  const top = el('div', null, { class: 'host-top nb-topbar' });
  const home = document.getElementById('home');
  if (home) top.append(betaBrand(home));
  const right = el('div', null, { class: 'host-top-right' });
  right.append(siteNav({ here: 'arcades', help: helpButton(() => { void import('./guide').then((m) => m.openGuide()); }), settings: true, onLocked: () => location.replace('/') }));
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
      if (editor && cancelDrag && document.body.classList.contains('fp-dragging')) { cancelDrag(); return true; }
      if (editor) {
        if (pickSize()) clearPicked(); else closeEditor();
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
      closeEditor();
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
  const f = el('div', null, { class: `host-dlg nb-sheet ${cls}`.trim() });
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
  }
  if (d.machines.length) {
    const library = await listGames().catch(() => [] as GameMeta[]);
    if (fillDocSources(d, library)) void saveDoc();
    const dark = darkNote(d, 'host-note');
    if (dark) nodes.push(dark);
    const byContent = new Map<string, GameMeta>();
    for (const g of library) for (const k of keysOf(g)) byContent.set(k, g);
    nodes.push(floorplan(d, byContent));
    const row = el('div', null, { class: 'host-actions' });
    row.append(el('p', str('arcade.host.n_of_n_machines', { 0: d.machines.length, 1: ARCADE_MAX_MACHINES }), { class: 'host-count readout' }));
    nodes.push(row);
  }
  if (scrim) for (const n of nodes) n.inert = true;
  r.replaceChildren(...nodes, ...(scrim && frame ? [scrim, frame] : []));
}

async function renderDock(r: HTMLElement, d: ArcadeDoc): Promise<void> {
  const library = d.machines.length ? await listGames().catch(() => [] as GameMeta[]) : [];
  if (fillDocSources(d, library)) void saveDoc();
  dockSettings = arcadeSettingsParts(settingsHooks(d, await arcadeServer()));
  const acts = el('div', null, { class: 'host-actions floor-dock-actions' });
  if (!d.machines.length) {
    acts.append(el('span', str('arcade.host.you_have_no_machines_installed'), { class: 'host-note' }), button(str('arcade.host.add_machine'), () => addAt(null)));
  }
  const nodes: Node[] = [...dockSettings.top];
  const make = decorateMaker;
  const show = dockShow;
  if (make && show) {
    const deco = card();
    const theme = menuRow(str('arcade.decorate.title'), UI_ICONS.sun, () => {
      decorating = make({ show, back: () => { decorating = null; show([r], 'out'); } });
      decorating.open('in');
    }, true);
    const preset = THEMES.find((t) => t.id === themeOfLook(lookOf(d.room)));
    if (preset) theme.querySelector('.row-label')?.append(el('small', preset.label, { class: 'nb-meta' }));
    deco.append(theme);
    nodes.push(sectionLabel(str('arcade.host.room')), deco);
  }
  const machinesHead = el('div', null, { class: 'dock-machines-head' });
  machinesHead.append(sectionLabel(str('arcade.host.machines')));
  if (d.machines.length) {
    const mark = '\u0000';
    const [before, after] = str('arcade.host.n_of_n', { 0: mark, 1: ARCADE_MAX_MACHINES }).split(mark);
    const count = el('span', null, { class: 'dock-count' });
    if (before) count.append(before);
    count.append(el('b', String(d.machines.length)), after ?? '');
    const edit = button(str('arcade.host.edit_layout'), () => openEditor(d, byContentOf(library)), { class: 'nb-btn nb-btn--primary nb-btn--sm fp-edit-btn' });
    edit.prepend(rowIcon(UI_ICONS.options, 'fp-edit-icon', 16).firstElementChild!);
    machinesHead.append(count, el('span', null, { class: 'dock-spacer' }), edit);
  }
  nodes.push(machinesHead);
  const dark = d.machines.length ? darkNote(d, 'nb-notice dock-notice', UI_ICONS.info) : null;
  if (dark) nodes.push(dark);
  if (d.machines.length) {
    const byContent = byContentOf(library);
    nodes.push(...machineList(d, byContent));
    drawEditor(d, byContent);
  }
  if (acts.childElementCount) nodes.push(acts);
  nodes.push(...dockSettings.danger);
  r.replaceChildren(...nodes);
}

function byContentOf(library: GameMeta[]): Map<string, GameMeta> {
  const m = new Map<string, GameMeta>();
  for (const g of library) m.set(g.contentHash ?? g.hash, g);
  return m;
}

function sectionLabel(text: string): HTMLElement {
  return el('div', text, { class: 'nb-field__label dock-label' });
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
  }, str('arcade.host.arcade_settings_tip'));
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
  c.style.setProperty('--fp-turn', `${s.yaw}rad`);
}

function facingEdge(p: Place): 'down' | 'left' | 'up' | 'right' {
  const edges = ['down', 'left', 'up', 'right'] as const;
  return edges[turnOf(p)];
}

function floorplan(d: ArcadeDoc, byContent: Map<string, GameMeta>): HTMLElement {
  const plan = el('div', null, { class: 'fp', role: 'group', 'aria-label': str('arcade.host.floorplan') });
  for (const id of picked.machines) if (!d.machines.some((m) => m.id === id && m.place)) picked.machines.delete(id);
  for (const id of picked.props) if (!(d.props ?? []).some((q) => q.id === id)) picked.props.delete(id);
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
  ghost.append(rowIcon(UI_ICONS.plus, 'fp-plus', 18), rowIcon(UI_ICONS.no, 'fp-no', 18));
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
    if (pickSize()) { clearPicked(); return; }
    const at = pointOn(grid, e.clientX, e.clientY);
    if (!at) return;
    openFloorMenu(d, at, grid, full);
  });
  marqueeOn(grid);
  plan.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pickSize()) { clearPicked(); e.stopPropagation(); } });
  scroll.append(grid);
  plan.append(scroll);
  return plan;
}

function marqueeOn(grid: HTMLElement): void {
  grid.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest('.fp-machine, .fp-prop')) return;
    const touch = ev.pointerType !== 'mouse';
    const x0 = ev.clientX, y0 = ev.clientY;
    let held = !touch;
    let box: HTMLElement | null = null;
    const timer = touch ? window.setTimeout(() => { held = true; start(); }, HOLD_MS) : 0;
    const start = (): void => {
      if (box) return;
      try { grid.setPointerCapture(ev.pointerId); } catch {  }
      box = el('div', null, { class: 'fp-marquee', 'aria-hidden': 'true' });
      grid.append(box);
      document.body.classList.add('fp-dragging');
      if (!ev.shiftKey) clearPicked();
    };
    const rect = (x: number, y: number): DOMRect => new DOMRect(Math.min(x0, x), Math.min(y0, y), Math.abs(x - x0), Math.abs(y - y0));
    const draw = (x: number, y: number): void => {
      const g = grid.getBoundingClientRect();
      const r = rect(x, y);
      Object.assign(box!.style, { left: `${r.left - g.left}px`, top: `${r.top - g.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== ev.pointerId) return;
      const far = Math.hypot(e.clientX - x0, e.clientY - y0) > DRAG_PX;
      if (!held) { if (far) end(null); return; }
      if (!box && far) start();
      if (box) draw(e.clientX, e.clientY);
    };
    const noScroll = (e: TouchEvent): void => { if (box) e.preventDefault(); };
    const up = (e: PointerEvent): void => { if (e.pointerId === ev.pointerId) end(e.type === 'pointerup' ? e : null); };
    const end = (e: PointerEvent | null): void => {
      clearTimeout(timer);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      removeEventListener('touchmove', noScroll);
      if (!box) return;
      document.body.classList.remove('fp-dragging');
      box.remove();
      dragged = true;
      setTimeout(() => { dragged = false; }, 0);
      if (!e) return;
      const r = rect(e.clientX, e.clientY);
      for (const c of grid.querySelectorAll<HTMLElement>('.fp-machine, .fp-prop')) {
        const b = c.getBoundingClientRect();
        if (b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom) continue;
        if (c.dataset.id) picked.machines.add(c.dataset.id);
        else if (c.dataset.prop) picked.props.add(c.dataset.prop);
      }
      showPicked();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('touchmove', noScroll, { passive: false });
  });
}

function machineCard(d: ArcadeDoc, m: DocMachine, held: GameMeta | null): HTMLElement {
  const p = m.place!;
  const c = el('div', null, { class: 'fp-machine', tabindex: '0', 'aria-label': m.name, 'data-id': m.id, role: 'button' });
  c.dataset.face = facingEdge(p);
  c.append(el('span', null, { class: 'fp-face', 'aria-hidden': 'true' }));
  const dark = !m.source;
  bubbleTip(c, m.name, dark ? str('arcade.host.dark_for_visitors') : '');
  putMachine(c, p);
  const art = artwork(held?.hasThumb ? held.hash : null, m.name, () => {
    if (dragged) return;
    if (editor) { picked.machines.clear(); picked.props.clear(); picked.machines.add(m.id); showPicked(); return; }
    openMachineMenu(d, m, c, held);
  });
  c.append(art);
  const rotate = iconButton(UI_ICONS.reset, str('arcade.host.rotate'), () => turn(d, m, 1, true));
  rotate.className = 'fp-rotate';
  rotate.tabIndex = -1;
  rotate.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  c.append(rotate);
  pickable(c, d, 'machines', m.id);
  if (switchedOff(m) || m.status !== 'installed') c.classList.add('fp-dim');
  c.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === c) { ev.preventDefault(); openMachineMenu(d, m, c, held); return; }
    if (ev.target !== c) return;
    if (groupHere('machines', m.id, ev)) return;
    if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); void turn(d, m, 1, true); return; }
    const n = ev.shiftKey ? FLOOR_STEP : 1;
    if (groupKey(d, ev, n, 'machines', m.id)) return;
    const to = ev.key === 'ArrowLeft' ? { ...p, col: p.col - n } : ev.key === 'ArrowRight' ? { ...p, col: p.col + n }
      : ev.key === 'ArrowUp' ? { ...p, row: p.row - n } : ev.key === 'ArrowDown' ? { ...p, row: p.row + n } : null;
    if (!to) return;
    ev.preventDefault();
    void place(d, m, {
      col: Math.max(0, Math.min(FLOOR_COLS - FLOOR_STEP, to.col)), row: Math.max(0, Math.min(FLOOR_ROWS - FLOOR_STEP, to.row)), turn: to.turn,
    }, true);
  });
  dragOn(c, groupOr(d, 'machines', m.id, {
    follow: (at) => {
      const to = placeUnder(at, turnOf(p));
      putMachine(c, to);
      return fits(d, to, m.id) ? to : null;
    },
    drop: (to) => { void place(d, m, to, false); },
    back: () => putMachine(c, p),
  }));
  return c;
}

function propName(d: ArcadeDoc, p: Prop): string {
  const k = propKind(p.kind);
  if (p.kind === 'poster') return `${k.label}: ${posterArt(p.art).label}`;
  const same = (d.props ?? []).filter((q) => q.kind === p.kind);
  return same.length > 1 ? `${k.label} ${same.indexOf(p) + 1}` : k.label;
}

const PROP_ICONS: Record<PropKind, string> = {
  barStool: '<ellipse cx="12" cy="5.5" rx="6" ry="2.5"/><path d="M8 7.5 6.5 21M16 7.5 17.5 21M7.5 15.5h9"/>',
  metalStool: '<ellipse cx="12" cy="5.5" rx="6" ry="2.5"/><path d="M8 7.5 6.5 21M16 7.5 17.5 21M7.5 15.5h9"/>',
  plantTall: '<path d="M7 14h10l-1.5 7h-7z"/><path d="M12 14V8"/><path d="M12 10.5c-3 0-5-2-5-5.5 3 0 5 2 5 5.5zM12 9c0-3.5 2-5.5 5-5.5 0 3.5-2 5.5-5 5.5z"/>',
  plantWide: '<path d="M7 14h10l-1.5 7h-7z"/><path d="M12 14V8"/><path d="M12 10.5c-3 0-5-2-5-5.5 3 0 5 2 5 5.5zM12 9c0-3.5 2-5.5 5-5.5 0 3.5-2 5.5-5 5.5z"/>',
  chalkboard: '<rect x="5" y="3" width="14" height="12" rx="1"/><path d="M7 21l2-6M17 21l-2-6M8.5 7.5h5M8.5 10.5h7"/>',
  sofa: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3z"/><path d="M12 6v9M5 18v2M19 18v2"/>',
  ottoman: '<rect x="4" y="7.5" width="16" height="9.5" rx="2.5"/><path d="M4 12h16M6.5 17v2.5M17.5 17v2.5"/>',
  armchair: '<path d="M7 11V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5"/><path d="M5 11a2 2 0 0 1 2 2v2h10v-2a2 2 0 0 1 4 0v5H3v-5a2 2 0 0 1 2-2z"/><path d="M5 18v2M19 18v2"/>',
  bench: '<rect x="2.5" y="8" width="19" height="3.5" rx="1"/><path d="M5.5 11.5V19M18.5 11.5V19M5.5 15.5h13"/>',
  posTable: '<ellipse cx="12" cy="6" rx="8" ry="2.5"/><path d="M12 8.5V20M8 20.5h8"/>',
  coffeeTable: '<ellipse cx="12" cy="10" rx="9" ry="3"/><path d="M6 12.3V18M18 12.3V18M12 13v5"/>',
  wetFloor: '<path d="M12 3 5 21h14z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  bin: '<ellipse cx="12" cy="5.5" rx="6.5" ry="2"/><path d="M5.5 5.5 7 20h10l1.5-14.5"/><path d="M10 9.5v7M14 9.5v7"/>',
  cigMachine: '<rect x="5" y="2.5" width="14" height="19" rx="1.5"/><path d="M8 6h3M8 9h3M8 12h3M14.5 6H16M14.5 9H16M8 17h8"/>',
  poster: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M4 16l5-5 4 4 3-3 4 4"/>',
};

function propCard(d: ArcadeDoc, p: Prop): HTMLElement {
  const name = propName(d, p);
  const wall = !!propKind(p.kind).wall;
  const c = el('div', null, { class: `fp-prop fp-prop-${p.kind}${wall ? ' fp-prop-wall' : ''}`, tabindex: '0', 'aria-label': name, 'data-prop': p.id, role: 'button' });
  bubbleTip(c, name, '');
  const mark = el('div', null, { class: 'fp-prop-mark', 'aria-hidden': 'true' });
  if (p.kind === 'poster') {
    const img = el('img', null, { class: 'fp-poster-art', alt: '', draggable: 'false' }) as HTMLImageElement;
    img.src = POSTER_URLS[posterArt(p.art).id];
    mark.append(img);
  } else {
    mark.append(rowIcon(PROP_ICONS[p.kind], 'fp-prop-icon', 20), el('span', propKind(p.kind).label, { class: 'fp-prop-name' }));
  }
  c.append(mark);
  putProp(c, p);
  pickable(c, d, 'props', p.id);
  c.addEventListener('click', () => {
    if (dragged) return;
    if (editor) { picked.machines.clear(); picked.props.clear(); picked.props.add(p.id); showPicked(); return; }
    openPropMenu(d, p, c);
  });
  c.addEventListener('keydown', (ev) => {
    if (ev.target !== c) return;
    if (groupHere('props', p.id, ev)) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPropMenu(d, p, c); return; }
    if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); void propTurned(d, p, true); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); void propRemoved(d, p); return; }
    if (groupKey(d, ev, ev.shiftKey ? FLOOR_STEP : 1, 'props', p.id)) return;
    const n = GEOM.cell * (ev.shiftKey ? FLOOR_STEP : 1);
    const to = ev.key === 'ArrowLeft' ? { x: p.x - n, z: p.z } : ev.key === 'ArrowRight' ? { x: p.x + n, z: p.z }
      : ev.key === 'ArrowUp' ? { x: p.x, z: p.z - n } : ev.key === 'ArrowDown' ? { x: p.x, z: p.z + n } : null;
    if (!to) return;
    ev.preventDefault();
    void propMoved(d, p, to, true);
  });
  if (propKind(p.kind).wall) {
    dragOn(c, groupOr(d, 'props', p.id, {
      follow: (at) => {
        const w = cellCentre({ col: at.col - 0.5, row: at.row - 0.5 }, GEOM);
        const to = { x: w.x - FLOOR_CENTRE.x, z: w.z - FLOOR_CENTRE.z };
        putProp(c, { ...p, ...to });
        return propFits(d, { ...p, ...to }) ? to : null;
      },
      drop: (to) => { void propMoved(d, p, to, false); },
      back: () => putProp(c, p),
    }));
    return c;
  }
  dragOn(c, groupOr(d, 'props', p.id, {
    follow: (at) => {
      const to = propPlaceUnder(at, p);
      putProp(c, { ...p, ...to });
      return propFits(d, { ...p, ...to }) ? to : null;
    },
    drop: (to) => { void propMoved(d, p, to, false); },
    back: () => putProp(c, p),
  }));
  return c;
}

const picked = { machines: new Set<string>(), props: new Set<string>() };
type PickKind = keyof typeof picked;
const pickSize = (): number => picked.machines.size + picked.props.size;
const isPicked = (kind: PickKind, id: string): boolean => picked[kind].has(id);
const pickGroup = (): FloorGroup => picked;

function showPicked(): void {
  const plans = [root(), ...(editor ? [editor.stage] : [])];
  for (const r of plans) {
    for (const c of r.querySelectorAll<HTMLElement>('.fp-machine, .fp-prop')) {
      const on = c.dataset.id ? picked.machines.has(c.dataset.id) : c.dataset.prop ? picked.props.has(c.dataset.prop) : false;
      c.classList.toggle('fp-picked', on);
    }
  }
  syncSelBar();
  drawGroupBox();
}

function clearPicked(): void {
  picked.machines.clear();
  picked.props.clear();
  showPicked();
}

function pickable(c: HTMLElement, d: ArcadeDoc, kind: PickKind, id: string): void {
  c.classList.toggle('fp-picked', isPicked(kind, id));
  c.addEventListener('click', (ev) => {
    if (!(ev.shiftKey || ev.ctrlKey || ev.metaKey || (editor && selectMode)) || dragged) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    if (picked[kind].has(id)) picked[kind].delete(id);
    else picked[kind].add(id);
    showPicked();
  }, true);
}

function groupKey(d: ArcadeDoc, ev: KeyboardEvent, n: number, kind: PickKind, id: string): boolean {
  if (pickSize() < 2 || !isPicked(kind, id)) return false;
  const dc = ev.key === 'ArrowLeft' ? -n : ev.key === 'ArrowRight' ? n : 0;
  const dr = ev.key === 'ArrowUp' ? -n : ev.key === 'ArrowDown' ? n : 0;
  if (!dc && !dr) return false;
  ev.preventDefault();
  void groupPlaced(d, dc, dr, kind, id);
  return true;
}

async function groupPlaced(d: ArcadeDoc, dc: number, dr: number, kind?: PickKind, id?: string): Promise<void> {
  if (!moveGroup(d, pickGroup(), dc, dr)) {
    if (kind) sayNoRoom();
    return;
  }
  await saveDoc();
  await render();
  onPlaced?.(placesOf(d));
  onProps?.(d.props ?? []);
  if (kind && id) planCard(kind === 'machines' ? `.fp-machine[data-id="${CSS.escape(id)}"]` : `.fp-prop[data-prop="${CSS.escape(id)}"]`)?.focus();
}

function putPicked(d: ArcadeDoc, dc: number, dr: number): void {
  const plans = [root(), ...(editor ? [editor.stage] : [])];
  for (const r of plans) {
    for (const m of d.machines) {
      if (!picked.machines.has(m.id) || !m.place) continue;
      const c = r.querySelector<HTMLElement>(`.fp-machine[data-id="${CSS.escape(m.id)}"]`);
      if (c) putMachine(c, { col: m.place.col + dc, row: m.place.row + dr });
    }
    for (const p of d.props ?? []) {
      if (!picked.props.has(p.id)) continue;
      const c = r.querySelector<HTMLElement>(`.fp-prop[data-prop="${CSS.escape(p.id)}"]`);
      if (c) putProp(c, { ...p, x: p.x + dc * GEOM.cell, z: p.z + dr * GEOM.cell });
    }
  }
}

type DragHooks<T> = { follow(at: { col: number; row: number }, from: { col: number; row: number } | null): T | null; drop(to: T): void; back(): void };

function groupOr<T>(d: ArcadeDoc, kind: PickKind, id: string, one: { follow(at: { col: number; row: number }): T | null; drop(to: T): void; back(): void }): DragHooks<T | { dc: number; dr: number }> {
  const inGroup = (): boolean => pickSize() > 1 && isPicked(kind, id);
  return {
    follow: (at, from) => {
      if (!inGroup() || !from) return one.follow(at);
      const dc = Math.round(at.col - from.col), dr = Math.round(at.row - from.row);
      putPicked(d, dc, dr);
      return groupMoved(d, pickGroup(), dc, dr) ? { dc, dr } : null;
    },
    drop: (to) => {
      if (to && typeof to === 'object' && 'dc' in to) void groupPlaced(d, to.dc, to.dr);
      else one.drop(to as T);
    },
    back: () => { if (inGroup()) putPicked(d, 0, 0); else one.back(); },
  };
}

const DRAG_PX = 6;
const HOLD_MS = 280;
let lastPointer = 'mouse';
let cancelDrag: (() => void) | null = null;
let dragged = false;

function dragOn<T>(c: HTMLElement, h: DragHooks<T>): void {
  c.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const touch = ev.pointerType !== 'mouse';
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    const grid = c.parentElement!;
    const from = pointOn(grid, x0, y0);
    let lifted = false;
    let moved = false;
    lastPointer = ev.pointerType;
    let movers: HTMLElement[] = [];
    const ghosts = new Map<HTMLElement, HTMLElement>();
    const r0 = c.getBoundingClientRect();
    const grab = { x: x0 - r0.left, y: y0 - r0.top };
    let to: T | null = null;
    let held = !touch;
    const timer = touch ? window.setTimeout(() => { held = true; lift(); showBubble(c); }, HOLD_MS) : 0;
    dragged = false;

    const lift = (): void => {
      if (lifted) return;
      lifted = true;
      try { c.setPointerCapture(ev.pointerId); } catch {  }
      c.classList.add('fp-lifted');
      document.body.classList.add('fp-dragging');
      movers = c.classList.contains('fp-picked') && pickSize() > 1 ? [...grid.querySelectorAll<HTMLElement>('.fp-picked')] : [c];
      for (const m of movers) {
        m.classList.add('fp-lifted');
        const g = el('div', null, { class: 'fp-ghost fp-dragghost', 'aria-hidden': 'true' });
        g.append(rowIcon(UI_ICONS.no, 'fp-no', 18));
        for (const k of ['left', 'top', 'width', 'height', 'transform'] as const) g.style[k] = m.style[k];
        g.style.borderRadius = getComputedStyle(m).borderRadius;
        grid.append(g);
        ghosts.set(m, g);
      }
    };
    const follow = (x: number, y: number): void => {
      const at = pointOn(grid, x, y);
      if (!at) return;
      for (const m of movers) m.style.translate = '';
      to = h.follow(at, from);
      for (const [m, g] of ghosts) {
        for (const k of ['left', 'top', 'width', 'height', 'transform'] as const) g.style[k] = m.style[k];
        g.style.borderRadius = getComputedStyle(m).borderRadius;
        g.classList.toggle('fp-blocked', to === null);
      }
      const r = c.getBoundingClientRect();
      const t = `${Math.round(x - grab.x - r.left)}px ${Math.round(y - grab.y - r.top)}px`;
      for (const m of movers) m.style.translate = t;
    };
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== ev.pointerId) return;
      const far = Math.hypot(e.clientX - x0, e.clientY - y0) > DRAG_PX;
      if (!held) {
        if (far) end(false);
        return;
      }
      if (!lifted && far) lift();
      if (lifted && far) { hideBubble(); moved = true; }
      if (lifted) follow(e.clientX, e.clientY);
    };
    const noScroll = (e: TouchEvent): void => { if (lifted) e.preventDefault(); };
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== ev.pointerId) return;
      end(e.type === 'pointerup');
    };
    const end = (drop: boolean): void => {
      clearTimeout(timer);
      cancelDrag = null;
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      removeEventListener('touchmove', noScroll);
      document.body.classList.remove('fp-dragging');
      c.classList.remove('fp-lifted', 'fp-blocked');
      for (const m of movers) { m.classList.remove('fp-lifted'); m.style.translate = ''; }
      for (const g of ghosts.values()) g.remove();
      if (touch) hideBubble();
      if (!lifted) return;
      dragged = true;
      setTimeout(() => { dragged = false; }, 0);
      if (!moved) {
        h.back();
        if (touch && drop && editor) {
          const r = c.getBoundingClientRect();
          cardMenu(c, r.left + r.width / 2, r.top + r.height / 2);
        }
        return;
      }
      if (drop && to !== null) { h.drop(to); return; }
      h.back();
      if (drop) sayNoRoom();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('touchmove', noScroll, { passive: false });
    cancelDrag = () => end(false);
  });
  c.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (editor && lastPointer === 'mouse') cardMenu(c, ev.clientX, ev.clientY);
  });
}

async function place(d: ArcadeDoc, m: DocMachine, to: Place, refocus: boolean): Promise<void> {
  if (!moveMachine(d, m.id, to)) {
    if (refocus) sayNoRoom();
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
  const group = el('div', null, { class: 'nb-group sheet-facing-group' });
  const row = el('div', null, { class: 'sheet-row sheet-facing' });
  if (off) row.classList.add('inert');
  row.append(el('span', str('arcade.host.facing'), { class: 'sheet-facing-label' }));
  const seg = el('div', null, { class: 'sheet-facing-seg', role: 'group', 'aria-label': str('arcade.host.facing') });
  for (const f of FACINGS) {
    const b = el('button', null, { class: 'sheet-facing-btn', type: 'button', 'aria-label': f.label }) as HTMLButtonElement;
    b.append(rowIcon(ARROW[f.turn], 'sheet-facing-icon', 18).firstElementChild!);
    b.setAttribute('aria-pressed', String(now(f)));
    b.addEventListener('click', () => pick(f));
    seg.append(b);
  }
  row.append(seg);
  group.append(row);
  return group;
}

const ARROW: Record<Turn, string> = {
  0: '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
  1: '<path d="M19 12H5M10.5 6.5 5 12l5.5 5.5"/>',
  2: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  3: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
};

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
  if (refocus) planCard(`.fp-machine[data-id="${CSS.escape(m.id)}"]`)?.focus();
}

async function propsChanged(d: ArcadeDoc, focus: string | null): Promise<void> {
  await saveDoc();
  await render();
  onProps?.(d.props ?? []);
  if (focus) planCard(`.fp-prop[data-prop="${CSS.escape(focus)}"]`)?.focus();
}

async function propMoved(d: ArcadeDoc, p: Prop, to: { x: number; z: number }, refocus: boolean): Promise<void> {
  if (!moveProp(d, p.id, to)) {
    if (refocus) sayNoRoom();
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
  dangerRow(del);
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
    if (!p) { if (to) sayNoRoom(); else say(str('arcade.host.there_is_no_clear_floor_for_it')); return; }
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
      const mIn = moneyInParts(f), mOut = moneyOutParts(f);
      setKvValue(inRow, mIn.head, mIn.sub);
      setKvValue(outRow, mOut.head, mOut.sub);
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

function openMachineMenu(d: ArcadeDoc, m: DocMachine, returnTo: HTMLElement, held: GameMeta | null = null): void {
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
  dangerRow(del);
  del.addEventListener('click', () => askDelete(d, m));
  showSheet(m.name, [edit, power, turnRow, dup, stats, del], returnTo);
  escapeCloses();
  const title = document.getElementById('sheet-title');
  if (title) {
    const thumb = artwork(held?.hasThumb ? held.hash : null, m.name, () => undefined);
    thumb.classList.add('ml-thumb', 'sheet-machine-thumb');
    const words = el('div', null, { class: 'sheet-machine-words' });
    title.before(thumb);
    title.replaceWith(words);
    words.append(title, statusLine(m));
  }
}

function askDelete(d: ArcadeDoc, m: DocMachine, returnTo?: HTMLElement): void {
  const ask = {
    ask: str('arcade.host.delete_n_from_this_arcade', { 0: m.name }), sub: str('arcade.host.its_settings_and_stats_go'),
    keep: str('arcade.host.keep_it'), yes: str('arcade.host.yes_delete_it'),
    onYes: () => {
      void (async () => {
        removeMachine(d, m.id);
        picked.machines.delete(m.id);
        await saveDoc();
        await refreshIn();
        say(str('arcade.host.n_was_deleted_from_this', { 0: m.name }));
      })();
    },
  };
  if (returnTo) { showSheet(m.name, [], returnTo); confirmInSheet(ask); return; }
  confirmInSheet(ask);
}

function machineState(m: DocMachine): 'off' | 'dark' | 'open' {
  return switchedOff(m) ? 'off' : !m.source ? 'dark' : 'open';
}

function statusLine(m: DocMachine): HTMLElement {
  const st = machineState(m);
  const line = el('span', null, { class: `ml-status ml-status--${st}` });
  line.append(el('span', null, { class: 'ml-dot', 'aria-hidden': 'true' }),
    st === 'off' ? str('arcade.host.powered_off') : st === 'dark' ? str('arcade.host.visitors_need_this_game') : str('arcade.host.playable_by_everyone'));
  return line;
}

function machineList(d: ArcadeDoc, byContent: Map<string, GameMeta>): HTMLElement[] {
  const ms = [...d.machines].sort((a, b) => Number(switchedOff(b)) - Number(switchedOff(a)) || a.name.localeCompare(b.name));
  const list = el('div', null, { class: 'ml-list nb-group' });
  const box = el('div', null, { class: 'ml-scroll' });
  box.append(list);
  const more = (): void => { box.classList.toggle('ml-more', box.scrollTop + box.clientHeight < box.scrollHeight - 1); };
  const fill = (): void => {
    list.replaceChildren(...ms.map((m) => machineRow(d, m, byContent.get(m.contentHash) ?? null)));
    box.hidden = !ms.length;
    more();
  };
  box.addEventListener('scroll', more);
  new ResizeObserver(more).observe(box);
  requestAnimationFrame(fill);
  fill();
  return [box];
}

function machineRow(d: ArcadeDoc, m: DocMachine, held: GameMeta | null): HTMLElement {
  const row = el('button', null, { type: 'button', class: `ml-row ml-row--${machineState(m)}`, 'data-id': m.id }) as HTMLButtonElement;
  const thumb = artwork(held?.hasThumb ? held.hash : null, m.name, () => undefined);
  thumb.classList.add('ml-thumb');
  const words = el('span', null, { class: 'ml-words' });
  words.append(el('span', m.name, { class: 'ml-name' }), statusLine(m));
  const plays = m.stats?.plays;
  row.append(thumb, words, el('span', plays ? str('arcade.host.n_plays', { n: plays }) : '\u2014', { class: 'nb-meta ml-plays' }),
    rowIcon(UI_ICONS.chevRight, 'ml-chev', 16));
  row.addEventListener('click', () => {
    openMachineMenu(d, m, row, held);
    row.classList.add('is-open');
    const sheet = document.getElementById('sheet');
    if (!sheet) return;
    const mo = new MutationObserver(() => {
      if (sheet.classList.contains('open') && document.getElementById('sheet-title')?.textContent === m.name) return;
      row.classList.remove('is-open');
      mo.disconnect();
    });
    mo.observe(sheet, { attributes: true, attributeFilter: ['class', 'hidden'] });
  });
  return row;
}

interface LayoutEditor {
  root: HTMLElement;
  stage: HTMLElement;
  meta: HTMLElement;
  bar: HTMLElement;
  d: ArcadeDoc;
  byContent: Map<string, GameMeta>;
  ro: ResizeObserver | null;
}

let editor: LayoutEditor | null = null;

const TOWARD: Record<Turn, string> = {
  0: str('arcade.host.toward_the_doors'), 1: str('arcade.host.toward_left'),
  2: str('arcade.host.toward_the_back_wall'), 3: str('arcade.host.toward_right'),
};

function openEditor(d: ArcadeDoc, byContent: Map<string, GameMeta>): void {
  if (editor) return;
  const root = el('div', null, { id: 'fpEditor', class: 'fp-editor nb-page', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fpEditTitle' });
  const head = el('div', null, { class: 'fp-editor-head' });
  const titles = el('div', null, { class: 'fp-editor-titles' });
  const meta = el('p', '', { class: 'nb-meta' });
  titles.append(el('h2', str('arcade.host.edit_layout'), { id: 'fpEditTitle' }), meta);
  const lead = el('div', null, { class: 'fp-editor-lead' });
  lead.append(titles);
  const tool = (label: string, icon: string, run: (b: HTMLButtonElement) => void): HTMLButtonElement => {
    const b = el('button', null, { type: 'button', class: 'fp-tool', 'aria-label': label }) as HTMLButtonElement;
    b.append(rowIcon(icon, 'fp-tool-icon', 18), el('span', label, { class: 'fp-tool-label' }));
    b.addEventListener('click', () => run(b));
    return b;
  };
  const bar = el('div', null, { class: 'fp-toolbar', role: 'toolbar', 'aria-label': str('arcade.host.edit_layout') });
  bar.append(
    tool(str('arcade.host.add_machine'), UI_ICONS.cabinet, () => {
      const why = cannotAdd(d);
      if (why) { say(why); return; }
      addAt(null);
    }),
    tool(str('arcade.host.add_furniture'), UI_ICONS.plus, (b) => openAddProp(d, b)),
  );
  const add = iconButton(UI_ICONS.plus, str('arcade.host.add'), () => {
    const machine = optionRow(str('arcade.host.add_machine'), '', UI_ICONS.cabinet);
    machine.addEventListener('click', () => {
      closeSheet();
      const why = cannotAdd(d);
      if (why) { say(why); return; }
      addAt(null);
    });
    const furniture = optionRow(str('arcade.host.add_furniture'), '', UI_ICONS.plus);
    furniture.addEventListener('click', () => openAddProp(d, add));
    showSheet(str('arcade.host.add'), [machine, furniture], add);
  });
  add.className = 'nb-icon-btn fp-tool-add';
  const select = el('button', null, { type: 'button', class: 'fp-tool fp-tool-select', 'aria-pressed': 'false', 'aria-label': str('arcade.host.select') }) as HTMLButtonElement;
  select.append(rowIcon(SELECT_ICON, 'fp-tool-icon', 18), el('span', str('arcade.host.select'), { class: 'fp-tool-label' }));
  select.addEventListener('click', () => {
    selectMode = !selectMode;
    select.setAttribute('aria-pressed', String(selectMode));
  });
  const done = button(str('arcade.host.done'), () => closeEditor(), { class: 'nb-btn nb-btn--primary fp-editor-done' });
  const ends = el('div', null, { class: 'fp-editor-ends' });
  ends.append(add, select, done);
  head.append(lead, bar, ends);
  const stage = el('div', null, { class: 'fp-editor-stage' });
  const picked1 = el('div', null, { class: 'fp-selbar nb-sheet', role: 'region', 'aria-label': str('arcade.host.edit_layout') });
  picked1.hidden = true;
  stage.append(picked1);
  root.append(head, stage);
  document.body.append(root);
  document.body.classList.add('fp-editing');
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fitEditor()) : null;
  ro?.observe(stage);
  editor = { root, stage, meta, bar: picked1, d, byContent, ro };
  selectMode = false;
  document.addEventListener('keydown', editorKey);
  drawEditor(d, byContent);
  requestAnimationFrame(() => root.classList.add('open'));
  done.focus({ preventScroll: true });
}

function closeEditor(): void {
  const e = editor;
  if (!e) return;
  editor = null;
  e.ro?.disconnect();
  document.removeEventListener('keydown', editorKey);
  closePickMenu();
  clearPicked();
  document.body.classList.remove('fp-editing');
  e.root.classList.remove('open');
  setTimeout(() => e.root.remove(), 220);
  dockRoot?.querySelector<HTMLElement>('.fp-preview')?.focus({ preventScroll: true });
}

function drawEditor(d: ArcadeDoc, byContent: Map<string, GameMeta>): void {
  const e = editor;
  if (!e) return;
  e.d = d;
  e.byContent = byContent;
  e.meta.textContent = `${d.name} · ${str('arcade.host.n_of_n_machines', { 0: d.machines.length, 1: ARCADE_MAX_MACHINES })}`;
  const plan = floorplan(d, byContent);
  e.stage.querySelector('.fp')?.remove();
  e.stage.prepend(plan);
  fitEditor();
  syncSelBar();
}

function fitEditor(): void {
  const e = editor;
  const grid = e?.stage.querySelector<HTMLElement>('.fp-grid');
  if (!e || !grid) return;
  const w = e.stage.clientWidth, h = e.stage.clientHeight;
  const ar = FLOOR_COLS / FLOOR_ROWS;
  const gw = Math.floor(Math.min(w, h * ar));
  grid.style.width = `${gw}px`;
  const gh = Math.floor(gw / ar);
  grid.style.height = `${gh}px`;
  e.root.style.setProperty('--fp-plan-w', `${gw}px`);
  e.root.style.setProperty('--fp-plan-h', `${gh}px`);
  drawGroupBox();
}

function syncSelBar(): void {
  const e = editor;
  if (!e) return;
  const one = picked.machines.size === 1 && picked.props.size === 0 ? [...picked.machines][0] : null;
  const m = one ? e.d.machines.find((x) => x.id === one && x.place) : undefined;
  const oneProp = picked.props.size === 1 && picked.machines.size === 0 ? [...picked.props][0] : null;
  const p = oneProp ? (e.d.props ?? []).find((x) => x.id === oneProp) : undefined;
  e.bar.hidden = !m && !p && pickSize() < 2;
  e.bar.classList.toggle('fp-selbar--multi', pickSize() > 1);
  if (pickSize() > 1) { multiBar(e.d, e.bar); return; }
  if (p) { propBar(e.d, p, e.bar); return; }
  if (!m) { e.bar.replaceChildren(); return; }
  const held = e.byContent.get(m.contentHash) ?? null;
  const thumb = artwork(held?.hasThumb ? held.hash : null, m.name, () => undefined);
  thumb.classList.add('fp-selbar-thumb');
  const words = el('div', null, { class: 'fp-selbar-words' });
  words.append(el('strong', m.name), el('span', str('arcade.host.facing_hint', { 0: TOWARD[turnOf(m.place)] }), { class: 'nb-meta' }));
  const rot = button(str('arcade.host.rotate'), () => turn(e.d, m, 1, false), { class: 'nb-btn nb-btn--sm' });
  rot.prepend(rowIcon(UI_ICONS.reset, 'fp-selbar-icon', 16).firstElementChild!);
  const del = button(str('arcade.host.delete'), () => askDelete(e.d, m, del), { class: 'nb-btn nb-btn--sm fp-selbar-delete' });
  const more = iconButton(UI_ICONS.more, str('library.more_options'), () => openMachineMenu(e.d, m, more, held));
  more.className = 'nb-icon-btn fp-selbar-more';
  const acts = el('div', null, { class: 'fp-selbar-acts' });
  acts.append(rot, del, more);
  e.bar.replaceChildren(thumb, words, acts);
}

function propBar(d: ArcadeDoc, p: Prop, bar: HTMLElement): void {
  const thumb = el('div', null, { class: 'fp-selbar-thumb fp-selbar-prop', 'aria-hidden': 'true' });
  if (p.kind === 'poster') {
    const img = el('img', null, { alt: '', draggable: 'false' }) as HTMLImageElement;
    img.src = POSTER_URLS[posterArt(p.art).id];
    thumb.append(img);
  } else thumb.append(rowIcon(PROP_ICONS[p.kind], 'fp-selbar-propicon', 24));
  const words = el('div', null, { class: 'fp-selbar-words' });
  words.append(el('strong', propName(d, p)));
  const acts = el('div', null, { class: 'fp-selbar-acts' });
  if (!propKind(p.kind).wall) {
    const rot = button(str('arcade.host.rotate'), () => { void propTurned(d, p, false); }, { class: 'nb-btn nb-btn--sm' });
    rot.prepend(rowIcon(UI_ICONS.reset, 'fp-selbar-icon', 16).firstElementChild!);
    acts.append(rot);
  }
  const del = button(str('arcade.host.delete'), () => { picked.props.delete(p.id); void propRemoved(d, p); }, { class: 'nb-btn nb-btn--sm fp-selbar-delete' });
  const more = iconButton(UI_ICONS.more, str('library.more_options'), () => openPropMenu(d, p, more));
  more.className = 'nb-icon-btn fp-selbar-more';
  acts.append(del, more);
  bar.replaceChildren(thumb, words, acts);
}

let selectMode = false;

const SELECT_ICON = '<path d="M4 4l7 16 2.5-6.5L20 11z"/>';

const ALIGN_ICONS: Record<AlignEdge, string> = {
  left: '<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="8" height="4" rx="1"/>',
  centre: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="7.5" y="14" width="9" height="4" rx="1"/>',
  right: '<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="9" y="14" width="8" height="4" rx="1"/>',
  top: '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="8" rx="1"/>',
  middle: '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="7.5" width="4" height="9" rx="1"/>',
  bottom: '<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="9" width="4" height="8" rx="1"/>',
};
const DISTRIBUTE_ICONS = {
  h: '<path d="M3 4v16M21 4v16"/><rect x="9.5" y="7" width="5" height="10" rx="1"/>',
  v: '<path d="M4 3h16M4 21h16"/><rect x="7" y="9.5" width="10" height="5" rx="1"/>',
};
const ALIGN_EDGES: AlignEdge[] = ['left', 'centre', 'right', 'top', 'middle', 'bottom'];
const ALIGN_LABELS: Record<AlignEdge, () => [string, string]> = {
  left: () => [str('arcade.host.align_left'), str('arcade.host.align_short_left')],
  centre: () => [str('arcade.host.align_centre'), str('arcade.host.align_short_centre')],
  right: () => [str('arcade.host.align_right'), str('arcade.host.align_short_right')],
  top: () => [str('arcade.host.align_top'), str('arcade.host.align_short_top')],
  middle: () => [str('arcade.host.align_middle'), str('arcade.host.align_short_middle')],
  bottom: () => [str('arcade.host.align_bottom'), str('arcade.host.align_short_bottom')],
};
const alignLabel = (a: AlignEdge, short = false): string => ALIGN_LABELS[a]()[short ? 1 : 0];

function groupHere(kind: PickKind, id: string, ev: KeyboardEvent): boolean {
  return !!editor && pickSize() > 1 && isPicked(kind, id) && ['r', 'R', 'Delete', 'Backspace'].includes(ev.key);
}

function editorKey(ev: KeyboardEvent): void {
  const e = editor;
  if (!e || ev.defaultPrevented) return;
  const t = ev.target as HTMLElement;
  if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('#sheet.open, .ui-alert, .ui-dialog, .fp-ctx')) return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && (ev.key === 'a' || ev.key === 'A')) { ev.preventDefault(); pickAll(e.d); return; }
  if (!pickSize()) return;
  if (mod && (ev.key === 'd' || ev.key === 'D')) { ev.preventDefault(); void duplicatePicked(e.d); return; }
  if (mod || ev.altKey) return;
  if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); void (ev.shiftKey ? rotatePickedAsGroup(e.d) : rotatePicked(e.d)); return; }
  if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deletePicked(e.d); }
}

function pickAll(d: ArcadeDoc): void {
  picked.machines.clear();
  picked.props.clear();
  for (const m of d.machines) if (m.place) picked.machines.add(m.id);
  for (const p of d.props ?? []) picked.props.add(p.id);
  showPicked();
}

function pickedCards(): HTMLElement[] {
  return [...(editor?.stage.querySelectorAll<HTMLElement>('.fp-grid .fp-picked') ?? [])];
}

function drawGroupBox(): void {
  const grid = editor?.stage.querySelector<HTMLElement>('.fp-grid');
  grid?.querySelector('.fp-groupbox')?.remove();
  if (!grid || pickSize() < 2) return;
  const cards = pickedCards();
  if (cards.length < 2) return;
  const g = grid.getBoundingClientRect();
  const rs = cards.map((c) => c.getBoundingClientRect());
  const box = el('div', null, { class: 'fp-groupbox', 'aria-hidden': 'true' });
  const l = Math.min(...rs.map((r) => r.left)) - g.left, t = Math.min(...rs.map((r) => r.top)) - g.top;
  const w = Math.max(...rs.map((r) => r.right)) - g.left - l, h = Math.max(...rs.map((r) => r.bottom)) - g.top - t;
  Object.assign(box.style, { left: `${l - 16}px`, top: `${t - 16}px`, width: `${w + 32}px`, height: `${h + 32}px` });
  const d = editor!.d;
  const rotate = iconButton(UI_ICONS.reset, str('arcade.host.rotate'), () => rotatePicked(d));
  rotate.className = 'fp-rotate fp-group-rotate';
  rotate.tabIndex = -1;
  rotate.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  box.append(rotate);
  grid.append(box);
}

async function arranged(d: ArcadeDoc, r: Arranged): Promise<void> {
  if (r.moved) {
    await saveDoc();
    await render();
    onPlaced?.(placesOf(d));
    onProps?.(d.props ?? []);
  }
  if (r.skipped) showToast(str('arcade.host.n_items_could_not_be_moved', { n: r.skipped }));
}

const runArrange = (d: ArcadeDoc, targets: ArrangeTarget[]): Promise<void> => arranged(d, arrange(d, targets));

async function rotatePicked(d: ArcadeDoc): Promise<void> {
  if (pickSize() === 1) {
    const m = d.machines.find((x) => picked.machines.has(x.id) && x.place);
    if (m) { await turn(d, m, 1, false); return; }
    const p = (d.props ?? []).find((x) => picked.props.has(x.id));
    if (p) await propTurned(d, p, false);
    return;
  }
  await runArrange(d, turnedEach(d, pickGroup()));
}

const rotatePickedAsGroup = (d: ArcadeDoc): Promise<void> => runArrange(d, turnedAsGroup(d, pickGroup()));

function deletePicked(d: ArcadeDoc): void {
  const ms = d.machines.filter((m) => picked.machines.has(m.id));
  const ps = (d.props ?? []).filter((p) => picked.props.has(p.id));
  const n = ms.length + ps.length;
  if (!n) return;
  if (n === 1) {
    if (ms.length) askDelete(d, ms[0], editor?.bar);
    else { picked.props.clear(); void propRemoved(d, ps[0]); }
    return;
  }
  const keep = pillButton(str('arcade.host.cancel'), () => undefined);
  const yes = pillButton(str('arcade.host.delete'), () => undefined);
  yes.classList.add('nb-btn--danger');
  openAlert({
    info: true,
    message: str('arcade.host.delete_n_items', { n }),
    buttons: [
      { button: keep, run: () => undefined },
      {
        button: yes,
        run: () => {
          void (async () => {
            for (const m of ms) removeMachine(d, m.id);
            for (const p of ps) removeProp(d, p.id);
            picked.machines.clear();
            picked.props.clear();
            await saveDoc();
            onProps?.(d.props ?? []);
            await refreshIn();
          })();
        },
      },
    ],
  });
}

const canDuplicate = (d: ArcadeDoc): boolean =>
  d.machines.some((m) => picked.machines.has(m.id) && m.status === 'installed') || (d.props ?? []).some((p) => picked.props.has(p.id));

async function duplicatePicked(d: ArcadeDoc): Promise<void> {
  if (!canDuplicate(d)) return;
  const copies = { machines: [] as string[], props: [] as string[] };
  for (const m of d.machines.filter((x) => picked.machines.has(x.id) && x.status === 'installed')) {
    let copy: DocMachine | null;
    try { copy = duplicateMachine(d, m.id); } catch (e) { say((e as Error).message); break; }
    if (copy) copies.machines.push(copy.id);
  }
  for (const p of (d.props ?? []).filter((x) => picked.props.has(x.id))) {
    const q = addProp(d, p.kind, p.art);
    if (!q) continue;
    q.yaw = p.yaw;
    copies.props.push(q.id);
  }
  if (!copies.machines.length && !copies.props.length) return;
  picked.machines.clear();
  picked.props.clear();
  for (const id of copies.machines) picked.machines.add(id);
  for (const id of copies.props) picked.props.add(id);
  await saveDoc();
  onProps?.(d.props ?? []);
  await refreshIn();
}

function sharedTurn(d: ArcadeDoc): Turn | null {
  const turns = new Set(d.machines.filter((m) => picked.machines.has(m.id) && m.place).map((m) => turnOf(m.place)));
  return turns.size === 1 ? [...turns][0] : null;
}

const pickedMachineCount = (d: ArcadeDoc): number => d.machines.filter((m) => picked.machines.has(m.id) && m.place).length;

function faceControl(d: ArcadeDoc): HTMLElement {
  const seg = el('div', null, { class: 'fp-face-seg', role: 'group', 'aria-label': str('arcade.host.face') });
  const now = sharedTurn(d);
  for (const f of FACINGS) {
    const b = el('button', null, { class: 'fp-face-btn', type: 'button', 'aria-label': f.label }) as HTMLButtonElement;
    b.append(rowIcon(ARROW[f.turn], 'fp-face-icon', 18).firstElementChild!);
    b.setAttribute('aria-pressed', String(now === f.turn));
    b.addEventListener('click', () => { closePickMenu(); void runArrange(d, facedAll(d, pickGroup(), f.turn)); });
    seg.append(b);
  }
  return seg;
}

function multiBar(d: ArcadeDoc, bar: HTMLElement): void {
  const n = pickSize();
  const stack = el('div', null, { class: 'fp-selbar-stack', 'aria-hidden': 'true' });
  const things: HTMLElement[] = [];
  for (const m of d.machines) {
    if (!picked.machines.has(m.id) || things.length >= 3) continue;
    const held = editor?.byContent.get(m.contentHash) ?? null;
    things.push(artwork(held?.hasThumb ? held.hash : null, m.name, () => undefined));
  }
  for (const p of d.props ?? []) {
    if (!picked.props.has(p.id) || things.length >= 3) continue;
    const t = el('div', null, { class: 'fp-selbar-prop' });
    t.append(rowIcon(PROP_ICONS[p.kind], 'fp-selbar-propicon', 20));
    things.push(t);
  }
  for (const t of things) { t.classList.add('fp-stack-thumb'); stack.append(t); }
  stack.append(el('span', String(n), { class: 'fp-stack-count' }));
  const words = el('div', null, { class: 'fp-selbar-words' });
  words.append(el('strong', str('arcade.host.n_selected', { n })), el('span', str('arcade.host.select_hint'), { class: 'nb-meta fp-selbar-hint' }));
  const acts = el('div', null, { class: 'fp-selbar-acts' });
  const labelled = (label: string, icon: string, run: (b: HTMLButtonElement) => void, cls = ''): HTMLButtonElement => {
    const b = button(label, () => undefined, { class: `nb-btn nb-btn--sm fp-selbar-btn ${cls}`.trim(), 'aria-label': label });
    b.textContent = '';
    b.append(rowIcon(icon, 'fp-selbar-icon', 16).firstElementChild!, el('span', label, { class: 'fp-selbar-btn-label' }));
    b.addEventListener('click', () => run(b));
    return b;
  };
  const rot = labelled(str('arcade.host.rotate'), UI_ICONS.reset, () => { void rotatePicked(d); });
  const align = labelled(str('arcade.host.align'), ALIGN_ICONS.left, (b) => openPickMenu(d, b, 'align'), 'fp-selbar-align');
  const del = labelled(str('arcade.host.delete'), UI_ICONS.trash, () => deletePicked(d), 'fp-selbar-delete');
  const more = iconButton(UI_ICONS.more, str('library.more_options'), () => openPickMenu(d, more, 'more'));
  more.className = 'nb-icon-btn fp-selbar-more';
  acts.append(rot, align, del, more);
  const parts: HTMLElement[] = [stack, words];
  if (pickedMachineCount(d)) parts.push(el('span', null, { class: 'fp-selbar-divider', 'aria-hidden': 'true' }), faceControl(d));
  bar.replaceChildren(...parts, acts);
}

function cardMenu(c: HTMLElement, x: number, y: number): void {
  const e = editor;
  if (!e) return;
  const kind: PickKind = c.dataset.id ? 'machines' : 'props';
  const id = c.dataset.id ?? c.dataset.prop;
  if (!id) return;
  if (!isPicked(kind, id)) {
    picked.machines.clear();
    picked.props.clear();
    picked[kind].add(id);
    showPicked();
  }
  openPickMenu(e.d, { x, y }, 'menu');
}

const phone = (): boolean => window.innerWidth < 700;

let pickMenu: { root: HTMLElement; close(): void } | null = null;

function closePickMenu(): void {
  pickMenu?.close();
}

function openPickMenu(d: ArcadeDoc, at: { x: number; y: number } | HTMLElement, open: 'menu' | 'more' | 'align'): void {
  closePickMenu();
  if (phone()) { pickSheet(d, at instanceof HTMLElement ? at : editor?.bar ?? document.body, open); return; }
  if (open === 'align') { popMenu(subRows(d, 'align'), at, null); return; }
  popMenu(menuRows(d, open === 'more'), at, str('arcade.host.n_selected', { n: pickSize() }));
}

type MenuRow = { label: string; icon?: string; keys?: string; danger?: boolean; disabled?: boolean; sub?: 'face' | 'align' | 'distribute'; run?: () => void } | 'divider';

function menuRows(d: ArcadeDoc, more: boolean): MenuRow[] {
  const machines = pickedMachineCount(d);
  const rows: MenuRow[] = [{ label: str('arcade.host.rotate'), keys: 'R', run: () => { void rotatePicked(d); } }];
  if (more) rows.push({ label: str('arcade.host.rotate_as_group'), keys: '⇧R', run: () => { void rotatePickedAsGroup(d); } });
  rows.push(
    { label: str('arcade.host.face'), sub: 'face', disabled: !machines },
    { label: str('arcade.host.align'), sub: 'align', disabled: pickSize() < 2 },
    { label: str('arcade.host.distribute'), sub: 'distribute', disabled: pickSize() < 3 },
    'divider',
    { label: str('arcade.host.duplicate'), keys: 'Ctrl D', disabled: !canDuplicate(d), run: () => { void duplicatePicked(d); } },
    'divider',
    { label: str('arcade.host.delete'), keys: 'Del', danger: true, run: () => deletePicked(d) },
  );
  return rows;
}

function subRows(d: ArcadeDoc, sub: 'face' | 'align' | 'distribute'): MenuRow[] {
  if (sub === 'face') {
    const now = sharedTurn(d);
    return FACINGS.map((f) => ({ label: f.label, icon: ARROW[f.turn], keys: now === f.turn ? '✓' : undefined, run: () => { void runArrange(d, facedAll(d, pickGroup(), f.turn)); } }));
  }
  if (sub === 'distribute') {
    return [
      { label: str('arcade.host.distribute_horizontally'), icon: DISTRIBUTE_ICONS.h, run: () => { void runArrange(d, distributed(d, pickGroup(), true)); } },
      { label: str('arcade.host.distribute_vertically'), icon: DISTRIBUTE_ICONS.v, run: () => { void runArrange(d, distributed(d, pickGroup(), false)); } },
    ];
  }
  const row = (a: AlignEdge): MenuRow => ({ label: alignLabel(a), icon: ALIGN_ICONS[a], run: () => { void runArrange(d, aligned(d, pickGroup(), a)); } });
  return [row('left'), row('centre'), row('right'), 'divider', row('top'), row('middle'), row('bottom')];
}

function popMenu(rows: MenuRow[], at: { x: number; y: number } | HTMLElement, head: string | null): void {
  const e = editor;
  if (!e) return;
  const menus: HTMLElement[] = [];
  const close = (): void => {
    for (const m of menus) m.remove();
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', close);
    if (pickMenu?.root === menus[0]) pickMenu = null;
  };
  const outside = (ev: PointerEvent): void => { if (!menus.some((m) => m.contains(ev.target as Node))) close(); };
  const onKey = (ev: KeyboardEvent): void => {
    const open = menus[menus.length - 1];
    const items = [...open.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (menus.length > 1) { menus.pop()!.remove(); (menus[menus.length - 1].querySelector('[aria-expanded="true"]') as HTMLElement | null)?.focus(); return; }
      close();
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (ev.key === 'ArrowLeft' && menus.length > 1) {
      ev.preventDefault();
      menus.pop()!.remove();
    } else if (ev.key === 'ArrowRight' && document.activeElement?.getAttribute('aria-haspopup')) {
      ev.preventDefault();
      (document.activeElement as HTMLElement).click();
    }
  };
  const build = (rs: MenuRow[], title: string | null, level: number): HTMLElement => {
    const m = el('div', null, { class: 'nb-menu fp-ctx', role: 'menu' });
    if (title) m.append(el('div', title, { class: 'nb-field__label fp-ctx-head' }));
    for (const r of rs) {
      if (r === 'divider') { m.append(el('div', null, { class: 'fp-ctx-divider', role: 'separator' })); continue; }
      const b = el('button', null, { type: 'button', role: 'menuitem', class: `fp-ctx-item${r.danger ? ' fp-ctx-danger' : ''}` }) as HTMLButtonElement;
      if (r.icon) b.append(rowIcon(r.icon, 'fp-ctx-icon', 18));
      b.append(el('span', r.label, { class: 'fp-ctx-label' }));
      if (r.sub) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); b.append(rowIcon(MENU_ICONS.chevRight, 'fp-ctx-chev', 16)); }
      else if (r.keys) b.append(el('span', r.keys, { class: 'fp-ctx-keys' }));
      if (r.disabled) { b.setAttribute('aria-disabled', 'true'); b.tabIndex = -1; }
      b.addEventListener('click', () => {
        if (r.disabled) return;
        if (r.sub) {
          while (menus.length > level + 1) menus.pop()!.remove();
          for (const x of m.querySelectorAll('[aria-expanded="true"]')) x.setAttribute('aria-expanded', 'false');
          b.setAttribute('aria-expanded', 'true');
          const sub = build(subRows(e.d, r.sub), null, level + 1);
          place(sub, b.getBoundingClientRect(), true);
          sub.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
          return;
        }
        close();
        r.run?.();
      });
      if (r.sub && window.matchMedia('(hover: hover)').matches) {
        b.addEventListener('pointerenter', () => { if (b.getAttribute('aria-expanded') !== 'true') b.click(); });
      }
      m.append(b);
    }
    document.body.append(m);
    menus.push(m);
    return m;
  };
  const place = (m: HTMLElement, from: DOMRect | { x: number; y: number }, side: boolean): void => {
    const plan = e.stage.querySelector<HTMLElement>('.fp-grid')?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
    const bar = e.bar.hidden ? null : e.bar.getBoundingClientRect();
    const floor = Math.min(plan.bottom, bar ? bar.top - 8 : plan.bottom);
    const w = m.offsetWidth, h = m.offsetHeight;
    let left: number, top: number;
    if (from instanceof DOMRect && side) {
      left = from.right + 4 + w <= plan.right ? from.right + 4 : from.left - 4 - w;
      top = Math.min(from.top - 6, floor - h);
    } else if (from instanceof DOMRect) {
      left = from.right - w;
      top = from.top - 8 - h;
    } else {
      left = from.x + w <= plan.right ? from.x : from.x - w;
      top = from.y + h <= floor ? from.y : from.y - h;
    }
    m.style.left = `${Math.round(Math.max(plan.left, Math.min(left, plan.right - w)))}px`;
    m.style.top = `${Math.round(Math.max(plan.top, top))}px`;
  };
  const first = build(rows, head, 0);
  place(first, at instanceof HTMLElement ? at.getBoundingClientRect() : at, false);
  first.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', onKey, true);
  addEventListener('resize', close);
  pickMenu = { root: first, close };
}

function pickSheet(d: ArcadeDoc, returnTo: HTMLElement, open: 'menu' | 'more' | 'align'): void {
  const n = pickSize();
  const title = str('arcade.host.n_selected', { n });
  const row = (label: string, run: () => void, o: { sub?: boolean; danger?: boolean; disabled?: boolean } = {}): HTMLElement => {
    const r = sheetRow(label, '', { disabled: o.disabled });
    if (o.sub) r.append(rowIcon(MENU_ICONS.chevRight, 'row-chev', 16));
    if (o.danger) dangerRow(r);
    r.addEventListener('click', () => { if (!o.disabled) run(); });
    return r;
  };
  const gap = (): HTMLElement => el('div', null, { class: 'fp-sheet-gap', 'aria-hidden': 'true' });
  const done = (run: () => void): (() => void) => () => { closeSheet(); run(); };
  const top = (): void => showSheet(title, [
    row(str('arcade.host.rotate'), done(() => { void rotatePicked(d); })),
    ...(open === 'more' ? [row(str('arcade.host.rotate_as_group'), done(() => { void rotatePickedAsGroup(d); }))] : []),
    row(str('arcade.host.face'), () => screen('face'), { sub: true, disabled: !pickedMachineCount(d) }),
    row(str('arcade.host.align'), () => screen('align'), { sub: true, disabled: n < 2 }),
    row(str('arcade.host.distribute'), () => screen('distribute'), { sub: true, disabled: n < 3 }),
    gap(),
    row(str('arcade.host.duplicate'), done(() => { void duplicatePicked(d); }), { disabled: !canDuplicate(d) }),
    gap(),
    row(str('arcade.host.delete'), done(() => deletePicked(d)), { danger: true }),
  ], returnTo);
  const screen = (which: 'face' | 'align' | 'distribute'): void => {
    const machines = pickedMachineCount(d);
    const sub = str('arcade.host.n_machines_snaps_to_the_grid', { n: machines });
    if (which === 'face') {
      const now = sharedTurn(d);
      const rows = FACINGS.map((f) => {
        const r = sheetRow(f.label, '', { icon: rowIcon(ARROW[f.turn], 'row-icon', 22).firstElementChild! });
        if (now === f.turn) r.setAttribute('aria-current', 'true');
        r.addEventListener('click', done(() => { void runArrange(d, facedAll(d, pickGroup(), f.turn)); }));
        return r;
      });
      showSheet(str('arcade.host.face'), rows, returnTo, { sub, back: top });
      return;
    }
    const grid = el('div', null, { class: `fp-arrange-grid fp-arrange-grid--${which}` });
    const tile = (label: string, icon: string, run: () => void): HTMLButtonElement => {
      const b = el('button', null, { type: 'button', class: 'fp-arrange-tile' }) as HTMLButtonElement;
      b.append(rowIcon(icon, 'fp-arrange-icon', 28), el('span', label, { class: 'fp-arrange-label' }));
      b.addEventListener('click', done(run));
      return b;
    };
    if (which === 'align') {
      for (const a of ALIGN_EDGES) grid.append(tile(alignLabel(a, true), ALIGN_ICONS[a], () => { void runArrange(d, aligned(d, pickGroup(), a)); }));
    } else {
      grid.append(
        tile(str('arcade.host.distribute_horizontally'), DISTRIBUTE_ICONS.h, () => { void runArrange(d, distributed(d, pickGroup(), true)); }),
        tile(str('arcade.host.distribute_vertically'), DISTRIBUTE_ICONS.v, () => { void runArrange(d, distributed(d, pickGroup(), false)); }),
      );
    }
    showSheet(str(which === 'align' ? 'arcade.host.align' : 'arcade.host.distribute'), [grid], returnTo, { sub, back: top });
  };
  if (open === 'align') screen('align');
  else top();
}

async function renderPicker(d: ArcadeDoc): Promise<void> {
  const page = dialogFrame('host-picker');
  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-modal', 'true');
  page.setAttribute('aria-labelledby', 'hostPickTitle');
  const head = el('div', null, { class: 'host-head nb-sheet-head' });
  head.append(el('h2', str('arcade.host.add_a_machine'), { id: 'hostPickTitle' }));
  const acts = el('div', null, { class: 'host-actions' });
  acts.append(exitButton(() => go('')));
  head.append(acts);
  const games = await listGames().catch(() => [] as GameMeta[]);
  const here = new Map<string, DocMachine[]>();
  for (const m of d.machines) here.set(m.contentHash, [...(here.get(m.contentHash) ?? []), m]);
  const copiesOf = (g: GameMeta): DocMachine[] => keysOf(g).flatMap((k) => here.get(k) ?? []);
  const free = games.filter((g) => !copiesOf(g).length);
  const sources = new SourceStore();
  const sourceOf = new Map(games.map((g) => [g.hash, librarySource(g, sources)]));
  let onlyNew = true;
  let onlySourced = games.some((g) => sourceOf.get(g.hash));
  const none = el('div');
  const grid = el('div', null, { class: 'ui-list' });
  const list = mountGameList(grid, {
    mode: 'pick',
    unplayable: unplayableReason,
    onPick: (g) => { void install(d, g, copiesOf(g)); },
    exclude: (g) => (onlyNew && copiesOf(g).length > 0) || (onlySourced && !sourceOf.get(g.hash)),
    chips: (g) => {
      const n = copiesOf(g).length;
      return n ? [chip(str('arcade.host.added_n', { n }))] : [];
    },
    onDrawn: (shown) => {
      none.replaceChildren();
      if (shown) return;
      const allHere = onlyNew && !free.length && games.length > 0;
      const noneSourced = onlySourced && !allHere && games.length > 0 && !list.search;
      none.append(emptyState({
        welcome: false,
        message: list.search && !allHere ? str('arcade.host.no_game_matches_n', { 0: list.search })
          : allHere ? str('arcade.host.every_game_in_your_library')
          : noneSourced ? str('arcade.host.no_sourced_games') : str('arcade.host.your_library_is_empty'),
        hint: allHere ? str('arcade.host.show_all_games_to_add') : games.length ? undefined : str('arcade.host.add_games_in_your_library'),
        actions: games.length ? [] : [button(str('arcade.host.open_the_library'), () => { location.href = '/'; })],
      }));
    },
  });
  const newControl = filterSwitch(str('arcade.host.not_yet_added'), onlyNew, (v) => { onlyNew = v; list.load(games); });
  const ownFilesNote = el('p', null, { class: 'host-note host-caveat nb-notice' });
  ownFilesNote.append(rowIcon(UI_ICONS.warn, 'host-caveat-icon', 14), el('span', str('arcade.host.own_files_note')));
  ownFilesNote.hidden = onlySourced;
  const sourcedControl = filterSwitch(str('arcade.host.sourced'), onlySourced, (v) => {
    onlySourced = v;
    ownFilesNote.hidden = v;
    list.load(games);
  });

  const scroll = el('div', null, { class: 'host-pick-scroll' });
  scroll.append(grid, none);
  if (list.searchButton) acts.prepend(list.searchButton);
  const controls = el('div', null, { class: 'host-pick-controls' });
  controls.append(newControl, sourcedControl);
  page.append(head, controls, ownFilesNote, scroll);
  list.load(games);
}

function filterSwitch(label: string, on: boolean, onChange: (on: boolean) => void): HTMLElement {
  const b = el('button', label, { type: 'button', class: 'nb-filter host-filter', 'aria-pressed': String(on) }) as HTMLButtonElement;
  b.addEventListener('click', () => {
    const now = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(now));
    onChange(now);
  });
  return b;
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
  const source = librarySource(g);
  const m = addMachine(d, {
    contentHash: ch, contentRule: g.contentRule ?? CONTENT_RULE, hash: g.hash, name: g.name, board: g.system,
    ...(g.programHash ? { programHash: g.programHash } : {}),
    ...(source ? { source } : {}),
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
