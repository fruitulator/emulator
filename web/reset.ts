import { eraseLibrary } from './store';

export { EraseBlockedError } from './store';

const PREFIXES = ['fruitulator.', 'fruitulator:', 'mahooma:'];

export function clearPrefs(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>): string[] {
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && PREFIXES.some((p) => k.startsWith(p))) doomed.push(k);
  }
  for (const k of doomed) storage.removeItem(k);
  return doomed;
}

export async function eraseEverything(): Promise<void> {
  await eraseLibrary();
  for (const area of [localStorage, sessionStorage]) {
    try {
      clearPrefs(area);
    } catch {
    }
  }
}
