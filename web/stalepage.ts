export const STALE_RELOAD_KEY = 'fruitulator.staleReload';

export function reloadStalePageOnce(
  build: string,
  store: Pick<Storage, 'getItem' | 'setItem'> | null,
  reload: () => void,
): boolean {
  if (!store) return false;
  try {
    if (store.getItem(STALE_RELOAD_KEY) === build) return false;
    store.setItem(STALE_RELOAD_KEY, build);
  } catch {
    return false;
  }
  reload();
  return true;
}

export function sessionStorageOrNull(): Storage | null {
  try { return sessionStorage; } catch { return null; }
}
