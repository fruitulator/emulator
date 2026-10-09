const MACHINE_LOCK = 'fruitulator:machine';

type Locks = {
  request(name: string, opts: { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean },
    cb: (lock: unknown) => unknown): Promise<unknown>;
};
const locks = (): Locks | null =>
  (typeof navigator !== 'undefined' && (navigator as { locks?: Locks }).locks) || null;

let held = 0;
let release: (() => void) | null = null;

export function holdBusy(): () => void {
  held++;
  if (held === 1) publish();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    held--;
    if (held === 0) { release?.(); release = null; }
  };
}

export const isBusy = (): boolean => held > 0;

export async function probeBusy(): Promise<boolean> {
  if (held > 0) return true;
  const l = locks();
  if (!l) return false;
  try {
    return await l.request(MACHINE_LOCK, { mode: 'shared', ifAvailable: true },
      (lock) => lock === null) as boolean;
  } catch {
    return false;
  }
}

function publish(): void {
  const l = locks();
  if (!l) return;
  const gone = new Promise<void>((resolve) => { release = resolve; });
  void l.request(MACHINE_LOCK, { mode: 'exclusive' }, () => (held > 0 ? gone : undefined))
    .catch(() => undefined);
}

export async function onlyOneTab(name: string, fn: () => Promise<void>): Promise<boolean> {
  const l = locks();
  if (!l) { await fn(); return true; }
  return await l.request(`fruitulator:${name}`, { ifAvailable: true }, async (lock) => {
    if (lock === null) return false;
    await fn();
    return true;
  }) as boolean;
}
