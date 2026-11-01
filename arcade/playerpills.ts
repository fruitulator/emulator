import * as THREE from 'three';
import { namePill } from '../web/ui/avatar';
import { avatarUrl } from './account';
import { CANVAS_OVER_GLASS_Z } from './glassflat';
import { PLAYING_POLL_MS, type MachinePlayer } from './serverwire';
import type { SocketLike } from './livelink';
import { RoomLink, roomChannelUrl } from './roomlink';
import type { RoomMessage } from './serverwire';
import type { ArcadeServer } from './share';

export interface PillPlayer { name: string; pic: string | null }

export interface PillAnchor { at: THREE.Vector3; yaw: number }

interface Pill { el: HTMLSpanElement; who: string; pos: string }

export class PlayerPills {
  private readonly el: HTMLDivElement;
  private readonly pills = new Map<string, Pill>();
  private readonly to = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'player-pills';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.style.cssText = `position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: ${CANVAS_OVER_GLASS_Z + 1};`;
    host.append(this.el);
  }

  get count(): number { return this.pills.size; }

  set(players: ReadonlyMap<string, PillPlayer>): void {
    for (const [key, p] of this.pills) {
      if (!players.has(key)) { p.el.remove(); this.pills.delete(key); }
    }
    for (const [key, who] of players) {
      const id = `${who.name}\n${who.pic ?? ''}`;
      const had = this.pills.get(key);
      if (had?.who === id) continue;
      const el = namePill(who.name, who.pic);
      el.style.cssText = 'position: absolute; left: 0; top: 0; transform: translate(-50%, -100%);';
      el.hidden = true;
      if (had) had.el.replaceWith(el); else this.el.append(el);
      this.pills.set(key, { el, who: id, pos: '' });
    }
  }

  place(camera: THREE.Camera, w: number, h: number, anchorOf: (key: string) => PillAnchor | null, hide: boolean): void {
    this.el.hidden = hide;
    if (hide) return;
    for (const [key, pill] of this.pills) {
      const a = anchorOf(key);
      let show = !!a;
      if (a) {
        const facing = this.to.subVectors(camera.position, a.at).dot(this.p.set(Math.sin(a.yaw), 0, Math.cos(a.yaw))) > 0;
        const v = this.p.copy(a.at).project(camera);
        show = facing && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
        if (show) {
          const pos = `${Math.round(((v.x + 1) / 2) * w)}px ${Math.round(((1 - v.y) / 2) * h)}px`;
          if (pos !== pill.pos) { pill.pos = pos; pill.el.style.translate = pos; }
        }
      }
      if (pill.el.hidden === show) pill.el.hidden = !show;
    }
  }
}

export function pillPlayers(server: string, playing: readonly MachinePlayer[]): Map<string, PillPlayer> {
  return new Map(playing.map((p) => [p.machine, { name: p.name, pic: avatarUrl(server, { id: p.id, name: p.name, avatarAt: p.avatarAt }) }]));
}

export const PLAYING_QUIET_MS = 5 * 60_000;

const ACTIVITY = ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const;

function browserSocket(): ((url: string) => SocketLike) | null {
  return typeof WebSocket === 'undefined' ? null : (url) => new WebSocket(url) as unknown as SocketLike;
}

export function watchPlaying(
  api: ArcadeServer, arcadeId: string, onPlayers: (p: Map<string, PillPlayer>) => void,
  open: ((url: string) => SocketLike) | null = browserSocket(),
  onMessage?: (m: RoomMessage) => void,
): () => void {
  return watchRoom(api, arcadeId, { onPlayers, onMessage, open });
}

export function watchRoom(
  api: ArcadeServer, arcadeId: string,
  o: { onPlayers?: (p: Map<string, PillPlayer>) => void; onMessage?: (m: RoomMessage) => void; open?: ((url: string) => SocketLike) | null },
): () => void {
  const { onPlayers, onMessage } = o;
  const open = o.open === undefined ? browserSocket() : o.open;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let asking = false;
  let lastActive = Date.now();
  let link: RoomLink | null = null;
  let live = false;
  const awake = (): boolean => !stopped && document.visibilityState !== 'hidden' && Date.now() - lastActive < PLAYING_QUIET_MS;
  const ask = async (): Promise<void> => {
    if (asking) return;
    if (timer) { clearTimeout(timer); timer = null; }
    if (live || !awake() || !onPlayers) return;
    asking = true;
    try {
      const r = await api.playing(arcadeId);
      if (!stopped && !live && r.ok) onPlayers?.(pillPlayers(api.base, r.playing));
    } catch (e) {
      console.info('[arcade] who is playing could not be asked', e);
    } finally {
      asking = false;
    }
    if (!stopped && !live) timer = setTimeout(() => void ask(), PLAYING_POLL_MS);
  };
  const closeLink = (): void => {
    link?.stop();
    link = null;
    live = false;
    if (quietTimer) { clearTimeout(quietTimer); quietTimer = null; }
  };
  const armQuiet = (): void => {
    quietTimer = setTimeout(() => {
      quietTimer = null;
      if (awake()) armQuiet(); else closeLink();
    }, Math.max(0, lastActive + PLAYING_QUIET_MS - Date.now()));
  };
  const wake = (): void => {
    if (!awake()) return;
    if (open && !link) {
      link = new RoomLink(roomChannelUrl(api.base, arcadeId), {
        up: () => {
          live = true;
          if (timer) { clearTimeout(timer); timer = null; }
        },
        down: () => {
          live = false;
          if (timer === null) void ask();
        },
        message: (m) => {
          if (m.type === 'playing') onPlayers?.(pillPlayers(api.base, m.data.playing));
          onMessage?.(m);
        },
      }, {
        open, now: () => Date.now(),
        setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
        setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      });
      armQuiet();
      link.start();
      return;
    }
    if ((!link || link.isDown) && timer === null && !asking) void ask();
  };
  const shown = (): void => {
    if (document.visibilityState !== 'visible') { closeLink(); return; }
    lastActive = Date.now();
    wake();
  };
  const active = (): void => {
    lastActive = Date.now();
    wake();
  };
  document.addEventListener('visibilitychange', shown);
  for (const e of ACTIVITY) window.addEventListener(e, active, { capture: true, passive: true });
  wake();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    closeLink();
    document.removeEventListener('visibilitychange', shown);
    for (const e of ACTIVITY) window.removeEventListener(e, active, { capture: true });
  };
}
