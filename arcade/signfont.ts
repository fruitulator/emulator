import type { SignFont } from './roomlook';

export interface Strokes { lines: number[][]; width: number; cap: number }

interface StrokeFace { upm: number; cap: number; g: Record<string, [number, number[][]]> }
let face: Promise<StrokeFace> | null = null;

function strokeFace(): Promise<StrokeFace> {
  face ??= import('./fonts/relief-singleline.json').then((m) => (m.default ?? m) as unknown as StrokeFace);
  return face;
}

export async function strokeText(text: string, cap: number): Promise<Strokes> {
  const f = await strokeFace();
  const k = cap / f.cap;
  const lines: number[][] = [];
  let x = 0;
  for (const ch of text) {
    const g = f.g[ch] ?? f.g[ch.toUpperCase()] ?? null;
    if (!g) { x += (f.g[' ']?.[0] ?? 280) * k; continue; }
    for (const p of g[1]) {
      const out: number[] = [];
      for (let i = 0; i < p.length; i += 2) out.push(x + p[i] * k, p[i + 1] * k);
      lines.push(out);
    }
    x += g[0] * k;
  }
  return { lines, width: x, cap };
}

const FILES: Partial<Record<SignFont, { file: string; weight: number }>> = {
  bungee: { file: 'bungee-400.woff2', weight: 400 },
  anton: { file: 'anton-400.woff2', weight: 400 },
  abril: { file: 'abril-fatface-400.woff2', weight: 400 },
  yesteryear: { file: 'yesteryear-400.woff2', weight: 400 },
  lilita: { file: 'lilita-one-400.woff2', weight: 400 },
  barlow: { file: 'barlow-condensed-700.woff2', weight: 700 },
};
const loaded = new Map<SignFont, Promise<boolean>>();
const FONT_WAIT_MS = 4000;

export async function canvasFont(f: SignFont, px: number): Promise<string> {
  const d = FILES[f] ?? FILES.anton!;
  const family = `fr-sign-${f}`;
  if (!loaded.has(f) && typeof FontFace !== 'undefined' && typeof document !== 'undefined' && document.fonts) {
    const ff = new FontFace(family, `url(${import.meta.env.BASE_URL}fonts/${d.file}) format('woff2')`, { weight: String(d.weight) });
    document.fonts.add(ff);
    const wait = new Promise<boolean>((r) => { setTimeout(() => r(false), FONT_WAIT_MS); });
    loaded.set(f, Promise.race([ff.load().then(() => true), wait]).catch((e) => {
      console.warn('[arcade] a sign typeface did not load', d.file, e);
      return false;
    }));
  }
  await loaded.get(f);
  return `${d.weight} ${px}px '${family}', Impact, 'Arial Black', sans-serif`;
}

const DOTS: Record<string, string> = {
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.', D: '###..|#..#.|#...#|#...#|#...#|#..#.|###..',
  E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.', J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.', P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.', V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', 1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  2: '.###.|#...#|....#|...#.|..#..|.#...|#####', 3: '#####|...#.|..#..|...#.|....#|#...#|.###.',
  4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', 5: '#####|#....|####.|....#|....#|#...#|.###.',
  6: '..##.|.#...|#....|####.|#...#|#...#|.###.', 7: '#####|....#|...#.|..#..|.#...|.#...|.#...',
  8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.', 9: '.###.|#...#|#...#|.####|....#|...#.|.##..',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..', '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '.': '.....|.....|.....|.....|.....|.##..|.##..', ',': '.....|.....|.....|.....|.##..|..#..|.#...',
  "'": '.##..|..#..|.#...|.....|.....|.....|.....', '"': '.#.#.|.#.#.|.#.#.|.....|.....|.....|.....',
  '-': '.....|.....|.....|#####|.....|.....|.....', '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....', '/': '.....|....#|...#.|..#..|.#...|#....|.....',
  '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#', '£': '..##.|.#..#|.#...|###..|.#...|.#..#|#####',
  '$': '..#..|.####|#.#..|.###.|..#.#|####.|..#..', '%': '##...|##..#|...#.|..#..|.#...|#..##|...##',
  '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.', '*': '.....|..#..|#.#.#|.###.|#.#.#|..#..|.....',
  '(': '...#.|..#..|.#...|.#...|.#...|..#..|...#.', ')': '.#...|..#..|...#.|...#.|...#.|..#..|.#...',
  '=': '.....|.....|#####|.....|#####|.....|.....', '@': '.###.|#...#|....#|.##.#|#.#.#|#.#.#|.###.',
};

export function dotText(text: string): { cols: number; rows: Uint8Array[] } {
  const glyphs = [...text.toUpperCase()].map((c) => DOTS[c] ?? DOTS['?']);
  const cols = glyphs.length * 6;
  const rows = Array.from({ length: 7 }, () => new Uint8Array(cols));
  glyphs.forEach((g, i) => {
    g.split('|').forEach((row, r) => {
      for (let c = 0; c < 5; c++) if (row[c] === '#') rows[r][i * 6 + c] = 255;
    });
  });
  return { cols, rows };
}
