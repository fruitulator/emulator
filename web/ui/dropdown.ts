export interface Dropdown {
  refresh(): void;
  close(): void;
}

const SVG = 'http://www.w3.org/2000/svg';

function chevron(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('dd-chev');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', 'M6 9l6 6 6-6');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

export function enhanceSelect(select: HTMLSelectElement): Dropdown {
  const root = document.createElement('div');
  root.className = 'dd';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const value = document.createElement('span');
  value.className = 'dd-value';
  value.id = `${select.id}-value`;
  btn.append(value, chevron());

  const list = document.createElement('ul');
  list.className = 'dd-list';
  list.id = `${select.id}-list`;
  list.setAttribute('role', 'listbox');
  list.tabIndex = -1;

  const labelledBy = select.getAttribute('aria-labelledby');
  if (labelledBy) {
    btn.setAttribute('aria-labelledby', `${labelledBy} ${value.id}`);
    list.setAttribute('aria-labelledby', labelledBy);
  } else {
    const label = select.getAttribute('aria-label') ?? '';
    btn.setAttribute('aria-label', label);
    list.setAttribute('aria-label', label);
  }

  const opts = [...select.options].map((o, i) => {
    const li = document.createElement('li');
    li.className = 'dd-opt';
    li.id = `${select.id}-opt-${i}`;
    li.setAttribute('role', 'option');
    li.dataset.value = o.value;
    li.style.setProperty('--d', `${i * 30}ms`);
    const tick = document.createElement('i');
    tick.className = 'dd-tick';
    tick.setAttribute('aria-hidden', 'true');
    li.append(tick, document.createTextNode(o.text));
    li.addEventListener('pointerenter', () => setActive(i));
    li.addEventListener('click', () => pick(i));
    return li;
  });
  list.append(...opts);

  let open = false;
  let active = 0;

  function refresh(): void {
    const i = Math.max(0, select.selectedIndex);
    value.textContent = select.options[i]?.text ?? '';
    opts.forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
  }

  function setActive(i: number): void {
    active = ((i % opts.length) + opts.length) % opts.length;
    opts.forEach((li, k) => li.classList.toggle('active', k === active));
    list.setAttribute('aria-activedescendant', opts[active].id);
  }

  function place(): void {
    const r = btn.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    list.style.minWidth = `${Math.max(r.width, 172)}px`;
    const w = list.offsetWidth;
    const h = list.offsetHeight;
    const below = innerHeight - r.bottom - gap - edge;
    const up = h > below && r.top - gap - edge > below;
    list.classList.toggle('dd-up', up);
    list.style.top = `${up ? Math.max(edge, r.top - gap - h) : r.bottom + gap}px`;
    list.style.left = `${Math.max(edge, Math.min(r.left, innerWidth - w - edge))}px`;
    list.style.maxHeight = `${Math.max(120, up ? r.top - gap - edge : below)}px`;
  }

  function onMove(ev: Event): void {
    if (ev.type === 'scroll' && list.contains(ev.target as Node)) return;
    hide(false);
  }

  function show(): void {
    if (open || !opts.length) return;
    open = true;
    document.body.append(list);
    list.classList.add('dd-float');
    place();
    root.classList.add('open');
    list.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    setActive(Math.max(0, select.selectedIndex));
    list.focus({ preventScroll: true });
    document.addEventListener('pointerdown', onOutside, true);
    addEventListener('scroll', onMove, true);
    addEventListener('resize', onMove);
  }

  function hide(refocus: boolean): void {
    if (!open) return;
    open = false;
    root.classList.remove('open');
    list.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    list.removeAttribute('aria-activedescendant');
    document.removeEventListener('pointerdown', onOutside, true);
    removeEventListener('scroll', onMove, true);
    removeEventListener('resize', onMove);
    if (refocus) btn.focus({ preventScroll: true });
    setTimeout(() => {
      if (open) return;
      list.classList.remove('dd-float', 'dd-up');
      list.removeAttribute('style');
      root.append(list);
    }, 260);
  }

  function pick(i: number): void {
    const v = opts[i].dataset.value!;
    const changed = select.value !== v;
    select.value = v;
    refresh();
    hide(true);
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function onOutside(ev: PointerEvent): void {
    if (!root.contains(ev.target as Node) && !list.contains(ev.target as Node)) hide(false);
  }

  function typeahead(ch: string): void {
    const c = ch.toLowerCase();
    for (let k = 1; k <= opts.length; k++) {
      const i = (active + k) % opts.length;
      if (opts[i].textContent!.trim().toLowerCase().startsWith(c)) { setActive(i); return; }
    }
  }

  btn.addEventListener('click', () => { if (open) hide(true); else show(); });
  btn.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      show();
    }
  });
  list.addEventListener('keydown', (ev) => {
    switch (ev.key) {
      case 'ArrowDown': setActive(active + 1); break;
      case 'ArrowUp': setActive(active - 1); break;
      case 'Home': setActive(0); break;
      case 'End': setActive(opts.length - 1); break;
      case 'Enter':
      case ' ': pick(active); break;
      case 'Escape': hide(true); break;
      case 'Tab': hide(false); return;
      default:
        if (ev.key.length !== 1 || ev.altKey || ev.ctrlKey || ev.metaKey) return;
        typeahead(ev.key);
    }
    ev.preventDefault();
    ev.stopPropagation();
  });
  const leaving = (ev: FocusEvent): void => {
    const to = ev.relatedTarget as Node | null;
    if (!root.contains(to) && !list.contains(to)) hide(false);
  };
  root.addEventListener('focusout', leaving);
  list.addEventListener('focusout', leaving);

  root.append(btn, list);
  select.insertAdjacentElement('beforebegin', root);
  select.hidden = true;
  select.tabIndex = -1;
  refresh();
  return { refresh, close: () => hide(false) };
}
