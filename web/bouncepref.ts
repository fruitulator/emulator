
export const REEL_BOUNCE_STORE = 'fruitulator.reelBounce';

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function storedReelBounceOn(): boolean {
  try {
    return store()?.getItem(REEL_BOUNCE_STORE) !== 'off';
  } catch {
    return true;
  }
}

let on = storedReelBounceOn();

export function reelBounceOn(): boolean {
  return on;
}

export function setReelBounceOn(next: boolean): void {
  on = next;
  try {
    store()?.setItem(REEL_BOUNCE_STORE, next ? 'on' : 'off');
  } catch {
  }
}

export function reloadReelBouncePref(): void {
  on = storedReelBounceOn();
}

export function drawnBounce(r: { bounce?: number }): number {
  return on ? (r.bounce ?? 0) : 0;
}
