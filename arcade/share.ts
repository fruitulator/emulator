import {
  ARCADES_PATH, arcadeNameKey, ROOM_NAMED_QUERY, LEADERS_PATH, LEADERS_SITE_PATH, PLAYING_PATH, RATING_PATH, RESTORE_PATH, STATE_PATH, VIEW_KEY_HEADER, VIEW_LIMIT, VISIT_PATH,
  type ArcadeSort, type ArcadeVisitReply, type LeadersReply, type PlayingReply, type RatingReply,
  type ArcadeListReply, type ArcadeListing, type ArcadeReply, type DeleteReply, type PublishBody, type PublishReply, type RestoreReply, type ArcadeStateReply,
} from './serverwire';
import { ARCADE_DOC_VERSION, ARCADE_FORMAT, FLOOR_STEP, fromMachineState, placeAll, readMachineSource, traceId, type ArcadeDoc, type DocMachine } from './doc';
import { arcadeDeletedHere, clearArcadeDeleted, getArcade, listArcades, putArcade, setCurrentArcade } from './docstore';
import { readHostFiles } from '../web/hostfiles';
import { readRoomLook } from './roomlook';
import { readProps } from './proplist';
import { asPlayer, devPlayerForPage, machineUrl, seedMachine, serverFlag, serverParam } from './remote';
import { needLogin } from './account';
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
    if (m.hostFiles?.length) out.hostFiles = m.hostFiles;
    if (m.versions !== undefined) out.versions = m.versions;
    if (m.detected !== undefined) out.detected = m.detected;
    if (m.money !== undefined) out.money = m.money;
    if (m.outOfService) out.outOfService = true;
    if (m.programHash) out.programHash = m.programHash;
    if (m.formerContentHashes?.length) out.formerContentHashes = m.formerContentHashes;
    if (m.source) out.source = m.source;
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

export function roomToSend(d: ArcadeDoc, carry: readonly string[] = []): unknown {
  const room = roomDoc(d);
  return {
    ...room,
    machines: room.machines.map((m) => {
      if (!m.trace) return m;
      const id = traceId(m.trace);
      if (carry.includes(id)) return m;
      const { data: _data, ...named } = m.trace;
      return { ...m, trace: { ...named, id } };
    }),
  };
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
      programHash: typeof m.programHash === 'string' ? m.programHash : undefined, source: readMachineSource(m.source),
      formerContentHashes: Array.isArray(m.formerContentHashes) ? m.formerContentHashes.filter((h): h is string => typeof h === 'string') : undefined,
      hostFiles: readHostFiles(m.hostFiles) ?? undefined,
      versions: Number.isInteger(m.versions) && (m.versions as number) > 0 ? m.versions : undefined })),
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

export function carryArcadeName(id: string, name: string): void {
  try { sessionStorage.setItem('arcadeEntering', JSON.stringify({ id, name })); } catch {  }
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
  console.info(r && !r.ok ? `[arcade] the server did not take this arcade (${r.why})` : '[arcade] no answer from the server about this arcade');
  if (r && !r.ok) {
    if (r.why === 'taken') return NAME_TAKEN;
    if (r.why === 'limit') return HAVE_ONE;
    if (r.why === 'gone') return str('arcade.share.this_arcade_has_been_deleted');
    if (r.why === 'not-owner') return str('arcade.share.this_arcade_belongs_to_a');
    if (r.why === 'bad') return str('arcade.share.there_was_a_problem_saving');
  }
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
    showToast(str('arcade.host.link_copied'), { kind: 'ok' });
  } catch {
    showToast(url);
  }
}

export async function shareArcade(server: ArcadeServer, d: ArcadeDoc): Promise<void> {
  const r = await server.publish(d).catch(() => null);
  if (!r?.ok) { showToast(publishRefusal(r), { error: true, sticky: true }); return; }
  await offerLink(d.name, shareLink(d.id));
}

export function shareHooks(server: ArcadeServer, d: ArcadeDoc): ShareHooks {
  const failed = (r: PublishReply | null): void => { showToast(publishRefusal(r), { error: true, sticky: true }); };
  return {
    isPublic: async () => (d.hostKey ? (await server.resolve(d.id))?.public ?? false : false),
    setPublic: async (on) => {
      if (!(await needLogin())) throw new Error('not signed in');
      const r = await server.publish(d, { pub: on, room: false }).catch(() => null);
      if (!r?.ok) { failed(r); throw new Error('not taken'); }
      showToast(on ? str('arcade.host.your_arcade_is_on_the') : str('arcade.host.your_arcade_is_off_the'), { kind: 'ok' });
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

  playing(id: string): Promise<PlayingReply> {
    return this.call<PlayingReply>(`/${encodeURIComponent(id)}/${PLAYING_PATH}`, 'GET');
  }

  leaders(id: string, machine?: string): Promise<LeadersReply> {
    const q = machine ? `?machine=${encodeURIComponent(machine)}` : '';
    return this.call<LeadersReply>(`/${encodeURIComponent(id)}/${LEADERS_PATH}${q}`, 'GET');
  }

  async siteLeaders(): Promise<LeadersReply> {
    const res = await this.f(`${this.base}${LEADERS_SITE_PATH}`, { method: 'GET', ...asPlayer(this.player, {}) });
    if (res.status !== 200) throw new Error(`the arcade server answered ${res.status}`);
    return (await res.json()) as LeadersReply;
  }

  rate(id: string, stars: number): Promise<RatingReply> {
    return this.call<RatingReply>(`/${encodeURIComponent(id)}/${RATING_PATH}`, 'PUT', { stars });
  }

  async resolve(id: string, query = ''): Promise<{ doc: ArcadeDoc; public: boolean; at: number } | null> {
    const r = await this.call<ArcadeReply>(`/${encodeURIComponent(id)}${query}`, 'GET');
    if (!r.ok) return null;
    const doc = readRoomDoc(r.arcade.doc, id);
    if (!doc) return null;
    doc.name = r.arcade.name;
    return { doc, public: r.arcade.public, at: r.arcade.at };
  }

  async roomNow(id: string, held: ArcadeDoc): Promise<ArcadeDoc | null> {
    const r = await this.resolve(id, `?${ROOM_NAMED_QUERY}`);
    if (!r) return null;
    const have = new Map(held.machines.flatMap((m) => (m.trace ? [[traceId(m.trace), m.trace] as const] : [])));
    for (const m of r.doc.machines) {
      const name = (m.trace as { id?: unknown } | null)?.id;
      if (typeof name !== 'string') continue;
      const t = have.get(name);
      if (!t) return (await this.resolve(id))?.doc ?? null;
      m.trace = t;
    }
    return r.doc;
  }

  async publish(d: ArcadeDoc, o: { pub?: boolean; room?: boolean } = {}): Promise<PublishReply> {
    if (await arcadeDeletedHere(d.id)) return { ok: false, why: 'gone' };
    const everyTrace = (): string[] => d.machines.flatMap((m) => (m.trace ? [traceId(m.trace)] : []));
    const fresh = !d.hostKey;
    if (!d.hostKey) {
      d.hostKey = newHostKey();
      await putArcade(d);
    }
    const body: PublishBody = { key: d.hostKey, name: d.name };
    if (o.pub !== undefined) body.public = o.pub;
    if (fresh) body.doc = roomToSend(d, everyTrace());
    else if (o.room !== false) body.doc = roomToSend(d);
    const path = `/${encodeURIComponent(d.id)}`;
    let r = await this.call<PublishReply>(path, 'PUT', body);
    if (r.ok && (r.needRoom || r.needTraces?.length)) {
      r = await this.call<PublishReply>(path, 'PUT', { ...body, doc: roomToSend(d, r.needRoom ? everyTrace() : r.needTraces) });
    }
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

  sendView(d: ArcadeDoc, view: { bytes: Uint8Array; type: string }, leaving: boolean): void {
    if (!d.hostKey || view.bytes.length > (leaving ? KEEPALIVE_LIMIT : VIEW_LIMIT)) return;
    const init = asPlayer(this.player, { 'content-type': view.type, [VIEW_KEY_HEADER]: d.hostKey });
    void this.f(`${this.base}${ARCADES_PATH}/${encodeURIComponent(d.id)}/view`, {
      ...init, method: 'PUT', body: view.bytes as BodyInit, keepalive: leaving,
    }).catch((e) => { console.warn('[arcade] could not send the arcade\'s picture', e); });
  }

  async remove(d: ArcadeDoc): Promise<DeleteReply> {
    if (!d.hostKey) return { ok: true };
    return this.call<DeleteReply>(`/${encodeURIComponent(d.id)}`, 'DELETE', { key: d.hostKey });
  }

  async deleted(id: string): Promise<boolean> {
    return (await this.call<ArcadeStateReply>(`/${encodeURIComponent(id)}/${STATE_PATH}`, 'GET')).deleted;
  }

  restore(d: ArcadeDoc, name: string): Promise<RestoreReply> {
    return this.call<RestoreReply>(`/${encodeURIComponent(d.id)}/${RESTORE_PATH}`, 'POST', { key: d.hostKey, name });
  }
}

export const KEEPALIVE_LIMIT = 60 * 1024;

export async function arcadeServer(): Promise<ArcadeServer | null> {
  const base = serverFlag();
  return base ? new ArcadeServer(base, await devPlayerForPage()) : null;
}

export async function deletedArcades(server: ArcadeServer | null, docs: readonly ArcadeDoc[]): Promise<Set<string>> {
  if (!server) return new Set();
  const asked = await Promise.all(docs.filter((d) => d.hostKey).map(async (d) => (
    (await server.deleted(d.id).catch(() => false)) ? d.id : null)));
  return new Set(asked.filter((id): id is string => id !== null));
}

export async function restoreArcade(server: ArcadeServer, d: ArcadeDoc, name: string = d.name): Promise<RestoreReply | null> {
  const r = await server.restore(d, name).catch(() => null);
  if (!r?.ok) return r;
  await clearArcadeDeleted(d.id);
  d.name = name;
  await putArcade(d);
  await server.publish(d).catch((e) => { console.warn('[arcade] could not send the restored arcade\'s room', e); });
  return r;
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
  at?: number;
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
    const r = await server.resolve(id);
    return { doc: r?.doc ?? null, visiting: true, at: r?.at };
  } catch (e) {
    console.warn('[arcade] could not reach the arcade server for this link', e);
    return { doc: null, visiting: true };
  }
}
