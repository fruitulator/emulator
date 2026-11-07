import { roomToSend } from './share';
import type { ArcadeDoc, DocMachine } from './doc';
import type { RoomMessage } from './serverwire';

export const ROOM_SETTLE_MS = 2000;
export const ROOM_SETTLE_MAX_MS = 10_000;

export const ARCADE_CLOSED_FLAG = 'closed';

export function leaveClosedArcade(): void {
  location.href = `/arcade/?${ARCADE_CLOSED_FLAG}`;
}

export interface RoomStanding { name: string; machines: string; look: string; props: string }

export function roomLook(d: ArcadeDoc): RoomStanding {
  const r = roomToSend(d) as ArcadeDoc;
  return { name: d.name ?? '', machines: JSON.stringify(r.machines), look: JSON.stringify(r.room ?? null), props: JSON.stringify(r.props ?? null) };
}

const same = (a: RoomStanding, b: RoomStanding): boolean => a.name === b.name && a.machines === b.machines && a.look === b.look && a.props === b.props;

export function keepPlayed(next: ArcadeDoc, shown: ArcadeDoc, played: ReadonlySet<string>): ArcadeDoc | null {
  const kept = shown.machines.filter((m) => played.has(m.id));
  if (!kept.length) return next;
  const keptIds = new Set(kept.map((m) => m.id));
  const machines: DocMachine[] = [...next.machines.filter((m) => !keptIds.has(m.id)), ...kept];
  const cells = new Set<string>();
  for (const m of machines) {
    if (!m.place) continue;
    const c = `${m.place.col},${m.place.row}`;
    if (cells.has(c)) return null;
    cells.add(c);
  }
  return { ...next, machines };
}

export interface RoomLiveHooks {
  shown(): ArcadeDoc;
  read(): Promise<ArcadeDoc | null>;
  atMachine(): boolean;
  waiting(): boolean;
  loading(): boolean;
  apply(next: ArcadeDoc, was: RoomStanding): Promise<void>;
  closed(): void | Promise<void>;
}

export class RoomLive {
  private settle: ReturnType<typeof setTimeout> | null = null;
  private firstAt = 0;
  private at: number | undefined;
  private wanted: number | undefined;
  private latest: ArcadeDoc | null = null;
  private played: ReadonlySet<string> = new Set();
  private gone = false;
  private busy = false;
  private again = false;
  private left = false;

  constructor(private readonly h: RoomLiveHooks, at?: number) { this.at = at; }

  message(m: RoomMessage): void {
    if (m.type !== 'arcade') return;
    if (m.data.gone) {
      this.gone = true;
      this.look();
      return;
    }
    this.gone = false;
    if (this.at === undefined) { this.at = m.data.at; return; }
    if (m.data.at === this.at) return;
    this.wanted = m.data.at;
    const now = Date.now();
    if (this.settle === null) this.firstAt = now;
    else clearTimeout(this.settle);
    this.settle = setTimeout(() => {
      this.settle = null;
      void this.read();
    }, Math.max(0, Math.min(ROOM_SETTLE_MS, this.firstAt + ROOM_SETTLE_MAX_MS - now)));
  }

  players(played: ReadonlySet<string>): void {
    this.played = played;
    this.look();
  }

  private async read(): Promise<void> {
    const at = this.wanted;
    const doc = await this.h.read().catch((e) => { console.warn('[arcade] the room could not be read again', e); return null; });
    if (!doc) return;
    this.at = at;
    this.latest = doc;
    this.look();
  }

  look(): void {
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    void this.step().catch((e) => console.warn('[arcade] the room could not be updated', e)).finally(() => {
      this.busy = false;
      if (this.again) { this.again = false; this.look(); }
    });
  }

  private async step(): Promise<void> {
    if (this.left || this.h.atMachine() || this.h.waiting()) return;
    if (this.gone) {
      this.left = true;
      await this.h.closed();
      return;
    }
    if (!this.latest || this.h.loading()) return;
    const shown = this.h.shown();
    if ((this.latest.updatedAt ?? 0) < (shown.updatedAt ?? 0)) { this.latest = null; return; }
    const next = keepPlayed(this.latest, shown, this.played);
    if (!next) return;
    const was = roomLook(shown);
    if (same(roomLook(next), was)) {
      if (next === this.latest) this.latest = null;
      return;
    }
    await this.h.apply(next, was);
    Object.assign(shown, next);
    if (next === this.latest) this.latest = null;
  }
}
