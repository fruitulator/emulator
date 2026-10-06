import { repairC1 } from './cp437';

export interface CardTitle {
  title: string;
  chips: string[];
  raw: string;
}

const ARCHIVE_EXT = /\.(zip|7z|rar)$/i;

const LAYOUT_RES = new Set(['640', '800', '1024', '1280']);

const BUILD_MARKERS = new Set(['DX', 'WDX', 'CDX', 'SDX']);

export const MANUFACTURERS: Record<string, string> = {
  bellfruit: 'Bell-Fruit',
  bfm: 'Bell-Fruit',
  barcrest: 'Barcrest',
  maygay: 'Maygay',
  jpm: 'JPM',
  mazooma: 'Mazooma',
  ace: 'Ace',
  astra: 'Astra',
  empire: 'Empire',
  global: 'Global',
  project: 'Project',
  qps: 'QPS',
  pcp: 'PCP',
};

function splitTokens(s: string): string {
  const camel = s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return camel.replace(/([A-Za-z])(\d{3,4})\b/g, (m, word: string, digits: string) =>
    LAYOUT_RES.has(digits) ? `${word} ${digits}` : m);
}

function mergeJackpots(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/^£\d+$/.test(tokens[i]) && /^jp$/i.test(tokens[i + 1] ?? '')) {
      out.push(`${tokens[i]}jp`);
      i++;
    } else out.push(tokens[i]);
  }
  return out;
}

function titleCaseWord(w: string): string {
  if (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

export function parseTitle(source: string): CardTitle {
  source = repairC1(source);
  const raw = source;

  let rest = source.replace(ARCHIVE_EXT, '');
  const chips: string[] = [];

  rest = rest.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    const key = inner.trim().toLowerCase().replace(/[\s_-]/g, '');
    const label = MANUFACTURERS[key];
    if (label) chips.push(label);
    else if (inner.trim()) chips.push(titleCaseWord(inner.trim()));
    return ' ';
  });

  const bracketed: string[] = [];
  rest = rest.replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
    bracketed.push(...inner.split(/[_\s,]+/).filter(Boolean));
    return ' ';
  });

  const kept: string[] = [];
  const words = splitTokens(rest.replace(/[_]+/g, ' ')).split(/\s+/).filter(Boolean);
  for (const w of [...mergeJackpots(bracketed), ...mergeJackpots(words)]) {
    const jp = /^£?(\d+)jp$/i.exec(w);
    if (jp) { chips.push(`£${jp[1]} jackpot`); continue; }
    const dx = /^([a-z]?dx)(\d+)$/i.exec(w);
    if (dx) { chips.push(`${dx[1].toUpperCase()}${dx[2]}`); continue; }
    if (BUILD_MARKERS.has(w.toUpperCase())) { chips.push(w.toUpperCase()); continue; }
    if (LAYOUT_RES.has(w)) continue;
    if (!words.includes(w)) continue;
    kept.push(w);
  }

  const title = kept
    .map((w) => (w === '-' || w === '\u2014' || w === '\u2013' ? '-' : titleCaseWord(w)))
    .join(' ')
    .replace(/\s+-\s+/g, ' - ')
    .trim();

  return { title: title || raw.replace(ARCHIVE_EXT, ''), chips, raw };
}
