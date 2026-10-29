
import { isLevel1 } from './template';

export const APP_ID = 'fruitulator';

export const INDEX_VERSION = 1;

export type EndpointName = 'catalogue' | 'lookup' | 'byName' | 'download' | 'categories';
export const ENDPOINTS: readonly EndpointName[] = ['catalogue', 'lookup', 'byName', 'download', 'categories'];

export const FORMATS = ['fme-catalogue', 'fme-categories', 'invision-downloads', 'invision-categories', 'invision-topics', 'invision-download', 'wait-ticket'] as const;

export interface Endpoint { url: string; format: string; root?: string; group?: string }

export interface Category { id: string; name: string; group?: string; list?: Endpoint;  all?: true }

export type Auth =
  | { type: 'none' }
  | { type: 'oidc'; issuer: string; clientId: string; scope: string }
  | { type: 'oauth2'; authorize: string; token: string; revoke?: string; clientId: string; scope: string };

export interface Banner { text: string; url?: string }

export const BANNER_MAX = 280;

export interface Source {
  id: string;
  name: string;
  thumb?: string;
  homepage?: string;
  banner?: Banner;
  auth: Auth;
  authHosts: string[];
  endpoints: Partial<Record<EndpointName, Endpoint>>;
  categories?: Category[];
}

export interface Unusable { id: string; name: string; why: 'no_client' | 'bad_auth' | 'no_endpoints' | 'bad_shape' }

export interface SourceIndex { host: string; sources: Source[]; unusable: Unusable[] }

export function hostOrigin(typed: string): string | null {
  const t = typed.trim();
  if (!t) return null;
  const bare = !/^[a-z][a-z0-9+.-]*:\/\//i.test(t);
  let u: URL;
  try { u = new URL(bare ? `${/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(t) ? 'http' : 'https'}://${t}` : t); } catch { return null; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  return u.origin;
}

function wwwOf(origin: string): string | null {
  const u = new URL(origin);
  if (!u.hostname.includes('.') || /^www\./i.test(u.hostname) || /^[\d.]+$|^\[/.test(u.hostname)) return null;
  u.hostname = `www.${u.hostname}`;
  return u.origin;
}

export function indexUrls(origin: string): string[] {
  return [`${origin}/.well-known/fme-source.json`, `${origin}/fme-source.json`];
}

export function indexAddress(typed: string): { key: string; urls: string[] } | null {
  const origin = hostOrigin(typed);
  if (!origin) return null;
  const t = typed.trim();
  const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `${origin.split('://')[0]}://${t}`);
  if (u.pathname === '/' && !u.search) {
    const www = wwwOf(origin);
    return { key: origin, urls: [...indexUrls(origin), ...(www ? indexUrls(www) : [])] };
  }
  u.hash = '';
  return { key: u.href, urls: [u.href] };
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function secure(v: unknown): v is string {
  if (!str(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch { return false; }
}

function readAuth(a: unknown): Auth | 'no_client' | 'bad_auth' {
  if (!a || typeof a !== 'object') return 'bad_auth';
  const o = a as Record<string, unknown>;
  if (o.type === 'none') return { type: 'none' };
  if (o.type !== 'oidc' && o.type !== 'oauth2') return 'bad_auth';
  const clients = o.clients && typeof o.clients === 'object' ? o.clients as Record<string, unknown> : {};
  const clientId = clients[APP_ID];
  const scope = typeof o.scope === 'string' ? o.scope : '';
  if (o.type === 'oidc') {
    if (!secure(o.issuer)) return 'bad_auth';
    return str(clientId) ? { type: 'oidc', issuer: o.issuer, clientId, scope } : 'no_client';
  }
  if (!secure(o.authorize) || !secure(o.token) || (o.revoke !== undefined && !secure(o.revoke))) return 'bad_auth';
  if (!str(clientId)) return 'no_client';
  return { type: 'oauth2', authorize: o.authorize, token: o.token, revoke: o.revoke as string | undefined, clientId, scope };
}

function readEndpoint(e: unknown): Endpoint | null {
  const url = typeof e === 'string' ? e : e && typeof e === 'object' ? (e as Record<string, unknown>).url : undefined;
  const format = e && typeof e === 'object' && str((e as Record<string, unknown>).format) ? (e as { format: string }).format : 'fme-catalogue';
  if (!secure(url) || !isLevel1(url)) return null;
  const o = e && typeof e === 'object' ? e as Record<string, unknown> : {};
  const root = typeof o.root === 'string' || typeof o.root === 'number' ? String(o.root) : undefined;
  return { url, format, ...(root ? { root } : {}), ...(str(o.group) ? { group: o.group.trim() } : {}) };
}

const known = (e: Endpoint | null): e is Endpoint => !!e && (FORMATS as readonly string[]).includes(e.format);

function readCategories(v: unknown): Category[] {
  const out: Category[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const id = typeof o.id === 'string' || typeof o.id === 'number' ? String(o.id) : '';
    const name = str(o.name) ? o.name.trim() : '';
    if (!id || !name) continue;
    const list = o.url === undefined ? null : readEndpoint(o);
    if (o.url !== undefined && !known(list)) continue;
    out.push({ id, name, ...(str(o.group) ? { group: o.group.trim() } : {}), ...(list ? { list } : {}) });
  }
  return out;
}

function readBanner(v: unknown): Banner | undefined {
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : { text: v };
  if (!str(o.text)) return undefined;
  let text = o.text.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (text.length > BANNER_MAX) {
    const cut = text.slice(0, BANNER_MAX - 1);
    text = `${cut.slice(0, cut.lastIndexOf(' ') > BANNER_MAX / 2 ? cut.lastIndexOf(' ') : cut.length)}…`;
  }
  return { text, ...(secure(o.url) ? { url: o.url } : {}) };
}

export const SOURCE_ID = 'source';

export function parseIndex(json: unknown, host: string): SourceIndex {
  if (!json || typeof json !== 'object') throw new Error('not a source file');
  const s = json as Record<string, unknown>;
  if (s.kind !== 'fme-source') throw new Error('not a source file');
  if (typeof s.version !== 'number' || Math.floor(s.version) > INDEX_VERSION) throw new Error(`source file version ${String(s.version)} is newer than this app reads`);
  const id = SOURCE_ID;
  const name = typeof s.name === 'string' ? s.name.trim() : '';
  const out = (why: Unusable['why']): SourceIndex => ({ host, sources: [], unusable: [{ id, name, why }] });
  if (!name) return out('bad_shape');
  const auth = readAuth(s.auth);
  if (typeof auth === 'string') return out(auth);
  const authHosts: string[] = [];
  for (const h of Array.isArray(s.authHosts) ? s.authHosts : []) {
    if (secure(h) && new URL(h).origin === h.replace(/\/$/, '')) authHosts.push(new URL(h).origin);
  }
  if (auth.type !== 'none' && !authHosts.length) return out('bad_auth');
  const endpoints: Source['endpoints'] = {};
  const eps = s.endpoints && typeof s.endpoints === 'object' ? s.endpoints as Record<string, unknown> : {};
  for (const n of ENDPOINTS) {
    const e = eps[n] === undefined ? null : readEndpoint(eps[n]);
    if (known(e)) endpoints[n] = e;
  }
  const categories = readCategories(s.categories);
  if (!endpoints.catalogue && !endpoints.lookup && !endpoints.byName && !categories.some((x) => x.list)) return out('no_endpoints');
  const banner = readBanner(s.banner);
  return {
    host,
    sources: [{
      id, name, auth, authHosts, endpoints,
      ...(categories.length ? { categories } : {}),
      ...(secure(s.thumb) ? { thumb: s.thumb } : {}),
      ...(secure(s.homepage) ? { homepage: s.homepage } : {}),
      ...(banner ? { banner } : {}),
    }],
    unusable: [],
  };
}

export async function fetchIndex(typed: string, fetchFn: typeof fetch = fetch): Promise<SourceIndex> {
  const at = indexAddress(typed);
  if (!at) throw new Error('bad_host');
  let blocked = false;
  for (const url of at.urls) {
    let res: Response;
    try { res = await fetchFn(url, { credentials: 'omit', cache: 'no-cache' }); } catch { blocked = true; continue; }
    if (!res.ok) continue;
    let json: unknown;
    try { json = await res.json(); } catch { continue; }
    return parseIndex(json, at.key === new URL(at.urls[0]).origin ? new URL(url).origin : at.key);
  }
  throw new Error(blocked ? 'blocked' : 'not_found');
}
