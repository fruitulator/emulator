const COUNT_MS = 900;

export function countUp(el: HTMLElement, value: number, format: (v: number) => string, ms = COUNT_MS): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const final = el.textContent;
  let start = 0;
  const frame = (now: number): void => {
    if (!el.isConnected) return;
    if (!start) {
      start = now;
      el.style.minWidth = getComputedStyle(el).width;
    }
    const t = Math.min(1, (now - start) / ms);
    if (t < 1) {
      el.textContent = format(Math.round(value * (1 - (1 - t) ** 3)));
      requestAnimationFrame(frame);
    } else {
      el.textContent = final;
      el.style.minWidth = '';
    }
  };
  requestAnimationFrame(frame);
}
