const KEY = 'fruitulator.orbitLogoPlayed';

export function playEntrance(logo: Element): void {
  logo.classList.remove('is-entering');
  void logo.getBoundingClientRect();
  logo.classList.add('is-entering');
}

export function orbitLogoOnce(): void {
  const logo = document.querySelector('.nb-orbit__logo');
  const last = logo?.querySelector('.L[style*="--i:10"]');
  if (!logo || !last) return;
  try {
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, '1');
  } catch {
    return;
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  last.addEventListener('animationend', () => logo.classList.remove('is-entering'), { once: true });
  const go = (): void => {
    if (!document.body.classList.contains('boot-settled')) { requestAnimationFrame(go); return; }
    setTimeout(() => playEntrance(logo), 450);
  };
  go();
}
