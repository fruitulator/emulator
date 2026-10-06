import enGB from './locales/en-GB.json';

export type Entry = string | Partial<Record<Intl.LDMLPluralRule, string>>;

export const LANG = 'en-GB';

const CATALOGUE: Record<string, Entry> = enGB;
const plurals = new Intl.PluralRules(LANG);

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
