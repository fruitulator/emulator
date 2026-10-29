import enGB from './locales/en-GB.json';

export type Entry = string | Partial<Record<Intl.LDMLPluralRule, string>>;

export interface Language { code: string; short: string; name: string }

export const LANGUAGES: readonly Language[] = [
  { code: 'en-GB', short: 'EN', name: 'English' },
  { code: 'de', short: 'DE', name: 'Deutsch' },
  { code: 'fr', short: 'FR', name: 'Français' },
  { code: 'nl', short: 'NL', name: 'Nederlands' },
];

const LANG_KEY = 'fruitulator.lang';
const WORKER_PREFIX = 'lang=';

export function matchLanguage(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const t = tag.toLowerCase();
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === t);
  if (exact) return exact.code;
  const base = t.split('-')[0];
  return LANGUAGES.find((l) => l.code.toLowerCase().split('-')[0] === base)?.code ?? null;
}

const PAGE = typeof document !== 'undefined';
const WORKER = !PAGE && typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined';

function chosen(): string | null {
  if (PAGE) {
    try { return matchLanguage(localStorage.getItem(LANG_KEY)); } catch { return null;  }
  }
  const name = (globalThis as { name?: unknown }).name;
  if (typeof name === 'string' && name.startsWith(WORKER_PREFIX)) return matchLanguage(name.slice(WORKER_PREFIX.length).split(';')[0]);
  return null;
}

function browserLanguage(): string | null {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  for (const tag of nav?.languages ?? (nav?.language ? [nav.language] : [])) {
    const m = matchLanguage(tag);
    if (m) return m;
  }
  return null;
}

export const LANG: string = PAGE || WORKER ? chosen() ?? browserLanguage() ?? 'en-GB' : 'en-GB';

const LOADERS = import.meta.glob<Record<string, Entry>>(['./locales/*.json', '!./locales/en-GB.json'], { import: 'default' });

async function catalogueFor(code: string): Promise<Record<string, Entry>> {
  const load = LOADERS[`./locales/${code}.json`];
  if (code === 'en-GB' || !load) return enGB;
  try {
    return { ...enGB, ...(await load()) };
  } catch (e) {
    console.warn(`[i18n] the ${code} catalogue could not be loaded; showing English`, e);
    return enGB;
  }
}

let CATALOGUE: Record<string, Entry> = enGB;
if (PAGE) CATALOGUE = await catalogueFor(LANG);
else if (LANG !== 'en-GB') void catalogueFor(LANG).then((c) => { CATALOGUE = c; });
const plurals = new Intl.PluralRules(LANG);

export function currentLanguage(): Language {
  return LANGUAGES.find((l) => l.code === LANG) ?? LANGUAGES[0];
}

export function setLanguage(code: string): void {
  if (code === LANG) return;
  try { localStorage.setItem(LANG_KEY, code); } catch {  }
  location.reload();
}

export function workerName(label: string): string {
  return `${WORKER_PREFIX}${LANG};${label}`;
}

export function hasStr(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATALOGUE, key);
}

export function str(key: string, args?: Record<string | number, string | number>): string {
  const entry = CATALOGUE[key];
  if (entry === undefined) return key;
  let text: string;
  if (typeof entry === 'string') text = entry;
  else {
    const n = typeof args?.n === 'number' ? args.n : undefined;
    text = (n === undefined ? undefined : entry[plurals.select(n)]) ?? entry.other ?? key;
  }
  if (!args) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in args ? String(args[k]) : m));
}

const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'] as const;

export function applyStrings(root: ParentNode = document): void {
  if (root === document) document.documentElement.lang = LANG;
  for (const el of root.querySelectorAll<HTMLElement>('[data-str]')) el.textContent = str(el.dataset.str!);
  for (const a of ATTRS) {
    for (const el of root.querySelectorAll(`[data-str-${a}]`)) el.setAttribute(a, str(el.getAttribute(`data-str-${a}`)!));
  }
}
