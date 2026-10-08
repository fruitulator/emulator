import { str } from '../i18n';

export interface CoinMenuRow { label: string; sub?: string }

export interface CoinMenu { close(): void }

let current: CoinMenu | null = null;

export function coinMenuOpen(): boolean {
  return current !== null;
}

export function openCoinMenu(o: {
  rows: readonly CoinMenuRow[];
  at: { x: number; y: number } | null;
  onPick: (i: number) => void;
  onClose?: () => void;
}): CoinMenu {
  current?.close();
  const list = document.createElement('ul');
  list.className = 'dd-list dd-float open coin-menu';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', str('coinmenu.choose_a_coin'));
  list.tabIndex = -1;
  let down: HTMLElement | null = null;
  let active = 0;
  const opts = o.rows.map((r, i) => {
    const li = document.createElement('li');
    li.className = 'dd-opt';
    li.setAttribute('role', 'option');
    li.id = `coin-menu-opt-${i}`;
    const name = document.createElement('span');
    name.className = 'coin-menu-label';
    name.textContent = r.label;
    li.append(name);
    if (r.sub) {
      const s = document.createElement('span');
      s.className = 'coin-menu-sub';
      s.textContent = r.sub;
      li.append(s);
    }
    li.addEventListener('pointerenter', () => setActive(i));
    li.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); down = li; });
    li.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (down === li) pick(i);
    });
    return li;
  });
  list.append(...opts);

  function setActive(i: number): void {
    if (!opts.length) return;
    active = ((i % opts.length) + opts.length) % opts.length;
    opts.forEach((li, k) => li.classList.toggle('active', k === active));
    list.setAttribute('aria-activedescendant', opts[active].id);
  }

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    list.remove();
    removeEventListener('pointerdown', outside, true);
    removeEventListener('resize', away);
    removeEventListener('scroll', away, true);
    if (current === menu) current = null;
    o.onClose?.();
  }
  function pick(i: number): void {
    close();
    o.onPick(i);
  }
  function outside(ev: PointerEvent): void {
    if (!list.contains(ev.target as Node)) close();
  }
  function away(ev: Event): void {
    if (ev.type === 'scroll' && list.contains(ev.target as Node)) return;
    close();
  }

  list.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    switch (ev.key) {
      case 'ArrowDown': ev.preventDefault(); setActive(active + 1); break;
      case 'ArrowUp': ev.preventDefault(); setActive(active - 1); break;
      case 'Home': ev.preventDefault(); setActive(0); break;
      case 'End': ev.preventDefault(); setActive(opts.length - 1); break;
      case 'Enter': case ' ': ev.preventDefault(); pick(active); break;
      case 'Escape': ev.preventDefault(); close(); break;
      case 'Tab': close(); break;
    }
  });
  list.addEventListener('keyup', (ev) => ev.stopPropagation());

  document.body.append(list);
  setActive(0);
  const edge = 8;
  const w = list.offsetWidth;
  const h = list.offsetHeight;
  const top = opts[0];
  const rowMid = top ? top.offsetTop + top.offsetHeight / 2 : h / 2;
  const x = o.at ? o.at.x - Math.min(w / 2, 48) : (innerWidth - w) / 2;
  const y = o.at ? o.at.y - rowMid : (innerHeight - h) / 2;
  list.style.left = `${Math.max(edge, Math.min(x, innerWidth - w - edge))}px`;
  list.style.top = `${Math.max(edge, Math.min(y, innerHeight - h - edge))}px`;
  list.focus({ preventScroll: true });
  setTimeout(() => {
    if (closed) return;
    addEventListener('pointerdown', outside, true);
    addEventListener('resize', away);
    addEventListener('scroll', away, true);
  }, 0);

  const menu: CoinMenu = { close };
  current = menu;
  return menu;
}
