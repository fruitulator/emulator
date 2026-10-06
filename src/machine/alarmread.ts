import {
  cabinetDisplayReversed, declaredBankDigits, declaredDisplays, glassText,
  virtualDisplayReversed,
} from './layoutdisplay';

export interface AlarmFormCore {
  id: string;
  re: RegExp;
  reads: 'alpha' | 'digits';
}

export const FLASH_FORM = 'flash-credit-code';
export const STRIM_FLASH_FORM = 'flash-strim-code';

const STRIM_ON_DIGITS = /(?:^|\s)(\d\.\d)(?=\s|$)/;

export const ALARM_FORM_CORE: readonly AlarmFormCore[] = [
  { id: 'bacta-type-token', re: /\b(?:ERR|ALM)\b/, reads: 'alpha' },
  { id: 'mars-strim-code', re: /(?:^|\s)(\d\.[0-9A-F])(?=\s+[A-Z£#])/, reads: 'alpha' },
  { id: 'mpu5-alarm-header', re: /\bALARM\b\s*\d+\s*[-‐-―]\s*[0-9A-F]+\b/, reads: 'alpha' },
  { id: 'bfm-system-status', re: /\bSYSTEM STATUS\b/, reads: 'alpha' },
  { id: 'mpu4-no-dataport', re: /\bNO DATAPORT COMM\b/, reads: 'alpha' },
  { id: 'bfm-not-paired', re: /\b(?:[A-Z]+ )?[A-Z]+\s+NP\s+A\d\b/, reads: 'alpha' },
  { id: FLASH_FORM, re: /[A-Za-z]/, reads: 'digits' },
  { id: STRIM_FLASH_FORM, re: STRIM_ON_DIGITS, reads: 'digits' },
];

export function alarmForm(id: string): AlarmFormCore {
  const f = ALARM_FORM_CORE.find((x) => x.id === id);
  if (!f) throw new Error(`no alarm form ${id}`);
  return f;
}

export const BOARD_ALARM_FORMS: Readonly<Record<string, readonly string[]>> = {
  SCORPION1: ['bacta-type-token', 'mars-strim-code'],
  SCORPION2: ['bacta-type-token', 'mars-strim-code'],
  SCORPION4: ['bacta-type-token', 'mars-strim-code'],
  BLACKBOX: ['bacta-type-token', 'mars-strim-code'],
  SCORPION5: ['bacta-type-token', 'mars-strim-code', 'bfm-not-paired'],
  ADDER5: ['bacta-type-token', 'mars-strim-code'],
  SYS85: ['bfm-system-status', 'bacta-type-token', 'mars-strim-code'],
  MPU4: ['bacta-type-token', 'mpu4-no-dataport', 'mars-strim-code'],
  MPU5: ['mpu5-alarm-header', 'bacta-type-token', 'mars-strim-code'],
  EPOCH: ['mars-strim-code', 'bacta-type-token'],
  M1AB: ['mars-strim-code', 'bacta-type-token'],
  IMPACT: ['mars-strim-code', 'bacta-type-token'],
  MPS2: [],
  SRU: [],
  SYSTEM80: [],
  SYS5: ['mars-strim-code', 'bacta-type-token', STRIM_FLASH_FORM],
  SPACE: ['bacta-type-token', 'mars-strim-code'],
  SYS1: ['bacta-type-token', 'mars-strim-code'],
  ASTRASYSA1: ['mars-strim-code'],
  ELECTROCOIN: [FLASH_FORM],
  PHOENIX: [],
  PHOENIX2: [],
  PROCONN: ['mars-strim-code', 'bacta-type-token', FLASH_FORM],
};

export function boardAlarmForms(system: string): readonly string[] | undefined {
  return BOARD_ALARM_FORMS[system.toUpperCase()];
}

const NO_FORMS_WHY: Readonly<Record<string, string>> = {
  MPS2: 'this board shows a fault as a plain number on its digits, the same digits that show'
    + ' credit, so a fault cannot be told apart from a credit',
  SYSTEM80: 'this board has no fault display; it signals a fault with its alarm tone and by'
    + ' shutting its coin slots, and neither is read here',
  SRU: 'this board has no fault display and shows no fault codes',
};

export function unreadWhy(system: string, reason: UnreadReason): string {
  switch (reason) {
    case 'no-signal': return 'this app has no alarm reading for this board';
    case 'no-forms': return NO_FORMS_WHY[system.toUpperCase()]
      ?? 'this board shows its alarms somewhere this app cannot read';
    case 'no-surface': return 'this cabinet has no display its board shows alarms on';
    case 'dark': return 'the display its board shows alarms on stayed dark';
  }
}

const SEG: Record<number, string> = {
  0x3f: '0', 0x06: '1', 0x5b: '2', 0x4f: '3', 0x66: '4', 0x6d: '5', 0x7d: '6',
  0x07: '7', 0x7f: '8', 0x6f: '9', 0x77: 'A', 0x7c: 'b', 0x39: 'C', 0x5e: 'd',
  0x79: 'E', 0x71: 'F', 0x76: 'H', 0x38: 'L', 0x37: 'n', 0x3e: 'U', 0x40: '-',
  0x73: 'P', 0x31: 'r', 0x78: 't', 0x00: ' ',
};

export interface Glass {
  alpha: string;
  digits: string;
  hasAlpha: boolean;
  cells?: string[];
  hasDigits?: boolean;
  hasDisplayDevice?: boolean;
  flashedCode?: { cells: number[]; code: string; normal: string };
  flashedStrim?: { code: string; at: number };
  lit?: boolean;
  everLettered?: boolean;
}

export interface CabinetSurfaces {
  reversed: boolean;
  hasAlpha: boolean;
  hasDigits: boolean;
}

export function cabinetSurfaces(layout: Uint8Array | undefined, board?: string): CabinetSurfaces {
  let reversed = false;
  let hasAlpha = false;
  let hasDigits = false;
  try { reversed = cabinetDisplayReversed(layout); } catch {  }
  try { hasAlpha = declaredDisplays(layout).length > 0; } catch {  }
  try { hasDigits = declaredBankDigits(layout).length > 0; } catch {  }
  if (!hasAlpha) reversed = virtualDisplayReversed(board);
  return { reversed, hasAlpha, hasDigits };
}

export interface GlassSource {
  display?: unknown;
  system?: string;
  layoutDigit?(i: number): number;
  deviceText?(): string;
}

export function readGlass(
  m: GlassSource, layout: Uint8Array | undefined, surfaces?: CabinetSurfaces,
): Glass {
  const surf = surfaces ?? cabinetSurfaces(layout, m.system);
  const reversed = surf.reversed;
  let alpha = '';
  try {
    const raw = m.deviceText?.() ?? (m.display as { text?: () => string } | undefined)?.text?.() ?? '';
    alpha = glassText(raw, reversed).trimEnd();
  } catch {  }
  let digits = '';
  const cells: string[] = [];
  try {
    const read = (m as { layoutDigit?: (i: number) => number }).layoutDigit;
    if (read) {
      for (let i = 0; i < 16; i++) {
        const d = read.call(m, i) & 0xff;
        const seg = SEG[d & 0x7f];
        cells.push(seg ?? '');
        digits += (seg ?? `<${d.toString(16).padStart(2, '0')}>`) + ((d & 0x80) ? '.' : '');
      }
      digits = digits.trimEnd();
    }
  } catch {  }
  const hasDisplayDevice = typeof (m.display as { text?: unknown } | undefined)?.text === 'function';
  return {
    alpha, digits, cells, hasDisplayDevice,
    hasAlpha: surf.hasAlpha, hasDigits: surf.hasDigits,
  };
}

const isCodeChar = (c: string): boolean => /^[A-Za-z]$/.test(c);

const MIN_PHASES = 2;

const MIN_RUNS = 2;

export function flashedCredit(samples: readonly (readonly string[])[]):
Glass['flashedCode'] | undefined {
  if (samples.length < MIN_PHASES * 2) return undefined;
  const width = Math.max(0, ...samples.map((s) => s.length));
  const hit: number[] = [];
  const code: string[] = [];
  const normal: string[] = [];
  for (let i = 0; i < width; i++) {
    const seen = new Map<string, { n: number; runs: number }>();
    let others = 0;
    let lastOther = '';
    let prev = '';
    for (const s of samples) {
      const c = s[i] ?? '';
      if (isCodeChar(c)) {
        const e = seen.get(c) ?? { n: 0, runs: 0 };
        e.n++;
        if (prev !== c) e.runs++;
        seen.set(c, e);
      } else { others++; lastOther = c; }
      prev = c;
    }
    if (others < MIN_PHASES) continue;
    let best = '';
    for (const [c, e] of seen) {
      if (e.n >= MIN_PHASES && e.runs >= MIN_RUNS && e.n > (seen.get(best)?.n ?? 0)) best = c;
    }
    if (!best) continue;
    hit.push(i);
    code.push(best);
    normal.push(lastOther === '' ? ' ' : lastOther);
  }
  if (!hit.length) return undefined;
  return { cells: hit, code: code.join(''), normal: normal.join('') };
}

export function flashedStrim(samples: readonly string[]): Glass['flashedStrim'] | undefined {
  if (samples.length < MIN_PHASES * 2) return undefined;
  const seen = new Map<string, { n: number; runs: number; code: string; at: number }>();
  let prev = new Set<string>();
  for (const s of samples) {
    const now = new Set<string>();
    const re = new RegExp(STRIM_ON_DIGITS.source, 'g');
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const at = m.index + m[0].indexOf(m[1]);
      const key = `${at}:${m[1]}`;
      now.add(key);
      const e = seen.get(key) ?? { n: 0, runs: 0, code: m[1], at };
      e.n++;
      if (!prev.has(key)) e.runs++;
      seen.set(key, e);
    }
    prev = now;
  }
  let best: { n: number; runs: number; code: string; at: number } | undefined;
  for (const e of seen.values()) {
    if (e.n < MIN_PHASES || e.runs < MIN_RUNS || samples.length - e.n < MIN_PHASES) continue;
    if (!best || e.n > best.n) best = e;
  }
  return best ? { code: best.code, at: best.at } : undefined;
}

export function glassLine(g: Glass): string {
  const parts: string[] = [];
  if (g.alpha.trim()) parts.push(`alpha "${g.alpha}"`);
  if (g.digits.trim()) parts.push(`digits "${g.digits}"`);
  return parts.join(' ') || '(nothing on the glass)';
}

export type AlarmVerdict =
  | 'ALARM'
  | 'CLEAR'
  | 'UNREAD';

export type UnreadReason = 'no-signal' | 'no-forms' | 'no-surface' | 'dark';

export interface CoreReading {
  verdict: AlarmVerdict;
  form?: string;
  matched?: string;
  unread?: UnreadReason;
  glass: string;
}

export function classifyGlassCore(system: string, g: Glass): CoreReading {
  const forms = boardAlarmForms(system);
  const glass = glassLine(g);
  const text = g.alpha.toUpperCase();
  const own = new Set(forms ?? []);
  const hits = ALARM_FORM_CORE.filter((f) => f.reads === 'alpha')
    .map((f) => ({ f, m: f.re.exec(text) })).filter((h) => h.m);
  const best = hits.find((h) => own.has(h.f.id)) ?? hits[0];
  if (best) return { verdict: 'ALARM', form: best.f.id, matched: best.m![0].trim(), glass };
  if (g.flashedCode && own.has(FLASH_FORM)) {
    return {
      verdict: 'ALARM',
      form: FLASH_FORM,
      matched: g.flashedCode.code,
      glass: `${glass} - cells ${g.flashedCode.cells.join(',')} flashed`
        + ` "${g.flashedCode.code}" against "${g.flashedCode.normal}"`,
    };
  }
  if (g.flashedStrim && own.has(STRIM_FLASH_FORM)) {
    return {
      verdict: 'ALARM',
      form: STRIM_FLASH_FORM,
      matched: g.flashedStrim.code,
      glass: `${glass} - "${g.flashedStrim.code}" flashed on the digits`,
    };
  }
  if (!forms) return { verdict: 'UNREAD', unread: 'no-signal', glass };
  if (!forms.length) return { verdict: 'UNREAD', unread: 'no-forms', glass };
  const alphaForms = forms.filter((id) => ALARM_FORM_CORE.find((f) => f.id === id)?.reads === 'alpha');
  const onSomeAlpha = g.hasAlpha || (g.hasDisplayDevice ?? false);
  const readableOnAlpha = alphaForms.length > 0 && onSomeAlpha;
  const readableOnDigits = (own.has(FLASH_FORM) || own.has(STRIM_FLASH_FORM)) && (g.hasDigits ?? false);
  if (!readableOnAlpha && !readableOnDigits) return { verdict: 'UNREAD', unread: 'no-surface', glass };
  if (readableOnAlpha && !readableOnDigits && !(g.lit ?? g.alpha.trim() !== '')) {
    return { verdict: 'UNREAD', unread: 'dark', glass };
  }
  return { verdict: 'CLEAR', glass };
}
