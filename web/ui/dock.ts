import { rowIcon, UI_ICONS } from './icons';
import { str } from '../i18n';

export interface Dock {
  root: HTMLElement;
  show(nodes: Node[], slide?: 'in' | 'out' | 'none'): void;
  close(): void;
  readonly isOpen: boolean;
}

let current: Dock | null = null;

export function openDock(o: {
  title: string; body: Node[]; onClose?: () => void;
  onEscape?: () => boolean;
}): Dock {
  current?.close();
  const root = document.createElement('aside');
  root.className = 'ui-dock';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', o.title);
  const head = document.createElement('div');
  head.className = 'ui-dock-head';
  const title = document.createElement('h2');
  title.className = 'ui-dock-title';
  title.textContent = o.title;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'ui-dock-close';
  x.setAttribute('aria-label', str('ui.dock.close'));
  x.append(rowIcon(UI_ICONS.cross, 'row-icon', 18));
  head.append(title, x);
  const body = document.createElement('div');
  body.className = 'ui-dock-body';
  body.append(...o.body);
  root.append(head, body);
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('open'));

  let open = true;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !open) return;
    if ((e.target as Element | null)?.closest?.('.dd.open, .dd-list.open')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (o.onEscape?.()) return;
    dock.close();
  };
  addEventListener('keydown', onKey, true);
  const dock: Dock = {
    root,
    show(nodes, slide = 'none') {
      body.replaceChildren(...nodes);
      body.scrollTop = 0;
      body.classList.remove('ui-dock-in', 'ui-dock-out');
      if (slide !== 'none') {
        void body.offsetWidth;
        body.classList.add(slide === 'in' ? 'ui-dock-in' : 'ui-dock-out');
      }
    },
    get isOpen() { return open; },
    close() {
      if (!open) return;
      open = false;
      removeEventListener('keydown', onKey, true);
      root.classList.remove('open');
      setTimeout(() => root.remove(), 260);
      if (current === dock) current = null;
      o.onClose?.();
    },
  };
  x.addEventListener('click', () => dock.close());
  current = dock;
  return dock;
}
