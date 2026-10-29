import { MANUFACTURERS } from './title';

const PRICE = /^(?:£\d+(?:\.\d{1,2})?p?|\d+\.\d{2}|\d+p)$/i;
const VERSION = /^v\d+(?:\.\d+)*[a-z]?$/i;
const REV_WORD = /^rev(?:ision)?\.?$/i;
const REV_GLUED = /^rev\.?\d+[a-z]?$/i;
const DX = /^[a-z]?dx\d*$/i;
const NUMBER = /^\d{1,4}$/;
const DASH = /^[-–—]$/;

const MAKERS = new Set([
  ...[...Object.keys(MANUFACTURERS), ...Object.values(MANUFACTURERS)].map((w) => w.toLowerCase()),
  'bfg', 'bwb', 'reflex', 'red', 'mdm', 'vivid', 'crystal', 'impulse', 'union', 'extreme',
  'betcom', 'mrm', 'gemini', 'blueprint', 'coinworld', 'eurocoin', 'associated', 'electrocoin',
  'electrcoin', 'dje', 'mazooma', 'empire', 'global', 'project', 'qps', 'ace', 'astra', 'maygay', 'jpm',
]);

const isMaker = (w: string | undefined): boolean => !!w && MAKERS.has(w.toLowerCase());

function words(title: string): string[] {
  return title
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .split(/[\s_]+/)
    .filter(Boolean);
}

function unmarked(ws: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (PRICE.test(w) || VERSION.test(w) || REV_GLUED.test(w) || DX.test(w)) continue;
    if (REV_WORD.test(w)) {
      if (/^\d+[a-z]?$/i.test(ws[i + 1] ?? '')) i++;
      continue;
    }
    out.push(w);
  }
  while (out.length >= 3 && DASH.test(out[out.length - 2]) && isMaker(out[out.length - 1])) out.length -= 2;
  while (out.length && DASH.test(out[out.length - 1])) out.length--;
  while (out.length && DASH.test(out[0])) out.shift();
  return out;
}

function trimmed(title: string): string[] {
  const ws = words(title);
  const lead = /^(\w+)['’,]s$/i.exec(ws[0] ?? '');
  if (lead && isMaker(lead[1]) && ws.length > 1) ws.shift();
  let jackpotAfter = false;
  while (ws.length > 1) {
    const last = ws[ws.length - 1];
    const prev = ws[ws.length - 2];
    if (PRICE.test(last)) { ws.pop(); jackpotAfter = true; continue; }
    if (VERSION.test(last) || REV_GLUED.test(last) || DX.test(last) || DASH.test(last)) { ws.pop(); continue; }
    if (/^[TC]$/.test(last) && (NUMBER.test(prev) || PRICE.test(prev))) { ws.pop(); continue; }
    if (NUMBER.test(last) && REV_WORD.test(prev)) { ws.length -= 2; continue; }
    if (NUMBER.test(last)) {
      if (jackpotAfter && +last >= 1 && +last <= 3) break;
      ws.pop();
      jackpotAfter = true;
      continue;
    }
    if (ws.length >= 3 && DASH.test(prev) && isMaker(last)) { ws.length -= 2; continue; }
    break;
  }
  return unmarked(ws);
}

const normal = (ws: readonly string[]): string =>
  ws.join(' ').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, '').replace(/\s+/g, ' ').trim();

export function titleKey(title: string): string {
  const key = normal(trimmed(title));
  return key.includes(' ') ? key : normal(unmarked(words(title)));
}

export function cleanTitle(title: string): string {
  const ws = normal(trimmed(title)).includes(' ') ? trimmed(title) : unmarked(words(title));
  const t = ws.join(' ').replace(/\s+-\s+/g, ' - ').trim();
  return t || title.trim();
}
