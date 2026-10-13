
const HOVER_WAIT = 350;
const GAP = 8;
const EDGE = 8;

let bubble: HTMLDivElement | null = null;
let head: HTMLElement;
let line: HTMLElement;
let owner: HTMLElement | null = null;
let timer = 0;

function ensure(): HTMLDivElement {
  if (bubble) return bubble;
  bubble = document.createElement('div');
  bubble.className = 'ui-tip';
  bubble.id = 'ui-tip';
  bubble.setAttribute('role', 'tooltip');
  bubble.hidden = true;
  head = document.createElement('strong');
  line = document.createElement('span');
  bubble.append(head, line);
  document.body.append(bubble);
  const hideAll = (): void => hide();
  window.addEventListener('scroll', hideAll, { passive: true, capture: true });
  window.addEventListener('resize', hideAll);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  return bubble;
}

function show(el: HTMLElement, name: string, what: string): void {
  const b = ensure();
  owner = el;
  head.textContent = name;
  line.textContent = what;
  b.hidden = false;
  b.classList.remove('up');
  const r = el.getBoundingClientRect();
  const w = b.offsetWidth;
  const h = b.offsetHeight;
  const mid = r.left + r.width / 2;
  const left = Math.max(EDGE, Math.min(window.innerWidth - EDGE - w, mid - w / 2));
  const below = r.bottom + GAP + h + EDGE <= window.innerHeight;
  b.classList.toggle('above', !below);
  b.style.left = `${Math.round(left)}px`;
  b.style.top = `${Math.round(below ? r.bottom + GAP : r.top - GAP - h)}px`;
  b.style.setProperty('--tip-x', `${Math.round(mid - left)}px`);
  requestAnimationFrame(() => { if (owner === el) b.classList.add('up'); });
}

function hide(): void {
  clearTimeout(timer);
  owner = null;
  if (bubble) { bubble.classList.remove('up'); bubble.hidden = true; }
}

export function bubbleTip(el: HTMLElement, name: string, what: string): void {
  el.removeAttribute('title');
  el.dataset.tipName = name;
  el.dataset.tipText = what;
  el.setAttribute('aria-describedby', 'ui-tip');
  if (el.dataset.tip) return;
  el.dataset.tip = '1';
  const now = (): void => show(el, el.dataset.tipName!, el.dataset.tipText!);
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(timer);
    timer = window.setTimeout(now, HOVER_WAIT);
  });
  el.addEventListener('pointerleave', hide);
  el.addEventListener('focus', () => { if (el.matches(':focus-visible')) now(); });
  el.addEventListener('blur', hide);
  el.addEventListener('pointerdown', hide);
  el.addEventListener('click', hide);
}
