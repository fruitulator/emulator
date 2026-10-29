
export function createOrbitCaption(root) {
  const orbit = root;
  const cap = root.querySelector('.nb-orbit__caption');
  const title = cap.querySelector('.nb-orbit__title');
  const chips = cap.querySelector('.nb-orbit__chips');
  const cta = root.querySelector('.nb-orbit__cta');
  const ctaLabel = cta.querySelector('.nb-orbit__cta-label');

  const OUT_MS = 120;
  const IN_MS = 220 + 40;
  const FAST_MS = 160;
  let shown = null, pending = null, lastChange = -Infinity, outTimer = 0, isMoving = false;
  let inFrame = 0, inTimer = 0, ctaTimer = 0;

  function clearTimers() {
    clearTimeout(outTimer); clearTimeout(inTimer); clearTimeout(ctaTimer);
    cancelAnimationFrame(inFrame);
    outTimer = inTimer = ctaTimer = inFrame = 0;
  }

  function apply(game, { cta: swapCta = true } = {}) {
    title.textContent = game.title;
    chips.innerHTML = game.chipsHtml;
    shown = game;
    if (swapCta && ctaLabel.textContent !== game.ctaLabel) {
      cta.setAttribute('data-swapping', '');
      clearTimeout(ctaTimer);
      ctaTimer = setTimeout(() => { ctaLabel.textContent = game.ctaLabel; cta.removeAttribute('data-swapping'); }, 90);
    }
  }

  function reveal(game) {
    apply(game);
    cap.dataset.state = 'enter';
    cap.offsetHeight;
    const done = () => {
      cancelAnimationFrame(inFrame); clearTimeout(inTimer);
      inFrame = inTimer = 0;
      if (cap.dataset.state === 'enter') cap.dataset.state = 'in';
    };
    inFrame = requestAnimationFrame(done);
    inTimer = setTimeout(done, IN_MS + 50);
  }

  function swap(game) {
    clearTimers();
    cap.dataset.state = 'out';
    outTimer = setTimeout(() => reveal(game), OUT_MS);
  }

  function settle(game) {
    clearTimers();
    pending = null;
    isMoving = false;
    orbit.removeAttribute('data-moving');
    title.textContent = game.title;
    chips.innerHTML = game.chipsHtml;
    ctaLabel.textContent = game.ctaLabel;
    cta.removeAttribute('data-swapping');
    shown = game;
    cap.dataset.state = 'in';
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    const game = pending || shown;
    if (game && (cap.dataset.state !== 'in' || outTimer || inTimer || ctaTimer)) settle(game);
  });

  return {
    update(game) {
      if (shown && game.title === shown.title && game.chipsHtml === shown.chipsHtml
        && game.ctaLabel === shown.ctaLabel && !pending) return;
      const now = performance.now();
      const fast = now - lastChange < FAST_MS;
      lastChange = now;
      pending = game;
      if (fast || cap.dataset.state === 'scrub') {
        clearTimers();
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
    settle,
    replay(game) {
      settle(game);
      reveal(game);
    },
  };
}
