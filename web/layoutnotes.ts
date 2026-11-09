import { fileLevelTags } from '../src/layout/fmlconfig';

const CP1252 = new TextDecoder('windows-1252');

export interface LayoutNotes {
  credit: string;
  text: string;
  splash: Uint8Array | null;
}

function cString(b: Uint8Array | undefined): string {
  if (!b) return '';
  const end = b.indexOf(0);
  return CP1252.decode(end < 0 ? b : b.subarray(0, end));
}

export function creditLine(raw: string): string {
  return raw
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .replace(/ {3,}/g, ' - ')
    .replace(/\s+/g, ' ');
}

const SKIP_DESTS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer',
  'headerl', 'headerr', 'footerl', 'footerr', 'listtable', 'listoverridetable',
  'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles',
  'datastore', 'filetbl', 'revtbl', 'pgdsctbl',
]);

const WORD_CHARS: Record<string, string> = {
  par: '\n', line: '\n', sect: '\n', page: '\n', row: '\n',
  tab: '\t', cell: '\t',
  emdash: '-', endash: '-', bullet: '•',
  lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”',
};

export function rtfToText(src: string): string {
  if (!src.startsWith('{\\rtf')) {
    return CP1252.decode(Uint8Array.from(src, (c) => c.charCodeAt(0) & 0xff)).replace(/\r\n?/g, '\n');
  }
  let out = '';
  const bytes: number[] = [];
  const flush = (): void => {
    if (bytes.length) { out += CP1252.decode(new Uint8Array(bytes)); bytes.length = 0; }
  };
  const emit = (s: string): void => { flush(); out += s; };
  type Frame = { skip: boolean; uc: number };
  const stack: Frame[] = [];
  let cur: Frame = { skip: false, uc: 1 };
  let pendingSkip = 0;
  let groupStart = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      stack.push(cur);
      cur = { ...cur };
      groupStart = true;
      i++;
      continue;
    }
    if (ch === '}') {
      cur = stack.pop() ?? { skip: false, uc: 1 };
      groupStart = false;
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') { i++; continue; }
    if (ch === '\\') {
      const next = src[i + 1] ?? '';
      if (next === '*') {
        if (groupStart) cur.skip = true;
        groupStart = false;
        i += 2;
        continue;
      }
      if (next === "'") {
        const hex = src.slice(i + 2, i + 4);
        i += 4;
        groupStart = false;
        if (pendingSkip > 0) { pendingSkip--; continue; }
        if (!cur.skip && /^[0-9a-fA-F]{2}$/.test(hex)) bytes.push(parseInt(hex, 16));
        continue;
      }
      if (/[a-zA-Z]/.test(next)) {
        const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i + 1, i + 40))!;
        const word = m[1];
        const arg = m[2] === undefined ? null : Number(m[2]);
        i += 1 + m[0].length;
        const first = groupStart;
        groupStart = false;
        if (first && SKIP_DESTS.has(word)) { cur.skip = true; continue; }
        if (cur.skip) continue;
        if (word === 'uc' && arg !== null) { cur.uc = arg; continue; }
        if (word === 'u' && arg !== null) {
          emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg));
          pendingSkip = cur.uc;
          continue;
        }
        const c = WORD_CHARS[word];
        if (c !== undefined) emit(c);
        continue;
      }
      i += 2;
      groupStart = false;
      if (cur.skip) continue;
      if (next === '~') emit(' ');
      else if (next === '_') emit('-');
      else if (next === '\\' || next === '{' || next === '}') emit(next);
      continue;
    }
    groupStart = false;
    i++;
    if (pendingSkip > 0) { pendingSkip--; continue; }
    if (!cur.skip) bytes.push(src.charCodeAt(i - 1) & 0xff);
  }
  flush();
  return out;
}

export function tidyNotes(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*\n/, '')
    .trimEnd();
}

function bytesAsChars(b: Uint8Array): string {
  let s = '';
  for (let k = 0; k < b.length; k += 8192) s += String.fromCharCode(...b.subarray(k, k + 8192));
  return s;
}

function bitmap(b: Uint8Array | undefined): Uint8Array | null {
  return b && b.length > 54 && b[0] === 0x42 && b[1] === 0x4d ? b : null;
}

export function readLayoutNotes(payload: Uint8Array, fml: boolean): LayoutNotes {
  const tags = fileLevelTags(payload);
  const credit = creditLine(cString(tags.get(fml ? 0x0c : 12)));
  let text = '';
  if (fml) {
    const raw = tags.get(0x76);
    if (raw?.length) text = rtfToText(bytesAsChars(raw.indexOf(0) < 0 ? raw : raw.subarray(0, raw.indexOf(0))));
  } else {
    text = cString(tags.get(41)).replace(/\r\n?/g, '\n');
  }
  text = text.trim() ? tidyNotes(text) : '';
  return { credit, text, splash: fml ? bitmap(tags.get(0x98)) : null };
}
