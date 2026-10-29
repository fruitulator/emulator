
export function createOrbitCaption(root) {
  const orbit = root;
  const cap = root.querySelector('.nb-orbit__caption');
  const title = cap.querySelector('.nb-orbit__title');
  const chips = cap.querySelector('.nb-orbit__chips');
  const cta = root.querySelector('.nb-orbit__cta');
  const ctaLabel = cta.querySelector('.nb-orbit__cta-label');

  const OUT_MS = 120;
  const FAST_MS = 160;
  let shown = null, pending = null, lastChange = -Infinity, outTimer = 0, isMoving = false;

  function apply(game, { cta: swapCta = true } = {}) {
    title.textContent = game.title;
    chips.innerHTML = game.chipsHtml;
    shown = game;
    if (swapCta && ctaLabel.textContent !== game.ctaLabel) {
      cta.setAttribute('data-swapping', '');
      setTimeout(() => { ctaLabel.textContent = game.ctaLabel; cta.removeAttribute('data-swapping'); }, 90);
    }
  }

  function reveal(game) {
    apply(game);
    cap.dataset.state = 'enter';
    cap.offsetHeight;
    requestAnimationFrame(() => { cap.dataset.state = 'in'; });
  }

  function swap(game) {
    clearTimeout(outTimer);
    cap.dataset.state = 'out';
    outTimer = setTimeout(() => reveal(game), OUT_MS);
  }

  return {
    update(game) {
      if (shown && game.title === shown.title && game.chipsHtml === shown.chipsHtml
        && game.ctaLabel === shown.ctaLabel && !pending) return;
      const now = performance.now();
      const fast = now - lastChange < FAST_MS;
      lastChange = now;
      pending = game;
      if (fast || cap.dataset.state === 'scrub') {
        clearTimeout(outTimer);
        cap.dataset.state = 'scrub';
        apply(game, { cta: false });
        return;
      }
      pending = null;
      swap(game);
    },
    moving(on) {
      isMoving = on;
      orbit.toggleAttribute('data-moving', on);
      if (!on && cap.dataset.state === 'scrub') {
        const game = pending || shown;
        pending = null;
        swap(game);
      }
    },
  };
}
