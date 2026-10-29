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
  backdrop.className = o.frost ? 'ui-dialog-backdrop nb-backdrop ui-dialog-frost' : 'ui-dialog-backdrop nb-backdrop';
  const panel = document.createElement('div');
  panel.className = 'ui-dialog';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const card = document.createElement('div');
  card.className = 'nb-dialog ui-dialog-card';
  const bar = document.createElement('div');
  bar.className = 'nb-dialog__head about-bar';
  const h = document.createElement('h2');
  h.textContent = o.title;
  h.id = `ui-dialog-${Math.random().toString(36).slice(2, 8)}`;
  panel.setAttribute('aria-labelledby', h.id);
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'nb-icon-btn';
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
  body.className = 'nb-dialog__body ui-dialog-body';
  body.append(...o.body);
  scroll.append(body);
  card.append(bar, scroll);
  panel.append(card);
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

export function alertIcon(): HTMLElement {
  const tile = document.createElement('span');
  tile.className = 'nb-dialog__icon';
  tile.setAttribute('aria-hidden', 'true');
  tile.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${UI_ICONS.warn}</svg>`;
  return tile;
}

export function openAlert(o: {
  message: string; lines?: string[]; buttons: { button: HTMLButtonElement; run: () => void }[]; onClose?: () => void;
  info?: boolean;
  keysThrough?: boolean;
}): Alert {
  const root = document.createElement('div');
  root.className = 'ui-alert nb-backdrop';
  const box = document.createElement('div');
  box.className = o.info ? 'ui-alert-box nb-dialog' : 'ui-alert-box nb-dialog nb-dialog--error';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  const body = document.createElement('div');
  body.className = 'nb-dialog__body';
  const msg = document.createElement('p');
  msg.className = 'ui-alert-msg';
  msg.textContent = o.message;
  msg.id = `ui-alert-${Math.random().toString(36).slice(2, 8)}`;
  box.setAttribute('aria-labelledby', msg.id);
  body.append(msg);
  if (!o.info) {
    const head = document.createElement('div');
    head.className = 'nb-dialog__head';
    head.append(alertIcon());
    box.append(head);
  }
  if (o.lines?.length) {
    const hint = document.createElement('div');
    hint.className = 'ui-alert-hint';
    for (const l of o.lines) {
      const d = document.createElement('p');
      d.textContent = l;
      hint.append(d);
    }
    body.append(hint);
  }
  const btns = document.createElement('div');
  btns.className = 'ui-alert-btns nb-dialog__actions';
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
  body.append(btns);
  box.append(body);
  root.append(box);
  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  (o.buttons.find((b) => b.button.classList.contains('nb-btn--primary')) ?? o.buttons[0])?.button.focus({ preventScroll: true });
  return { root, close };
}
