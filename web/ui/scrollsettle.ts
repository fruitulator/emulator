export function scrollFromOpen(el: HTMLElement): void {
  el.classList.toggle('nb-scrolls', laidOutHeight(el) > el.clientHeight + 1);
  if (!guarded.has(el)) {
    guarded.add(el);
    el.addEventListener('wheel', holdWheel, { passive: false });
  }
}

export function revealNearest(box: HTMLElement, row: HTMLElement): void {
  if (row.offsetParent !== box) return;
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  if (top < box.scrollTop) box.scrollTop = top;
  else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
}

const guarded = new WeakSet<HTMLElement>();

function holdWheel(ev: WheelEvent): void {
  const box = ev.currentTarget as HTMLElement;
  if (ev.ctrlKey || box.classList.contains('nb-scrolls')) return;
  for (let n = ev.target as HTMLElement | null; n && n !== box; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return;
  }
  ev.preventDefault();
}

function laidOutHeight(el: HTMLElement): number {
  let bottom = 0;
  for (const c of el.children) {
    if (!(c instanceof HTMLElement) || c.getClientRects().length === 0) continue;
    if (c.offsetParent !== el) return el.scrollHeight;
    bottom = Math.max(bottom, c.offsetTop + c.offsetHeight + (parseFloat(getComputedStyle(c).marginBottom) || 0));
  }
  return bottom + (parseFloat(getComputedStyle(el).paddingBottom) || 0);
}
