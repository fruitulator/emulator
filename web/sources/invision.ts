
import type { Catalogue, Machine } from './catalogue';

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£' };

export function unescapeTitle(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};

export function parseInvisionFiles(json: unknown): Catalogue {
  const doc = obj(json);
  if (!Array.isArray(doc.results)) throw new Error('not an Invision file list');
  const machines: Machine[] = [];
  for (const f of doc.results.map(obj)) {
    const id = typeof f.id === 'number' || typeof f.id === 'string' ? String(f.id) : '';
    const title = typeof f.title === 'string' ? unescapeTitle(f.title).trim() : '';
    if (!id || !title) continue;
    const author = obj(f.author).name;
    const thumb = obj(f.primaryScreenshotThumb).url ?? obj(f.primaryScreenshot).url;
    const page = f.url;
    machines.push({
      id: `file-${id}`, title,
      ...(typeof author === 'string' && author ? { authors: [author] } : {}),
      ...(typeof thumb === 'string' && /^https:\/\//.test(thumb) ? { thumb } : {}),
      ...(typeof page === 'string' && /^https:\/\//.test(page) ? { page } : {}),
      sets: [{ id, layout: '', romset: '', ...(f.canDownload === false ? { canDownload: false } : {}) }],
    });
  }
  return {
    machines, layouts: new Map(), romsets: new Map(),
    ...(typeof doc.page === 'number' ? { page: doc.page } : {}),
    ...(typeof doc.totalPages === 'number' ? { pages: doc.totalPages } : {}),
  };
}

export function invisionCategoryPage(json: unknown): { cats: { id: string; name: string; parent?: string }[]; pages: number } {
  const doc = obj(json);
  if (!Array.isArray(doc.results)) throw new Error('not an Invision category list');
  const cats = doc.results.map(obj).flatMap((c) => {
    const id = typeof c.id === 'number' || typeof c.id === 'string' ? String(c.id) : '';
    const name = typeof c.name === 'string' ? unescapeTitle(c.name).trim() : '';
    const p = c.parentId ?? obj(c.parent).id;
    return id && name ? [{ id, name, ...(typeof p === 'number' || typeof p === 'string' ? { parent: String(p) } : {}) }] : [];
  });
  return { cats, pages: typeof doc.totalPages === 'number' ? doc.totalPages : 1 };
}

export function invisionCategories(cats: { id: string; name: string; parent?: string }[], root: string): { id: string; name: string }[] {
  const under = (id: string): string[] => {
    const ids = [id];
    for (let i = 0; i < ids.length; i++) for (const c of cats) if (c.parent === ids[i] && !ids.includes(c.id)) ids.push(c.id);
    return ids;
  };
  let tops = cats.filter((c) => c.parent === root);
  if (!tops.length && cats.every((c) => c.parent === undefined || c.parent === '0')) tops = cats.filter((c) => c.id !== root);
  return tops.map((c) => ({ id: under(c.id).join(','), name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function parseInvisionTopics(json: unknown): Catalogue {
  const doc = obj(json);
  if (!Array.isArray(doc.results)) throw new Error('not an Invision topic list');
  const machines: Machine[] = [];
  for (const t of doc.results.map(obj)) {
    const id = typeof t.id === 'number' || typeof t.id === 'string' ? String(t.id) : '';
    const title = typeof t.title === 'string' ? unescapeTitle(t.title).trim() : '';
    if (!id || !title) continue;
    const post = obj(t.firstPost);
    const html = typeof post.content === 'string' ? post.content : '';
    const files = [...new Set([...html.matchAll(/[?&/]files\/file\/(\d+)-/g)].map((m) => m[1]))];
    const attached = files.length ? [] : threadAttachments(html);
    if (!files.length && !attached.length) continue;
    const author = obj(post.author).name;
    const img = /<img[^>]+src="(https:\/\/[^"]+)"/.exec(html)?.[1];
    machines.push({
      id: `topic-${id}`, title,
      ...(typeof author === 'string' && author ? { authors: [author] } : {}),
      ...(img ? { thumb: img } : {}),
      ...(typeof t.url === 'string' && /^https:\/\//.test(t.url) ? { page: t.url } : {}),
      sets: files.length
        ? files.map((f) => ({ id: f, layout: '', romset: '' }))
        : attached.map((a) => ({
          id: `${ATTACHMENT}${a.id}`, layout: '', romset: '',
          ...(/\.(zip|rar|7z)$/i.test(a.name) ? { file: a.name } : {}),
          ...(attached.length > 1 ? { config: { variant: a.name } } : {}),
        })),
    });
  }
  return {
    machines, layouts: new Map(), romsets: new Map(),
    ...(typeof doc.page === 'number' ? { page: doc.page } : {}),
    ...(typeof doc.totalPages === 'number' ? { pages: doc.totalPages } : {}),
  };
}

export const ATTACHMENT = 'attachment-';

function threadAttachments(html: string): { id: string; name: string }[] {
  const all: { id: string; name: string; game: boolean }[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const id = /attachment\.php\?(?:[^"'>]*?&(?:amp;)?)?id=(\d+)/i.exec(m[1])?.[1];
    if (!id || /<img\b/i.test(m[2]) || all.some((a) => a.id === id)) continue;
    const name = unescapeTitle(m[2].replace(/<[^>]*>/g, '')).trim();
    const ext = /data-fileext=["']?([a-z0-9]+)/i.exec(m[1])?.[1] ?? '';
    all.push({ id, name, game: /\.(zip|rar|gam)$/i.test(name) || /^(zip|rar|gam)$/i.test(ext) });
  }
  const games = all.some((a) => a.game) ? all.filter((a) => a.game)
    : all.filter((a) => !/\.(txt|pdf|docx?|rtf|jpe?g|png|gif|bmp|webp)$/i.test(a.name));
  return games.map(({ id, name }) => ({ id, name }));
}

export function invisionDownloadFile(json: unknown): { url: string; name: string } {
  const files = (Array.isArray(obj(json).files) ? obj(json).files as unknown[] : []).map(obj)
    .filter((f) => typeof f.url === 'string' && /^https:\/\//.test(f.url))
    .map((f) => ({ url: f.url as string, name: typeof f.name === 'string' ? f.name : '' }));
  const pick = files.find((f) => /\.(zip|rar|7z)$/i.test(f.name)) ?? files[0];
  if (!pick) throw new Error('no file');
  return pick;
}
