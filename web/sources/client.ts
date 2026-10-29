
import type { Endpoint, EndpointName, Category, Source } from './index';
import { refresh, type Tokens } from './auth';
import { parseCatalogue, type Catalogue, type CatSet } from './catalogue';
import { invisionCategoryPage, invisionDownloadFile, invisionCategories, parseInvisionFiles, parseInvisionTopics } from './invision';
import { expand, templateVars } from './template';
import { dropAnswers, keepAnswer, keptAnswer } from './answers';

export interface TokenBox {
  get(): Tokens | undefined;
  set(t: Tokens | undefined): void;
}

export class SourceError extends Error {
  constructor(readonly why: 'signin' | 'forbidden' | 'busy' | 'blocked' | 'missing' | 'bad_answer' | 'failed' | 'declined', readonly detail?: string) {
    super(detail ?? why);
  }
}

export interface Download { blob: Blob; name: string }

export interface DownloadSteps {
  terms?(text: string): Promise<boolean>;
  wait?(seconds: number): Promise<void>;
  start?(): void;
  progress?(fraction: number): void;
}

interface WaitInfo { files: { r: string; name: string }[]; wait: number; terms: string | null; ticket: string }

const TICKET = 'fme-download-ticket';

const ANSWER_TTL = 24 * 60 * 60_000;
const answers = new Map<string, { at: number; json: Promise<unknown> }>();

export function forgetAnswers(origins?: string[]): Promise<unknown> {
  for (const url of [...answers.keys()]) {
    let o = '';
    try { o = new URL(url).origin; } catch {  }
    if (!origins || origins.includes(o)) answers.delete(url);
  }
  return dropAnswers(origins, ANSWER_TTL);
}

export function sourceOrigins(s: Source): string[] {
  const urls = [...Object.values(s.endpoints).map((e) => e?.url), ...(s.categories ?? []).map((c) => c.list?.url)];
  const out = new Set<string>();
  for (const u of urls) { try { if (u) out.add(new URL(u).origin); } catch {  } }
  return [...out];
}

export class SourceClient {
  constructor(readonly source: Source, private readonly tokens: TokenBox, private readonly fetchFn: typeof fetch = fetch.bind(globalThis)) {}

  mayAuth(url: string): boolean {
    try { return this.source.authHosts.includes(new URL(url).origin); } catch { return false; }
  }

  signedIn(): boolean { return this.source.auth.type === 'none' || !!this.tokens.get(); }

  has(name: EndpointName): boolean { return !!this.source.endpoints[name]; }

  async fetchFor(url: string, init: RequestInit = {}, token = true): Promise<Response> {
    const send = (t: Tokens | undefined): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (t && token && this.mayAuth(url)) headers.set('Authorization', `Bearer ${t.access}`);
      return this.fetchFn(url, { ...init, headers, credentials: 'omit' });
    };
    let t = this.tokens.get();
    if (t?.expiresAt !== undefined && t.expiresAt < Date.now() + 30_000 && t.refresh) t = await this.renew(t);
    let res: Response;
    try { res = await send(t); } catch { throw new SourceError('blocked'); }
    if (res.status === 401 && token && t?.refresh && this.mayAuth(url)) {
      t = await this.renew(t);
      if (t) {
        try { res = await send(t); } catch { throw new SourceError('blocked'); }
      }
    }
    if (res.ok) return res;
    const detail = await problemDetail(res);
    if (res.status === 401) { this.tokens.set(undefined); throw new SourceError('signin', detail); }
    if (res.status === 403) throw new SourceError('forbidden', detail);
    if (res.status === 429) throw new SourceError('busy', detail);
    if (res.status === 404) throw new SourceError('missing', detail);
    throw new SourceError('failed', detail ?? String(res.status));
  }

  private async renew(t: Tokens): Promise<Tokens | undefined> {
    try {
      const next = await refresh(this.source, t, this.fetchFn);
      this.tokens.set(next);
      return next;
    } catch {
      this.tokens.set(undefined);
      return undefined;
    }
  }

  private json(url: string): Promise<unknown> {
    const held = answers.get(url);
    if (held && Date.now() - held.at < ANSWER_TTL) return held.json;
    const at = Date.now();
    const json = (async () => {
      const kept = await keptAnswer(url, ANSWER_TTL);
      if (kept) { const held = answers.get(url); if (held) held.at = kept.at; return kept.json; }
      const res = await this.fetchFor(url, { headers: { Accept: 'application/json' } });
      let j: unknown;
      try { j = await res.json() as unknown; } catch { throw new SourceError('bad_answer'); }
      keepAnswer(url, at, j);
      return j;
    })();
    answers.set(url, { at, json });
    json.catch(() => { if (answers.get(url)?.json === json) answers.delete(url); });
    return json;
  }

  private async answer(ep: Endpoint | undefined, vars: Record<string, string | number>): Promise<Catalogue> {
    if (!ep) throw new SourceError('missing');
    const j = await this.json(expand(ep.url, vars));
    try {
      return ep.format === 'invision-downloads' ? parseInvisionFiles(j) : ep.format === 'invision-topics' ? parseInvisionTopics(j) : parseCatalogue(j);
    } catch { throw new SourceError('bad_answer'); }
  }

  hasCategories(): boolean { return !!this.source.endpoints.categories || !!this.source.categories?.length; }

  async categories(): Promise<Category[]> {
    const out: Category[] = [];
    const ep = this.source.endpoints.categories;
    if (ep) {
      const group = ep.group ? { group: ep.group } : {};
      if (ep.format === 'invision-categories') {
        const cats: ReturnType<typeof invisionCategoryPage>['cats'] = [];
        for (let page = 1; page <= 20; page++) {
          const j = await this.json(expand(ep.url, { page }));
          let got: ReturnType<typeof invisionCategoryPage>;
          try { got = invisionCategoryPage(j); } catch { throw new SourceError('bad_answer'); }
          cats.push(...got.cats);
          if (page >= got.pages) break;
        }
        const tops = invisionCategories(cats, ep.root ?? '');
        if (tops.length > 1) out.push({ id: tops.map((x) => x.id).join(','), name: '', all: true, ...group });
        out.push(...tops.map((x) => ({ ...x, ...group })));
      } else {
        const j = await this.json(expand(ep.url, { page: 1 })) as Record<string, unknown> | null;
        if (!j || j.kind !== 'fme-categories' || !Array.isArray(j.categories)) throw new SourceError('bad_answer');
        const cat = this.source.endpoints.catalogue;
        if (cat && templateVars(cat.url).includes('category')) out.push({ id: '', name: '', all: true, ...group });
        for (const x of j.categories as Record<string, unknown>[]) {
          if (x && (typeof x.id === 'string' || typeof x.id === 'number') && typeof x.name === 'string' && x.name.trim()) {
            out.push({ id: String(x.id), name: x.name.trim(), ...(typeof x.group === 'string' && x.group ? { group: x.group } : group) });
          }
        }
      }
    }
    return [...out, ...(this.source.categories ?? [])];
  }

  catalogue(q: string, page = 1, category?: Category): Promise<Catalogue> {
    return this.answer(category?.list ?? this.source.endpoints.catalogue, { q, page, category: category?.id ?? '' });
  }

  lookup(sha256: string): Promise<Catalogue> { return this.answer(this.source.endpoints.lookup, { sha256: sha256.toLowerCase() }); }

  byName(name: string): Promise<Catalogue> { return this.answer(this.source.endpoints.byName, { name }); }

  async download(set: Pick<CatSet, 'id' | 'download'>, steps: DownloadSteps = {}): Promise<Download> {
    const url = set.download ?? (this.source.endpoints.download ? expand(this.source.endpoints.download.url, { id: set.id }) : undefined);
    if (!url) throw new SourceError('missing');
    if (!set.download && this.source.endpoints.download?.format === 'wait-ticket') return this.waitTicket(url, set.id, steps);
    steps.start?.();
    let res = await this.fetchFor(url);
    let from = url;
    if (!set.download && this.source.endpoints.download?.format === 'invision-download') {
      let file: { url: string; name: string };
      try { file = invisionDownloadFile(await res.json()); } catch { throw new SourceError('bad_answer'); }
      res = await this.fetchFor(file.url, {}, false);
      return { blob: await readBlob(res, steps.progress), name: file.name || fileName(res, res.url || file.url, set.id) };
    }
    if ((res.headers.get('Content-Type') ?? '').includes('json')) {
      const j = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!j || j.kind !== TICKET || typeof j.url !== 'string') throw new SourceError('bad_answer');
      if (!/^https:\/\//.test(j.url) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(j.url)) throw new SourceError('bad_answer');
      from = j.url;
      res = await this.fetchFor(from);
    }
    return { blob: await readBlob(res, steps.progress), name: fileName(res, res.url || from, set.id) };
  }

  private async waitTicket(url: string, id: string, steps: DownloadSteps): Promise<Download> {
    const post = async (fields: Record<string, string>): Promise<Response> => {
      let t = this.tokens.get();
      if (t?.expiresAt !== undefined && t.expiresAt < Date.now() + 30_000 && t.refresh) t = await this.renew(t);
      const body = new URLSearchParams(fields);
      if (t && this.mayAuth(url)) body.set('access_token', t.access);
      let res: Response;
      try { res = await this.fetchFn(url, { method: 'POST', body, credentials: 'omit' }); } catch { throw new SourceError('blocked'); }
      if (res.status === 401) { this.tokens.set(undefined); throw new SourceError('signin', await problemDetail(res)); }
      return res;
    };
    const refusal = (j: Record<string, unknown> | null, status: number): SourceError => {
      const said = j && typeof j.errorMessage === 'string' && j.errorMessage ? j.errorMessage : undefined;
      if (said) return new SourceError('forbidden', said);
      return new SourceError(status === 429 ? 'busy' : status === 404 ? 'missing' : 'failed', j && typeof j.errorCode === 'string' ? j.errorCode : String(status));
    };
    const res = await post({ action: 'info', id });
    const j = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok || !j || j.errorCode !== undefined) throw refusal(j, res.status);
    const info = readWaitInfo(j);
    if (!info) throw new SourceError('bad_answer');
    if (info.terms) {
      if (!steps.terms) throw new SourceError('failed', 'terms');
      if (!await steps.terms(info.terms)) throw new SourceError('declined');
    }
    let wait = info.wait;
    for (let tries = 0; tries < 3; tries++) {
      if (wait > 0) {
        if (!steps.wait) throw new SourceError('failed', 'wait');
        await steps.wait(wait);
      }
      const f = info.files[0];
      steps.start?.();
      const got = await post({ action: 'file', id, ticket: info.ticket, r: f.r, agree: '1' });
      if (got.ok && !(got.headers.get('Content-Type') ?? '').includes('json')) {
        return { blob: await readBlob(got, steps.progress), name: f.name || fileName(got, url, id) };
      }
      const e = await got.json().catch(() => null) as Record<string, unknown> | null;
      if (e && e.errorCode === 'WAIT' && typeof e.wait === 'number' && e.wait > 0) { wait = Math.ceil(e.wait); continue; }
      throw refusal(e, got.status);
    }
    throw new SourceError('busy');
  }
}

async function readBlob(res: Response, progress?: (fraction: number) => void): Promise<Blob> {
  const size = Number(res.headers.get('Content-Length'));
  if (!progress || !res.body || !(size > 0)) return res.blob();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  let shown = -1;
  progress(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.byteLength;
    const pct = Math.floor((got / size) * 100);
    if (pct !== shown) { shown = pct; progress(Math.min(1, got / size)); }
  }
  return new Blob(parts as BlobPart[], { type: res.headers.get('Content-Type') ?? '' });
}

function readWaitInfo(j: Record<string, unknown>): WaitInfo | null {
  const files = (Array.isArray(j.files) ? j.files : []).map((f) => f && typeof f === 'object' ? f as Record<string, unknown> : {})
    .filter((f) => f.r !== undefined && f.r !== null)
    .map((f) => ({ r: String(f.r), name: typeof f.name === 'string' ? f.name : '' }));
  if (!files.length || typeof j.ticket !== 'string' && typeof j.ticket !== 'number') return null;
  files.sort((a, b) => Number(/\.(zip|rar|7z)$/i.test(b.name)) - Number(/\.(zip|rar|7z)$/i.test(a.name)));
  const wait = typeof j.wait === 'number' && Number.isFinite(j.wait) && j.wait > 0 ? Math.ceil(j.wait) : 0;
  const terms = typeof j.terms === 'string' && j.terms.trim() ? textOf(j.terms) : null;
  return { files, wait, terms, ticket: String(j.ticket) };
}

function textOf(html: string): string {
  const withBreaks = html.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n');
  const doc = typeof DOMParser !== 'undefined' ? new DOMParser().parseFromString(withBreaks, 'text/html') : null;
  const text = doc ? doc.body.textContent ?? '' : withBreaks.replace(/<[^>]*>/g, '');
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function problemDetail(res: Response): Promise<string | undefined> {
  if (!(res.headers.get('Content-Type') ?? '').includes('json')) return undefined;
  const j = await res.json().catch(() => null) as Record<string, unknown> | null;
  return j && typeof j.detail === 'string' ? j.detail : j && typeof j.title === 'string' ? j.title : undefined;
}

function fileName(res: Response, url: string, fallback: string): string {
  const cd = res.headers.get('Content-Disposition') ?? '';
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch {  } }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  if (plain) return plain[1].trim();
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    if (/\.(zip|rar|7z)$/i.test(last)) return last;
  } catch {  }
  return `${fallback}.zip`;
}
