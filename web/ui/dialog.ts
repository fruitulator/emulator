import { UI_ICONS } from './icons';
import { str } from '../i18n';

export interface Dialog {
  panel: HTMLElement;
  body: HTMLElement;
  close(): void;
}

export function openDialog(o: {
  title: string; body: Node[]; onClose?: () => void; frost?: boolean; actions?: HTMLElement[];
}): Dialog {
  const backdrop = document.createElement('div');
  backdrop.className = o.frost ? 'ui-dialog-backdrop ui-dialog-frost' : 'ui-dialog-backdrop';
  const panel = document.createElement('div');
  panel.className = 'ui-dialog';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const bar = document.createElement('div');
  bar.className = 'about-bar';
  const h = document.createElement('h2');
  h.textContent = o.title;
  h.id = `ui-dialog-${Math.random().toString(36).slice(2, 8)}`;
  panel.setAttribute('aria-labelledby', h.id);
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'iconbtn';
  x.setAttribute('aria-label', str('ui.dialog.close'));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = UI_ICONS.cross;
  x.append(svg);
  const acts = document.createElement('div');
  acts.className = 'ui-dialog-actions';
  acts.append(...(o.actions ?? []), x);
  bar.append(h, acts);
  const scroll = document.createElement('div');
  scroll.className = 'ui-dialog-scroll';
  const body = document.createElement('div');
  body.className = 'ui-dialog-body';
  body.append(...o.body);
  scroll.append(body);
  panel.append(bar, scroll);
  const onKey = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
  const close = (): void => {
    backdrop.remove();
    panel.remove();
    document.removeEventListener('keydown', onKey);
    o.onClose?.();
  };
  x.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop, panel);
  x.focus({ preventScroll: true });
  return { panel, body, close };
}

export interface Alert {
  root: HTMLElement;
  close(): void;
}

export function openAlert(o: {
  message: string; lines?: string[]; buttons: { button: HTMLButtonElement; run: () => void }[]; onClose?: () => void;
  keysThrough?: boolean;
}): Alert {
  const root = document.createElement('div');
  root.className = 'ui-alert';
  const box = document.createElement('div');
  box.className = 'ui-alert-box';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  const msg = document.createElement('div');
  msg.className = 'ui-alert-msg';
  msg.textContent = o.message;
  msg.id = `ui-alert-${Math.random().toString(36).slice(2, 8)}`;
  box.setAttribute('aria-labelledby', msg.id);
  box.append(msg);
  if (o.lines?.length) {
    const hint = document.createElement('div');
    hint.className = 'ui-alert-hint';
    for (const l of o.lines) {
      const d = document.createElement('div');
      d.textContent = l;
      hint.append(d);
    }
    box.append(hint);
  }
  const btns = document.createElement('div');
  btns.className = 'ui-alert-btns';
  let closed = false;
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); return; }
    if (!o.keysThrough) ev.stopPropagation();
  };
  const remove = (): void => {
    if (closed) return;
    closed = true;
    root.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const close = (): void => {
    if (closed) return;
    remove();
    o.onClose?.();
  };
  for (const b of o.buttons) {
    b.button.addEventListener('click', () => { remove(); b.run(); });
    btns.append(b.button);
  }
  box.append(btns);
  root.append(box);
  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  o.buttons[0]?.button.focus({ preventScroll: true });
  return { root, close };
}
