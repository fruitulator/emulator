import { THUMB_RULE, encodeThumb, imageMime } from './cabjson';
import { onIdle } from './idle';
import { refreshThumb } from './importer';
import { getThumb, lastPlayed, listGames, putThumb, type GameMeta } from './store';

let started = false;

export function convertLegacyThumbs(): void {
  if (started) return;
  started = true;
  void (async () => {
    const games = await listGames();
    const queue = games.filter((g) => g.hasThumb && g.thumbRule === THUMB_RULE)
      .map((g) => g.hash);
    let converted = 0;
    let saved = 0;

    const next = (): void => {
      const hash = queue.pop();
      if (hash === undefined) {
        if (converted) {
          console.log(`[library] re-encoded ${converted} thumbnail(s), ` +
            `${(saved / 1048576).toFixed(1)} MB reclaimed`);
        }
        return;
      }
      void (async () => {
        try {
          const bytes = await getThumb(hash);
          if (bytes && imageMime(bytes) === 'image/png') {
            const bmp = await createImageBitmap(
              new Blob([bytes as BlobPart], { type: 'image/png' }),
            );
            const next = await encodeThumb(bmp);
            bmp.close();
            if (next.byteLength < bytes.byteLength) {
              await putThumb(hash, next);
              converted++;
              saved += bytes.byteLength - next.byteLength;
            }
          }
        } catch (e) {
          console.warn('[library] thumbnail re-encode failed', hash, e);
        }
        onIdle(next);
      })();
    };
    onIdle(next);
  })().catch((e) => console.warn('[library] thumbnail re-encode pass failed', e));
}

let refreshing = false;

const LOG_EVERY = 25;

export function refreshStaleThumbs(onTile?: (hash: string) => void): void {
  if (refreshing) return;
  refreshing = true;
  void (async () => {
    const games = await listGames();
    const stale = games.filter((g) => g.thumbRule !== THUMB_RULE);
    const played = (g: GameMeta): number => lastPlayed(g) ?? 0;
    const queue = stale
      .map((g, i) => ({ hash: g.hash, played: played(g), i }))
      .sort((a, b) => (b.played - a.played) || (a.i - b.i))
      .map((g) => g.hash);
    const total = queue.length;
    let done = 0;
    let redrawn = 0;
    if (total) console.log(`[library] ${total} tile(s) drawn under an older rule than ${THUMB_RULE}; redrawing, recently played first`);
    else console.log(`[library] every tile is drawn under tile rule ${THUMB_RULE}`);

    const next = (): void => {
      const hash = queue.shift();
      if (hash === undefined) {
        if (redrawn) console.log(`[library] redrew ${redrawn} tile(s) under tile rule ${THUMB_RULE}`);
        return;
      }
      void (async () => {
        try {
          const meta = await refreshThumb(hash);
          if (meta.thumbRule === THUMB_RULE) {
            redrawn++;
            onTile?.(hash);
          }
        } catch (e) {
          console.warn('[library] tile redraw failed', hash, e);
        }
        done++;
        if (done % LOG_EVERY === 0 && done < total) {
          console.log(`[library] tile redraw ${done}/${total} under tile rule ${THUMB_RULE}`);
        }
        onIdle(next);
      })();
    };
    onIdle(next);
  })().catch((e) => console.warn('[library] tile redraw pass failed', e));
}
