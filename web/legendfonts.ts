
interface Shipped { family: string; files: Record<number, string> }

const LIBERATION: Shipped = { family: 'Liberation Sans', files: { 400: 'liberation-sans-400.woff2', 700: 'liberation-sans-700.woff2' } };
const CARLITO: Shipped = { family: 'Carlito', files: { 400: 'carlito-400.woff2', 700: 'carlito-700.woff2' } };
const WINE_TAHOMA: Shipped = { family: 'Tahoma', files: { 400: 'wine-tahoma-400.woff2', 700: 'wine-tahoma-700.woff2' } };
const ANTON: Shipped = { family: 'Anton', files: { 400: 'anton-400.woff2' } };
const LILITA: Shipped = { family: 'Lilita One', files: { 400: 'lilita-one-400.woff2' } };
const BUNGEE: Shipped = { family: 'Bungee', files: { 400: 'bungee-400.woff2' } };
const SHIPPED: Shipped[] = [LIBERATION, CARLITO, WINE_TAHOMA, ANTON, LILITA, BUNGEE];
const shippedByFamily = (family: string): Shipped | undefined =>
  SHIPPED.find((s) => s.family.toLowerCase() === family.trim().toLowerCase());

const STAND_IN: Record<string, Shipped> = {
  'arial': LIBERATION,
  'tahoma': WINE_TAHOMA,
  'ms sans serif': LIBERATION,
  'microsoft sans serif': LIBERATION,
  'calibri': CARLITO,
  'impact': ANTON,
  'lithograph': ANTON,
};

const METRIC_TWIN = new Set(['arial', 'tahoma', 'ms sans serif', 'microsoft sans serif', 'calibri']);

const CAPS_ONLY = new Set(['lithograph']);

const PREF_KEY = 'fruitulator.captionFonts';
let prefs: Record<string, string> | null = null;
function readPrefs(): Record<string, string> {
  if (prefs) return prefs;
  try { prefs = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Record<string, string>; } catch { prefs = {}; }
  if (!prefs || typeof prefs !== 'object') prefs = {};
  return prefs;
}
export function chosenStandIn(face: string | undefined): string | undefined {
  const v = readPrefs()[(face ?? '').trim().toLowerCase()];
  return v && shippedByFamily(v) ? shippedByFamily(v)!.family : undefined;
}
export function chooseStandIn(face: string, family: string | undefined): void {
  const p = readPrefs();
  const k = face.trim().toLowerCase();
  if (family && shippedByFamily(family)) p[k] = shippedByFamily(family)!.family; else delete p[k];
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch {  }
}

export const STAND_IN_CHOICES: readonly string[] = [ANTON, LILITA, BUNGEE, WINE_TAHOMA, LIBERATION, CARLITO].map((s) => s.family);

export function faceAvailable(face: string | undefined): boolean {
  const f = (face ?? '').trim();
  if (!f) return true;
  const g = globalThis as { document?: Document };
  const cv = g.document?.createElement('canvas');
  const ctx = cv?.getContext('2d');
  if (!ctx) return true;
  const sample = 'The quick £3.00 JACKPOT nudge 1234567890';
  const widthIn = (family: string): number => { ctx.font = `48px ${family}`; return ctx.measureText(sample).width; };
  const mono = widthIn('monospace'), serif = widthIn('serif');
  return widthIn(`"${f}", monospace`) !== mono || widthIn(`"${f}", serif`) !== serif;
}

export function facesToAsk(faces: Iterable<string | undefined>): string[] {
  const out: string[] = [];
  for (const f of new Set([...faces].map((f) => (f ?? '').trim()).filter(Boolean))) {
    if (METRIC_TWIN.has(f.toLowerCase())) continue;
    if (!faceAvailable(f) && !chosenStandIn(f) && !out.some((o) => o.toLowerCase() === f.toLowerCase())) out.push(f);
  }
  return out;
}

export function hasMetricTwin(face: string | undefined): boolean {
  return METRIC_TWIN.has((face ?? '').trim().toLowerCase());
}

export function legendFamily(face: string | undefined): string {
  const f = (face ?? '').trim();
  const sub = chosenStandIn(f) ? shippedByFamily(chosenStandIn(f)!) : STAND_IN[f.toLowerCase()];
  const stack: string[] = [];
  for (const s of [f && `"${f}"`, sub && `"${sub.family}"`, '"Tahoma"', 'system-ui', 'sans-serif']) {
    if (s && !stack.includes(s)) stack.push(s);
  }
  return stack.join(', ');
}

export function legendCaps(face: string | undefined): boolean {
  return CAPS_ONLY.has((face ?? '').trim().toLowerCase());
}

export function legendStandIn(face: string | undefined): string | undefined {
  return chosenStandIn(face) ?? STAND_IN[(face ?? '').trim().toLowerCase()]?.family;
}

const registered = new Map<string, Promise<void>>();

export function ensureLegendFonts(faces: Iterable<string | undefined>, base = '/fonts/'): Promise<void> {
  const g = globalThis as { FontFace?: typeof FontFace; document?: Document };
  if (!g.FontFace || !g.document?.fonts) return Promise.resolve();
  const loads: Promise<void>[] = [];
  const wanted = new Set<Shipped>();
  for (const face of new Set([...faces].map((f) => (f ?? '').trim()).filter(Boolean))) {
    const sub = chosenStandIn(face) ? shippedByFamily(chosenStandIn(face)!) : STAND_IN[face.toLowerCase()];
    if (sub) wanted.add(sub);
    const direct = shippedByFamily(face);
    if (direct) wanted.add(direct);
  }
  for (const sub of wanted) {
    for (const [weight, file] of Object.entries(sub.files)) {
      const key = `${sub.family}:${weight}`;
      let p = registered.get(key);
      if (!p) {
        const ff = new g.FontFace(sub.family, `local("${sub.family}"), url(${base}${file})`, { weight, display: 'swap' });
        g.document.fonts.add(ff);
        p = ff.load().then(() => undefined, () => undefined);
        registered.set(key, p);
      }
      loads.push(p);
    }
  }
  return Promise.all(loads).then(() => undefined);
}
