
const RESUME_MIN_MS = 2_000;

export function holdClock(el: HTMLElement | null, ms: number, done: () => void): () => void {
  let left = ms;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let focused = false;
  const off = new AbortController();
  const run = (): void => {
    startedAt = performance.now();
    timer = setTimeout(() => {
      off.abort();
      done();
    }, left);
  };
  const hold = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    left -= performance.now() - startedAt;
  };
  const resume = (): void => {
    if (timer !== null || off.signal.aborted) return;
    left = Math.max(left, RESUME_MIN_MS);
    run();
  };
  const on = { signal: off.signal };
  el?.addEventListener?.('pointerenter', hold, on);
  el?.addEventListener?.('pointerleave', () => { if (!focused) resume(); }, on);
  el?.addEventListener?.('focusin', () => { focused = true; hold(); }, on);
  el?.addEventListener?.('focusout', (e) => {
    if (el.contains((e as FocusEvent).relatedTarget as Node | null)) return;
    focused = false;
    if (!el.matches(':hover')) resume();
  }, on);
  run();
  return () => {
    off.abort();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}
