
const FADE_FALLBACK_MS = 400;

export function fadeToBlack(el: HTMLElement): Promise<void> {
  const already = el.hasAttribute('data-on');
  el.setAttribute('data-on', '');
  if (already) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      el.removeEventListener('transitionend', onEnd);
      window.clearTimeout(timer);
      resolve();
    };
    const onEnd = (e: TransitionEvent): void => {
      if (e.target === el && e.propertyName === 'opacity') done();
    };
    el.addEventListener('transitionend', onEnd);
    const timer = window.setTimeout(done, FADE_FALLBACK_MS);
  });
}

export function fadeFromBlack(el: HTMLElement): void {
  el.removeAttribute('data-on');
}
