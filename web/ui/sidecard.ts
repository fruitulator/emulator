let card: { el: HTMLElement; row: HTMLElement; off: () => void } | null = null;

export function openSideCard(el: HTMLElement, row: HTMLElement, panel: HTMLElement): boolean {
  closeSideCard();
  const GAP = 12;
  const EDGE = 8;
  el.style.visibility = 'hidden';
  el.style.left = '0px';
  el.style.top = '0px';
  document.body.append(el);
  const p = panel.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left: number | null = null;
  if (p.right + GAP + w <= innerWidth - EDGE) left = p.right + GAP;
  else if (p.left - GAP - w >= EDGE) left = p.left - GAP - w;
  if (left === null || h > innerHeight - 2 * EDGE) {
    el.remove();
    el.style.visibility = '';
    return false;
  }
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(Math.min(Math.max(EDGE, r.top), innerHeight - h - EDGE))}px`;
  el.style.visibility = '';
  row.setAttribute('aria-expanded', 'true');
  const outside = (e: PointerEvent): void => {
    const t = e.target as Node;
    if (!el.contains(t) && !row.contains(t)) closeSideCard();
  };
  const resize = (): void => closeSideCard();
  addEventListener('pointerdown', outside, true);
  addEventListener('resize', resize);
  card = { el, row, off: () => { removeEventListener('pointerdown', outside, true); removeEventListener('resize', resize); } };
  return true;
}

export function closeSideCard(): void {
  if (!card) return;
  const c = card;
  card = null;
  c.off();
  c.el.remove();
  c.row.setAttribute('aria-expanded', 'false');
}

export function sideCardOpen(row?: HTMLElement): boolean {
  return !!card && (!row || card.row === row);
}

export function escapeSideCard(): boolean {
  if (!card) return false;
  const row = card.row;
  closeSideCard();
  row.focus();
  return true;
}
