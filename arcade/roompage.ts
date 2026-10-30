import { fillProgramHashes, type Place } from './doc';
import { mountAvatar } from './avatar';
import { holdToast } from '../web/ui/toast';
import { arcadeName, loadMachines } from './machines';
import { devPlayerForPage, serverFlag, walletServer } from './remote';
import { Room } from './room';
import { openMachineList } from './machinelist';
import { watchPlaying } from './playerpills';
import { rowIcon, UI_ICONS } from '../web/ui/icons';
import { lookOf } from './roomlook';
import { decorateSection, type DecorateSection } from './decorate';
import { putArcade, updateArcadeRoom } from './docstore';
import { readProps, type Prop } from './proplist';
import { arcadeServer, KEEPALIVE_LIMIT, roomArcade, syncArcade } from './share';
import { listGames } from '../web/store';
import { VIEW_LIMIT } from './serverwire';
import { leaveArcade, RoomMenu } from './roommenu';
import { RoomSound } from './roomsound';
import { brightnessControl } from '../web/ui/brightness';
import { viewerIsHost } from './viewer';
import { Wallet } from './wallet';
import { str } from '../web/i18n';
import { fillDocSources, getMachineSet, settleSignIn } from './sourceget';
import { restampMachines } from './restamp';
import { defineMachines } from './hostset';

const host = document.getElementById('room') as HTMLElement;
const msg = document.getElementById('msg') as HTMLElement;
const statsEl = document.getElementById('stats') as HTMLElement;
const loading = document.getElementById('loading') as HTMLElement;
const loadingBar = document.getElementById('loadingBar') as HTMLElement;
const loadingTitle = document.getElementById('loadingTitle') as HTMLElement;
const menuBtn = document.getElementById('menuBtn') as HTMLButtonElement;
const avatarSlot = document.getElementById('avatarSlot') as HTMLElement;
const dpad = document.getElementById('dpad') as HTMLElement;
const padMid = document.getElementById('padMid') as HTMLButtonElement;

const RETAKE_MS = 2500;

const VIEW_W = 640;
const VIEW_H = 800;

let shownDone = -1;
const showLoading = (done: number, total: number): void => {
  if (done === shownDone) return;
  shownDone = done;
  const pct = total ? Math.round((done / total) * 100) : 100;
  loadingBar.hidden = false;
  (loadingBar.firstElementChild as HTMLElement).style.width = `${pct}%`;
  loadingBar.setAttribute('aria-valuenow', String(pct));
};
const endLoading = (): void => { loading.classList.add('done'); };

const opened = await roomArcade().catch((e) => { console.warn('[arcade] the arcade could not be read', e); return { doc: null, visiting: false }; });
const doc = opened.doc;
const isHost = viewerIsHost() && !opened.visiting;
loadingTitle.textContent = arcadeName(doc);
loadingTitle.hidden = !loadingTitle.textContent;
if (isHost && doc) {
  const defined = await listGames().then((library) => defineMachines(doc, library))
    .catch((e) => { console.warn('[arcade] the machines could not be switched on', e); return false; });
  if (defined) void putArcade(doc).then(() => syncArcade(doc)).catch((e) => console.warn('[arcade] the switched-on machines were not kept', e));
}
const [machines, name] = [await loadMachines(doc, { visiting: opened.visiting }), arcadeName(doc)];
if (isHost && doc) {
  void listGames().then(async (library) => {
    const hashes = fillProgramHashes(doc, library);
    const sources = fillDocSources(doc, library);
    const stamped = await restampMachines(doc, library);
    if (!hashes && !sources && !stamped) return;
    await putArcade(doc);
    await syncArcade(doc);
  }).catch((e) => console.warn('[arcade] the program hashes were not kept', e));
}
const openFloor = isHost && doc
  ? (placed?: (p: Map<string, Place>) => void,
    decorate?: (panel: Parameters<typeof decorateSection>[0]['panel']) => DecorateSection,
    props?: (list: Prop[]) => void,
    changed?: () => Promise<boolean>,
    dialog?: (open: boolean) => void): void => {
    void import('./host').then((h) => h.openFloorDock({ doc, placed, decorate, props, changed, dialog }));
  } : null;
const floorAsked = new URLSearchParams(location.search).has('floor');
const testPlayer = serverFlag() ? await devPlayerForPage() : '';
if (testPlayer) {
  const badge = document.createElement('span');
  badge.id = 'devPlayer';
  badge.textContent = str('arcade.roompage.test_player_n', { 0: testPlayer });
  badge.style.cssText = 'font: 12px/1 ui-monospace, monospace; padding: 4px 8px; border-radius: 6px; background: #1f6f3f; color: #fff; white-space: nowrap;';
  msg.before(badge);
}
if (!name) console.info('[arcade] this arcade has no name set, so no sign on the back wall (?name=… tries one)');
if (!doc) {
  endLoading();
  const note = document.createElement('div');
  note.className = 'room-empty';
  const text = document.createElement('p');
  text.textContent = opened.visiting ? str('arcade.roompage.this_arcade_cannot_be_found') : str('arcade.roompage.no_arcade_yet');
  note.append(text);
  if (isHost) {
    if (openFloor) {
      hostSpanner(() => openFloor());
      if (floorAsked) openFloor();
    }
  } else {
    const list = document.createElement('button');
    list.type = 'button';
    list.className = 'nb-btn';
    list.textContent = str('arcade.roompage.arcades');
    list.addEventListener('click', () => { location.href = '/arcade/'; });
    note.append(list);
  }
  document.body.append(note);
} else {
  const room = new Room(host, machines, { name, look: lookOf(doc?.room), props: readProps(doc?.props) ?? [] });
  room.onLeave = leaveArcade;
  room.getFromSource = (m, progress) => getMachineSet(m, progress, document.getElementById('hostBtn') ?? document.body);
  settleSignIn();
  const sound = new RoomSound(room.live);
  const brightness = brightnessControl({ key: 'fruitulator.arcade.brightness', apply: (pct) => room.setBrightness(pct) });
  const server = serverFlag();
  if (server) {
    const wallet = new Wallet(walletServer(server, await devPlayerForPage()));
    room.live.wallet = wallet;
    await mountAvatar(avatarSlot, { wallet, beforeDelete: async () => { room.stepBack(); await room.live.settled(); } });
    avatarSlot.hidden = false;
    void wallet.refresh();
    setInterval(() => wallet.onChange?.(), 1000);
  }
  let retake = (): void => undefined;
  if (server && isHost && doc && !doc.hostKey) {
    const arcade = await arcadeServer();
    const r = await arcade?.publish(doc).catch(() => null);
    if (r && !r.ok) {
      delete doc.hostKey;
      await putArcade(doc).catch(() => undefined);
    }
    if (!r?.ok) console.warn('[arcade] this arcade could not be put on the server, so it has no picture', r);
  }
  if (server && isHost && doc?.hostKey) {
    const arcade = await arcadeServer();
    let fresh = false;
    const send = (leaving: boolean): void => {
      if (fresh || room.locked || !arcade) return;
      const view = encodeView(room.viewShot(VIEW_W, VIEW_H), leaving ? KEEPALIVE_LIMIT : VIEW_LIMIT);
      if (!view) return;
      fresh = true;
      arcade.sendView(doc, view, leaving);
    };
    const leave = (): void => send(true);
    let timer = 0;
    retake = (): void => {
      fresh = false;
      clearTimeout(timer);
      timer = window.setTimeout(() => send(false), RETAKE_MS);
    };
    retake();
    addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') leave();
    });
  }
  const decorate = isHost && doc ? (panel: Parameters<typeof decorateSection>[0]['panel']): DecorateSection =>
    decorateSection({
      panel,
      look: lookOf(doc.room),
      apply: (l) => room.restyle(l),
      save: async (l) => {
        doc.room = l;
        const stored = await updateArcadeRoom(doc.id, l).catch((e) => { console.warn('[arcade] the room\'s look was not kept', e); return null; });
        if (stored) await syncArcade(stored);
        retake();
      },
    }) : undefined;
  const floor = openFloor ? (): void => openFloor((p) => { room.rearrange(p); retake(); }, decorate, (list) => { room.setProps(list); retake(); }, async () => { const ok = room.sync(await loadMachines(doc, { visiting: false })); retake(); return ok; },
    (open) => { room.paused = open; }) : undefined;
  if (floor) hostSpanner(floor);
  const arcadeId = opened.visiting ? new URLSearchParams(location.search).get('arcade') : null;
  const arcadeApi = arcadeId && server ? await arcadeServer() : null;
  if (arcadeApi && arcadeId) void arcadeApi.visit(arcadeId).catch((e) => console.warn('[arcade] the visit was not counted', e));
  const rating = arcadeApi && arcadeId ? {
    get: async () => { const r = await arcadeApi.rating(arcadeId).catch(() => null); return r?.ok ? r.mine : null; },
    set: async (n: number) => (await arcadeApi.rate(arcadeId, n).catch(() => null))?.ok === true,
  } : undefined;
  if (server) {
    const api = arcadeApi ?? await arcadeServer();
    if (api) watchPlaying(api, doc.id, (p) => room.setPlaying(p));
  }
  const menu = new RoomMenu(room, sound, brightness, menuBtn, isHost, rating);
  menu.update();
  if (floor && floorAsked) floor();
  const padWalk = (id: string, dir: 1 | -1): void => holdPad(byId(id), () => { room.walkHeld = dir; },
    () => { if (room.walkHeld === dir) room.walkHeld = 0; });
  const padTurn = (id: string, dir: 1 | -1): void => holdPad(byId(id), () => { room.turnHeld = dir; },
    () => { if (room.turnHeld === dir) room.turnHeld = 0; });
  padWalk('padUp', 1);
  padWalk('padDown', -1);
  padTurn('padLeft', 1);
  padTurn('padRight', -1);
  padMid.replaceChildren(rowIcon(UI_ICONS.cabinet, 'pad-icon pad-go', 24), rowIcon(UI_ICONS.back, 'pad-icon pad-leave', 24));
  padMid.addEventListener('click', () => {
    if (dpad.classList.contains('at')) room.stepBack();
    else if (!room.locked && doc) {
      void openMachineList(doc, { onGo: (ids) => { room.goToMachine(ids); } });
    }
  });
  const padAt = (at: boolean): void => {
    dpad.classList.toggle('at', at);
    const name = at ? str('arcade.roompage.leave_machine_esc') : str('arcade.machinelist.machines_in_this_arcade');
    padMid.setAttribute('aria-label', name);
    padMid.title = name;
  };
  dpad.hidden = false;
  idleFade();
  const sampleToast = import.meta.env.DEV && new URLSearchParams(location.search).has('toast');
  room.onFocus = (f) => {
    menu.update();
    padAt(!!f);
    const spanner = document.getElementById('hostBtn');
    if (spanner) spanner.hidden = !!f;
    if (sampleToast && f) {
      setTimeout(() => room.live.stopNote?.notice(str('arcade.roompage.this_is_a_test_message'), {
        label: str('arcade.roompage.carry_on'), run: () => room.live.stopNote?.clear(),
      }), 1500);
    }
  };
  const loop = (now: number): void => {
    room.frame(now);
    if (room.locked) showLoading(room.loadedCount(), room.slots.length);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  room.locked = true;
  const loaded = room.loadAll().finally(() => {
    showLoading(room.slots.length, room.slots.length);
    room.locked = false;
    room.openTimes.ready = performance.now();
    endLoading();
  });
  if (import.meta.env.DEV) {
    void Promise.all([import('./roombench'), import('../web/trace')]).then(([b, t]) => {
      const bench = b.benchMode();
      const showStats = !bench && new URLSearchParams(location.search).has('stats');
      let last = 0;
      let speedAt: { at: number; machineS: number } | null = null;
      const statsLoop = (now: number): void => {
        if (showStats && now - last > 500) {
          const ms = room.live.emu.machineS();
          const speed = speedAt ? Math.round(((ms - speedAt.machineS) / ((now - speedAt.at) / 1000)) * 100) : 0;
          speedAt = { at: now, machineS: ms };
          last = now;
          const s = room.stats();
          const p = room.perf();
          statsEl.textContent = str('arcade.roompage.n_n_fps_n_ms', { 0: str('arcade.roompage.n_ms_frame_n_glass', { 0: s.frameMs, 1: s.paints, 2: s.loaded, 3: s.cabinets, 4: s.attract, 5: s.live, 6: Math.round(room.live.emu.droppedMs()), 7: speed }), 1: p.fps, 2: p.intervalMs, 3: p.calls, 4: p.triangles, 5: p.textures, 6: p.lights, 7: p.px, 8: p.dpr, 9: p.switches, 10: p.gpu, 11: p.paints, 12: p.layoutMs, 13: p.copyMs, 14: p.renderMs });
        }
        requestAnimationFrame(statsLoop);
      };
      if (showStats) requestAnimationFrame(statsLoop);
      if (bench) void loaded.then(() => b.runBench(room, (x) => { statsEl.textContent = x; statsEl.classList.add('bench'); }));
      const recorder = new t.Recorder(b.roomTraceSource(room), 'arcade-trace');
      recorder.start();
      addEventListener('keydown', (e) => {
        if (e.key === t.TRACE_KEY) {
          e.preventDefault();
          recorder.dump((x) => { statsEl.textContent = x; statsEl.classList.add('bench'); });
          return;
        }
        if (e.key !== b.LIVE_BENCH_KEY) return;
        e.preventDefault();
        const live = holdToast();
        void b.runLiveBench(room, (x) => live.say(x));
      });
    });
  }
  (window as unknown as { __arcade: Room }).__arcade = room;
  (window as unknown as { __roomMenu: RoomMenu }).__roomMenu = menu;
}

function hostSpanner(open: () => void): void {
  const spanner = document.createElement('button');
  spanner.id = 'hostBtn';
  spanner.type = 'button';
  spanner.className = 'nb-icon-btn nb-overlay';
  spanner.setAttribute('aria-label', str('arcade.roompage.your_arcade'));
  spanner.title = str('arcade.roompage.your_arcade');
  spanner.append(rowIcon(UI_ICONS.tool, 'row-icon', 20).firstElementChild!);
  spanner.addEventListener('click', open);
  byId('bar').append(spanner);
}

function idleFade(): void {
  const IDLE_MS = 3000;
  let timer = 0;
  let down = 0;
  const idle = (): void => {
    if (down > 0) { timer = window.setTimeout(idle, IDLE_MS); return; }
    document.body.classList.add('nb-idle');
  };
  const wake = (): void => {
    document.body.classList.remove('nb-idle');
    clearTimeout(timer);
    timer = window.setTimeout(idle, IDLE_MS);
  };
  const opts = { capture: true, passive: true };
  addEventListener('pointerdown', () => { down++; wake(); }, opts);
  for (const ev of ['pointerup', 'pointercancel'] as const) addEventListener(ev, () => { down = Math.max(0, down - 1); wake(); }, opts);
  for (const ev of ['pointermove', 'touchstart', 'keydown', 'wheel'] as const) addEventListener(ev, wake, opts);
  wake();
}

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function holdPad(b: HTMLElement, start: () => void, stop: () => void): void {
  const end = (): void => {
    stop();
    b.classList.remove('held');
  };
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    start();
    b.classList.add('held');
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) b.addEventListener(ev, end);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    start();
    setTimeout(end, KEY_STEP_MS);
  });
}

function encodeView(c: HTMLCanvasElement, limit: number): { bytes: Uint8Array; type: string } | null {
  for (const [type, q] of [['image/webp', 0.75], ['image/webp', 0.5], ['image/jpeg', 0.75], ['image/jpeg', 0.5], ['image/jpeg', 0.3]] as const) {
    const url = c.toDataURL(type, q);
    if (!url.startsWith(`data:${type}`)) continue;
    const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (ch) => ch.charCodeAt(0));
    if (bytes.length <= limit) return { bytes, type };
  }
  return null;
}

const KEY_STEP_MS = 400;
