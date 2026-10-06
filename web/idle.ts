export const IDLE_TIMEOUT_MS = 1000;

export const onIdle = (fn: () => void): void => {
  const ric = (globalThis as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (ric) ric(fn, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(fn, 250);
};
