import {
  ARCADES_PATH, arcadeNameKey, RATING_PATH, VIEW_KEY_HEADER, VIEW_LIMIT, VISIT_PATH,
  type ArcadeSort, type ArcadeVisitReply, type RatingReply,
  type ArcadeListReply, type ArcadeListing, type ArcadeReply, type DeleteReply, type PublishBody, type PublishReply,
} from './serverwire';
import { ARCADE_DOC_VERSION, ARCADE_FORMAT, FLOOR_STEP, fromMachineState, placeAll, type ArcadeDoc, type DocMachine } from './doc';
import { getArcade, listArcades, putArcade, setCurrentArcade } from './docstore';
import { readRoomLook } from './roomlook';
import { readProps } from './proplist';
import { asPlayer, devPlayerForPage, machineUrl, seedMachine, serverFlag, serverParam } from './remote';
import { str } from '../web/i18n';
import { showToast } from '../web/ui/toast';
import type { ShareHooks } from './hostsettings';

export function roomDoc(d: ArcadeDoc): ArcadeDoc {
  const machine = (m: DocMachine): DocMachine => {
    const out: DocMachine = {
      id: m.id, contentHash: m.contentHash, contentRule: m.contentRule, name: m.name, board: m.board, status: m.status,
      config: m.config ?? {}, setup: m.setup ?? {}, balance: [], trace: m.trace ?? null, place: m.place ?? null,
    };
    if (m.gameConfig !== undefined) out.gameConfig = m.gameConfig;
    if (m.detected !== undefined) out.detected = m.detected;
    if (m.money !== undefined) out.money = m.money;
    if (m.outOfService) out.outOfService = true;
    if (m.programHash) out.programHash = m.programHash;
    return out;
  };
  const out: ArcadeDoc = {
    format: ARCADE_FORMAT, version: ARCADE_DOC_VERSION, id: d.id, name: d.name,
    createdAt: d.createdAt, updatedAt: d.updatedAt, machines: d.machines.map(machine), grid: FLOOR_STEP,
  };
  const room = readRoomLook(d.room);
  if (room) out.room = room;
  const props = readProps(d.props);
  if (props?.length) out.props = props;
  return out;
}

export function readRoomDoc(v: unknown, id: string): ArcadeDoc | null {
  const d = v as Partial<ArcadeDoc> | null;
  if (!d || d.format !== ARCADE_FORMAT || d.version !== ARCADE_DOC_VERSION || !Array.isArray(d.machines)) return null;
  const machines = d.machines.filter((m): m is DocMachine => !!m && typeof m.contentHash === 'string' && typeof m.name === 'string'
    && typeof m.board === 'string' && (m.id === undefined || typeof m.id === 'string'));
  const room = readRoomLook(d.room);
  const props = readProps(d.props);
  const out: ArcadeDoc = {
    format: ARCADE_FORMAT, version: ARCADE_DOC_VERSION, id, name: typeof d.name === 'string' ? d.name : '',
    createdAt: Number(d.createdAt) || 0, updatedAt: Number(d.updatedAt) || 0,
    machines: machines.map((m) => ({ ...m, config: m.config ?? {}, setup: m.setup ?? {}, balance: [], trace: m.trace ?? null, state: null, stats: null,
      programHash: typeof m.programHash === 'string' ? m.programHash : undefined })),
    ...(room ? { room } : {}),
    ...(props?.length ? { props } : {}),
  };
  if (Number.isInteger(d.grid)) out.grid = d.grid as number;
  placeAll(out);
  return out;
}

export function shareLink(arcadeId: string, origin: string = location.origin, server: string | null = serverParam()): string {
  const u = new URL('/arcade/', origin);
  u.searchParams.set('arcade', arcadeId);
  if (server) u.searchParams.set('server', server);
  return u.href;
}

export function floorLink(id: string): string {
  const u = new URL(shareLink(id));
  u.searchParams.set('floor', '');
  return u.href.replace(/floor=(&|$)/, 'floor$1');
}

export const HAVE_ONE = str('arcade.share.you_already_have_an_arcade');
export const NAME_TAKEN = str('arcade.share.that_name_is_taken_try');
export const TRY_AGAIN = str('arcade.share.that_did_not_go_through');

export function publishRefusal(r: PublishReply | null): string {
  if (r && !r.ok && r.why === 'taken') return NAME_TAKEN;
  if (r && !r.ok && r.why === 'limit') return HAVE_ONE;
  return TRY_AGAIN;
}

export async function offerLink(title: string, url: string): Promise<void> {
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ title, url }); return; } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast(str('arcade.host.link_copied'));
  } catch {
    showToast(url);
  }
}

export async function shareArcade(server: ArcadeServer, d: ArcadeDoc): Promise<void> {
  const r = await server.publish(d).catch(() => null);
  if (!r?.ok) { showToast(publishRefusal(r)); return; }
  await offerLink(d.name, shareLink(d.id));
}

export function shareHooks(server: ArcadeServer, d: ArcadeDoc): ShareHooks {
  const failed = (r: PublishReply | null): void => { showToast(publishRefusal(r)); };
  return {
    isPublic: async () => (d.hostKey ? (await server.resolve(d.id))?.public ?? false : false),
    setPublic: async (on) => {
      const r = await server.publish(d, { pub: on }).catch(() => null);
      if (!r?.ok) { failed(r); throw new Error('not taken'); }
      showToast(on ? str('arcade.host.your_arcade_is_on_the') : str('arcade.host.your_arcade_is_off_the'));
    },
    shareLink: () => shareArcade(server, d),
    shared: () => !!d.hostKey,
  };
}

export async function nameTakenHere(name: string, exceptId?: string): Promise<boolean> {
  const k = arcadeNameKey(name);
  return (await listArcades()).some((d) => d.id !== exceptId && arcadeNameKey(d.name ?? '') === k);
}

export function newHostKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const seeded = new Set<string>();

export class ArcadeServer {
  constructor(readonly base: string, readonly player: string, private readonly f: typeof fetch = (...a) => fetch(...a)) {}

  private async call<T>(path: string, method: string, body?: unknown): Promise<T> {
    const res = await this.f(`${this.base}${ARCADES_PATH}${path}`, {
      method,
      ...asPlayer(this.player, body === undefined ? {} : { 'content-type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status !== 200) throw new Error(`the arcade server answered ${res.status}`);
    return (await res.json()) as T;
  }

  list(sort?: ArcadeSort): Promise<ArcadeListing[]> {
    return this.call<ArcadeListReply>(sort && sort !== 'latest' ? `?sort=${sort}` : '', 'GET').then((r) => r.arcades);
  }

  visit(id: string): Promise<ArcadeVisitReply> {
    return this.call<ArcadeVisitReply>(`/${encodeURIComponent(id)}/${VISIT_PATH}`, 'POST', {});
  }

  rating(id: string): Promise<RatingReply> {
    return this.call<RatingReply>(`/${encodeURIComponent(id)}/${RATING_PATH}`, 'GET');
  }

  rate(id: string, stars: number): Promise<RatingReply> {
    return this.call<RatingReply>(`/${encodeURIComponent(id)}/${RATING_PATH}`, 'PUT', { stars });
  }

  async resolve(id: string): Promise<{ doc: ArcadeDoc; public: boolean } | null> {
    const r = await this.call<ArcadeReply>(`/${encodeURIComponent(id)}`, 'GET');
    if (!r.ok) return null;
    const doc = readRoomDoc(r.arcade.doc, id);
    if (!doc) return null;
    doc.name = r.arcade.name;
    return { doc, public: r.arcade.public };
  }

  async publish(d: ArcadeDoc, o: { pub?: boolean; room?: boolean } = {}): Promise<PublishReply> {
    if (!d.hostKey) {
      d.hostKey = newHostKey();
      await putArcade(d);
    }
    const body: PublishBody = { key: d.hostKey, name: d.name };
    if (o.pub !== undefined) body.public = o.pub;
    if (o.room !== false) body.doc = roomDoc(d);
    const r = await this.call<PublishReply>(`/${encodeURIComponent(d.id)}`, 'PUT', body);
    if (r.ok) await this.seed(d);
    return r;
  }

  private async seed(d: ArcadeDoc): Promise<void> {
    for (const m of d.machines) {
      const key = `${d.id}:${m.id}`;
      if (!m.state || seeded.has(key)) continue;
      try {
        const r = await seedMachine(machineUrl(this.base, d.id, m.id), this.player, fromMachineState(m.state, m.id), this.f);
        if (r) seeded.add(key);
      } catch (e) {
        console.warn('[arcade] could not give the server a machine\'s save', e);
      }
    }
  }

  viewUrl(id: string, viewAt: number): string {
    return `${this.base}${ARCADES_PATH}/${encodeURIComponent(id)}/view?v=${viewAt}`;
  }

  sendView(d: ArcadeDoc, view: { bytes: Uint8Array; type: string }): void {
    if (!d.hostKey || view.bytes.length > VIEW_LIMIT) return;
    const init = asPlayer(this.player, { 'content-type': view.type, [VIEW_KEY_HEADER]: d.hostKey });
    void this.f(`${this.base}${ARCADES_PATH}/${encodeURIComponent(d.id)}/view`, {
      ...init, method: 'PUT', body: view.bytes as BodyInit, keepalive: true,
    }).catch((e) => { console.warn('[arcade] could not send the arcade\'s picture', e); });
  }

  async remove(d: ArcadeDoc): Promise<DeleteReply> {
    if (!d.hostKey) return { ok: true };
    return this.call<DeleteReply>(`/${encodeURIComponent(d.id)}`, 'DELETE', { key: d.hostKey });
  }
}

export async function arcadeServer(): Promise<ArcadeServer | null> {
  const base = serverFlag();
  return base ? new ArcadeServer(base, await devPlayerForPage()) : null;
}

const sent = new Map<string, string>();

export async function syncArcade(d: ArcadeDoc): Promise<void> {
  if (!d.hostKey) return;
  const server = await arcadeServer();
  if (!server) return;
  const json = JSON.stringify([d.name, roomDoc(d)]);
  if (sent.get(d.id) === json) return;
  try {
    const r = await server.publish(d);
    if (r.ok) sent.set(d.id, json);
    else console.info(`[arcade] the server did not take this arcade's changes (${r.why})`);
  } catch (e) {
    console.warn('[arcade] could not reach the arcade server to keep this arcade up to date', e);
  }
}

export interface RoomArcade {
  doc: ArcadeDoc | null;
  visiting: boolean;
}

export async function roomArcade(search: string = location.search): Promise<RoomArcade> {
  const id = new URLSearchParams(search).get('arcade');
  if (!id) {
    const { currentArcade } = await import('./docstore');
    return { doc: await currentArcade(), visiting: false };
  }
  const own = await getArcade(id).catch(() => null);
  if (own) {
    await setCurrentArcade(id).catch(() => undefined);
    return { doc: own, visiting: false };
  }
  const server = await arcadeServer();
  if (!server) return { doc: null, visiting: true };
  try {
    return { doc: (await server.resolve(id))?.doc ?? null, visiting: true };
  } catch (e) {
    console.warn('[arcade] could not reach the arcade server for this link', e);
    return { doc: null, visiting: true };
  }
}
