export function scrollWhenSettled(el: HTMLElement): void {
  el.classList.remove('nb-scrolls');
  requestAnimationFrame(() => {
    const running = (el.getAnimations?.({ subtree: true }) ?? [])
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    void Promise.allSettled(running.map((a) => a.finished)).then(() => {
      if (!el.isConnected) return;
      el.classList.toggle('nb-scrolls', el.scrollHeight > el.clientHeight + 1);
    });
  });
}
