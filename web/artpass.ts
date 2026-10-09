import { onIdle } from './idle';
import { decodeArtwork, importConcurrency } from './importer';
import { onlyOneTab, probeBusy } from './busy';
import { listGames, type GameMeta } from './store';

export interface ArtPassEvents {
  onTile?(hash: string): void;
  onProgress?(left: number, total: number): void;
  visible?(): ReadonlySet<string>;
}

export function artPassOrder(games: GameMeta[], visible: ReadonlySet<string> = new Set()): string[] {
  return games
    .filter((g) => g.decodeStatus === 'pending')
    .sort((a, b) => (Number(visible.has(b.hash)) - Number(visible.has(a.hash)))
      || (b.addedAt - a.addedAt))
    .map((g) => g.hash);
}

let running = false;
let again = false;

export function prepareArtwork(ev: ArtPassEvents = {}): void {
  if (running) { again = true; return; }
  running = true;
  void (async () => {
    try {
      do {
        again = false;
        await runPass(ev);
      } while (again);
    } catch (e) {
      console.warn('[library] artwork pass failed', e);
    } finally {
      running = false;
      ev.onProgress?.(0, 0);
    }
  })();
}

export function breatherMs(decodeMs: number, oneLane = importConcurrency() === 1): number {
  return oneLane ? Math.min(decodeMs * 2, 4000) : Math.min(decodeMs, 2000);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const BUSY_POLL_MS = 1000;

async function runPass(ev: ArtPassEvents): Promise<void> {
  const ran = await onlyOneTab('artpass', async () => {
    let games = await listGames();
    const total = artPassOrder(games).length;
    if (!total) return;
    console.log(`[library] ${total} game(s) to install; cards on screen first`);
    let done = 0;
    let paused = false;
    const failed = new Set<string>();
    for (;;) {
      await new Promise<void>((resolve) => onIdle(resolve));
      if (await probeBusy()) {
        if (!paused) { paused = true; console.log('[library] install paused: a machine is running'); }
        await sleep(BUSY_POLL_MS);
        continue;
      }
      if (paused) { paused = false; console.log('[library] install resumed'); }
      const queue = artPassOrder(games, ev.visible?.()).filter((h) => !failed.has(h));
      const hash = queue[0];
      if (hash === undefined) break;
      ev.onProgress?.(queue.length, total);
      const t0 = performance.now();
      try {
        const meta = await decodeArtwork(hash);
        games = games.map((g) => (g.hash === hash ? meta : g));
        ev.onTile?.(hash);
      } catch (e) {
        failed.add(hash);
        console.warn('[library] install failed', hash, e);
      }
      done++;
      if (done % 25 === 0) games = await listGames();
      await sleep(breatherMs(performance.now() - t0));
    }
    console.log(`[library] installed ${done} game(s)`);
  });
  if (!ran) console.log('[library] install is running in another tab');
}
