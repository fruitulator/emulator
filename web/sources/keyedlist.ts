
import type { Catalogue, CatSet, Machine } from './catalogue';
import { ATTACHMENT, unescapeTitle } from './invision';

export interface KeyedItem { id: string; key: string; machine: Machine }
export interface KeyedList { at: number | string; items: KeyedItem[] }

export const KEYED_PAGE = 48;

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const https = (v: unknown): v is string => typeof v === 'string' && /^https:\/\//.test(v);

function readItem(raw: unknown): KeyedItem | null {
  const f = obj(raw);
  const id = typeof f.id === 'number' || typeof f.id === 'string' ? String(f.id) : '';
  const title = typeof f.title === 'string' ? unescapeTitle(f.title).trim() : '';
  const key = typeof f.key === 'string' ? f.key : '';
  if (!id || !title || !key) return null;
  const locked = f.canDownload === false ? { canDownload: false as const } : {};
  let sets: CatSet[];
  if (f.topic === true) {
    const atts = (Array.isArray(f.attachments) ? f.attachments : []).map(obj).filter((a) => a.game !== false).flatMap((a) => {
      const n = typeof a.url === 'string' ? /attachment\.php\?(?:[^#]*?&(?:amp;)?)?id=(\d+)/i.exec(a.url)?.[1] : undefined;
      const name = typeof a.name === 'string' ? a.name.trim() : '';
      return n ? [{ n, name }] : [];
    });
    sets = atts.map((a) => ({
      id: `${ATTACHMENT}${a.n}`, layout: '', romset: '', ...locked,
      ...(/\.(zip|rar|7z)$/i.test(a.name) ? { file: a.name } : {}),
      ...(atts.length > 1 && a.name ? { config: { variant: a.name } } : {}),
    }));
  } else {
    sets = [{ id, layout: '', romset: '', ...locked }];
  }
  const author = obj(f.author).name;
  const thumb = obj(f.primaryScreenshotThumb).url;
  const where = typeof f.where === 'string' ? unescapeTitle(f.where).trim() : '';
  const version = typeof f.version === 'string' || typeof f.version === 'number' ? String(f.version).trim() : '';
  return {
    id, key: key.toLowerCase(),
    machine: {
      id: `${f.topic === true ? 'topic' : 'file'}-${id}`, title, sets,
      ...(where ? { maker: where } : {}),
      ...(version ? { edition: version } : {}),
      ...(typeof author === 'string' && author ? { authors: [author] } : {}),
      ...(https(thumb) ? { thumb } : {}),
      ...(https(f.url) ? { page: f.url } : {}),
    },
  };
}

export function mergeKeyedList(held: KeyedList | undefined, json: unknown): KeyedList {
  const doc = obj(json);
  if (doc.unchanged === true) {
    if (!held) throw new Error('unchanged, but nothing is held');
    return held;
  }
  if (!Array.isArray(doc.items) || (typeof doc.at !== 'number' && typeof doc.at !== 'string')) throw new Error('not a keyed list');
  const items = doc.items.map(readItem).filter((x): x is KeyedItem => !!x);
  if (doc.full !== false || !held) return { at: doc.at, items };
  const byId = new Map(held.items.map((x) => [x.id, x]));
  for (const x of items) byId.set(x.id, x);
  return { at: doc.at, items: [...byId.values()] };
}

export function readHeld(v: unknown): KeyedList | undefined {
  const o = obj(v);
  if ((typeof o.at !== 'number' && typeof o.at !== 'string') || !Array.isArray(o.items)) return undefined;
  return { at: o.at, items: o.items as KeyedItem[] };
}

export function searchWords(q: string): string[] {
  return q.toLowerCase().replace(/['\u2018\u2019`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(Boolean);
}

export function keyMatches(key: string, words: string[]): boolean {
  return words.every((w) => key.includes(` ${w}`));
}

export function searchKeyedList(list: KeyedList, q: string, page = 1): Catalogue {
  const words = searchWords(q);
  const hits = list.items.filter((x) => words.length > 0 && keyMatches(x.key, words))
    .map((x) => x.machine).sort((a, b) => a.title.localeCompare(b.title));
  const pages = Math.max(1, Math.ceil(hits.length / KEYED_PAGE));
  return { machines: hits.slice((page - 1) * KEYED_PAGE, page * KEYED_PAGE), layouts: new Map(), romsets: new Map(), page, pages };
}
