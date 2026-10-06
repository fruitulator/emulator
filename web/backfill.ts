import { onIdle } from './idle';
import { backfillContentHash } from './importer';
import { MAKER_RULE } from './maker';
import { CONTENT_RULE, MISSING_ROM_RULE, listGames } from './store';

let started = false;

export function backfillContentHashes(onUnblocked?: () => void): void {
  if (started) return;
  started = true;
  void (async () => {
    const games = await listGames();
    const queue = games
      .filter((g) => g.contentHash === undefined || g.contentRule !== CONTENT_RULE
        || g.makerRule !== MAKER_RULE
        || (!!g.missingRoms?.length && g.missingRule !== MISSING_ROM_RULE))
      .map((g) => g.hash);
    const refused = new Set(games.filter((g) => g.missingRoms?.length).map((g) => g.hash));
    let stamped = 0;

    const next = (): void => {
      const hash = queue.pop();
      if (hash === undefined) {
        if (stamped) console.log(`[library] content hash back-filled on ${stamped} record(s)`);
        return;
      }
      void (async () => {
        try {
          const meta = await backfillContentHash(hash);
          if (meta.contentHash !== undefined) stamped++;
          if (refused.has(hash) && !meta.missingRoms?.length) {
            console.log('[library] a set refused for missing ROMs runs after all; card unblocked', hash);
            onUnblocked?.();
          }
        } catch (e) {
          console.warn('[library] content hash back-fill failed', hash, e);
        }
        onIdle(next);
      })();
    };
    onIdle(next);
  })().catch((e) => console.warn('[library] content hash back-fill pass failed', e));
}
