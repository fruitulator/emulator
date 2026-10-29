
import type { Pending, Tokens } from './auth';
import type { TokenBox } from './client';
import type { Source, SourceIndex } from './index';

const KEY = 'fruitulator.sources';
const PENDING = 'fruitulator.sources.pending';
const BACK = 'fruitulator.sources.back';

interface Saved { hosts: SourceIndex[]; tokens: Record<string, Tokens> }

export interface Storeish { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

function defaultStore(): Storeish | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export const sourceKey = (host: string, id: string): string => `${host}#${id}`;

export function splitOrigin(origin: string | undefined): { key: string; item: string } | null {
  if (!origin) return null;
  const at = origin.lastIndexOf('#');
  if (at <= 0 || at === origin.length - 1) return null;
  const key = origin.slice(0, at);
  return key.includes('#') ? { key, item: origin.slice(at + 1) } : null;
}

export const hostOfKey = (key: string): string => key.slice(0, key.lastIndexOf('#'));

export type SignIn = Pending & { host: string; returnTo?: string };
export interface Back { host: string; sourceId: string; ok: boolean }

export class SourceStore {
  private saved: Saved;

  constructor(private readonly backing: Storeish | null = defaultStore()) {
    this.saved = this.read();
  }

  private read(): Saved {
    try {
      const j = JSON.parse(this.backing?.getItem(KEY) ?? '') as Saved;
      if (Array.isArray(j.hosts) && j.tokens && typeof j.tokens === 'object') return j;
    } catch {  }
    return { hosts: [], tokens: {} };
  }

  private write(): void {
    try { this.backing?.setItem(KEY, JSON.stringify(this.saved)); } catch {  }
  }

  hosts(): SourceIndex[] { return this.saved.hosts; }

  slugOf(key: string): string {
    const short = (k: string): string => { try { return new URL(k.split('#')[0]).hostname.replace(/^www\./i, ''); } catch { return k; } };
    const mine = short(key);
    const keys = this.hosts().flatMap((h) => h.sources.map((s) => sourceKey(h.host, s.id)));
    return keys.filter((k) => short(k) === mine).length > 1 ? key : mine;
  }

  byKey(key: string): { idx: SourceIndex; s: Source } | null {
    for (const idx of this.hosts()) for (const s of idx.sources) if (sourceKey(idx.host, s.id) === key) return { idx, s };
    return null;
  }

  keyOfSlug(slug: string): string | undefined {
    const keys = this.hosts().flatMap((h) => h.sources.map((s) => sourceKey(h.host, s.id)));
    return keys.find((k) => k === slug) ?? keys.find((k) => this.slugOf(k) === slug);
  }

  putHost(index: SourceIndex): void {
    const before = this.saved.hosts.find((h) => h.host === index.host);
    this.saved.hosts = [...this.saved.hosts.filter((h) => h.host !== index.host), index];
    for (const s of before?.sources ?? []) if (!index.sources.some((n) => n.id === s.id)) delete this.saved.tokens[sourceKey(index.host, s.id)];
    this.write();
  }

  removeHost(host: string): void {
    this.saved.hosts = this.saved.hosts.filter((h) => h.host !== host);
    for (const k of Object.keys(this.saved.tokens)) if (k.startsWith(`${host}#`)) delete this.saved.tokens[k];
    this.write();
  }

  tokenBox(host: string, id: string): TokenBox {
    const k = sourceKey(host, id);
    return {
      get: () => this.saved.tokens[k],
      set: (t) => { if (t) this.saved.tokens[k] = t; else delete this.saved.tokens[k]; this.write(); },
    };
  }

  setPending(p: SignIn | undefined): void {
    try { if (p) this.backing?.setItem(PENDING, JSON.stringify(p)); else this.backing?.removeItem(PENDING); } catch {  }
  }

  pending(): SignIn | undefined {
    try { return JSON.parse(this.backing?.getItem(PENDING) ?? '') as SignIn; } catch { return undefined; }
  }

  setBack(b: Back | undefined): void {
    try { if (b) this.backing?.setItem(BACK, JSON.stringify(b)); else this.backing?.removeItem(BACK); } catch {  }
  }

  takeBack(): Back | undefined {
    let b: Back | undefined;
    try { b = JSON.parse(this.backing?.getItem(BACK) ?? '') as Back; } catch { return undefined; }
    this.setBack(undefined);
    return b;
  }
}
