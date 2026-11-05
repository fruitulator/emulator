import { UI_ICONS } from './icons';
import { str } from '../i18n';
import { openLayer } from './layer';

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
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    panel.remove();
    layer.release();
    o.onClose?.();
  };
  x.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.body.append(backdrop, panel);
  const layer = openLayer([backdrop, panel], { kind: 'dialog', close, focus: x });
  return { panel, body, close };
}

export interface Alert {
  root: HTMLElement;
  close(): void;
}

export type DialogStatus = 'error' | 'warning' | 'info';

const STATUS_GLYPH: Record<DialogStatus, string> = {
  error: UI_ICONS.cross,
  warning: UI_ICONS.warn,
  info: '<path d="M12 17.5V11" stroke-width="2.6"/><path d="M12 7h.01" stroke-width="3.4"/>',
};

export function alertIcon(status: DialogStatus = 'error'): HTMLElement {
  const tile = document.createElement('span');
  tile.className = status === 'error' ? 'nb-dialog__icon' : `nb-dialog__icon nb-dialog__icon--${status === 'warning' ? 'warn' : 'info'}`;
  tile.setAttribute('aria-hidden', 'true');
  tile.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${STATUS_GLYPH[status]}</svg>`;
  return tile;
}

export function fitActions(row: HTMLElement): void {
  const fit = (): void => {
    row.classList.remove('is-stacked');
    const shown = [...row.children].filter((c) => (c as HTMLElement).offsetParent !== null) as HTMLElement[];
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const need = shown.reduce((w, c) => w + c.getBoundingClientRect().width, 0) + gap * Math.max(0, shown.length - 1);
    if (need > row.clientWidth + 1) row.classList.add('is-stacked');
  };
  new ResizeObserver(fit).observe(row);
  fit();
}

export function openAlert(o: {
  message: string; title?: string; steps?: Node[]; note?: string;
  lines?: string[]; buttons: { button: HTMLButtonElement; run: () => void; dismiss?: boolean }[]; onClose?: () => void;
  info?: boolean; status?: DialogStatus;
  keysThrough?: boolean;
}): Alert {
  const status: DialogStatus = o.status ?? (o.title ? 'warning' : o.info ? 'info' : 'error');
  const root = document.createElement('div');
  root.className = 'ui-alert nb-backdrop';
  const box = document.createElement('div');
  box.className = `ui-alert-box nb-dialog${status === 'error' ? ' nb-dialog--error' : ''}`;
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  const id = `ui-alert-${Math.random().toString(36).slice(2, 8)}`;
  const head = document.createElement('div');
  head.className = 'nb-dialog__head';
  const h = document.createElement('h2');
  h.id = `${id}-title`;
  h.textContent = o.title ?? o.message;
  head.append(alertIcon(status), h);
  box.append(head);
  box.setAttribute('aria-labelledby', h.id);
  const body = document.createElement('div');
  body.className = 'nb-dialog__body';
  body.id = `${id}-body`;
  if (o.title) {
    const msg = document.createElement('p');
    msg.className = 'ui-alert-msg';
    msg.textContent = o.message;
    body.append(msg);
  } else h.classList.add('ui-alert-msg');
  if (o.steps?.length) {
    const list = document.createElement('ul');
    list.className = 'ui-alert-steps';
    for (const s of o.steps) {
      const li = document.createElement('li');
      li.append(s);
      list.append(li);
    }
    body.append(list);
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
  if (o.note) {
    const n = document.createElement('p');
    n.className = 'ui-alert-note';
    n.textContent = o.note;
    body.append(n);
  }
  if (body.childElementCount) {
    box.append(body);
    box.setAttribute('aria-describedby', body.id);
  }
  const btns = document.createElement('div');
  btns.className = 'ui-alert-btns nb-dialog__actions';
  let closed = false;
  const remove = (): void => {
    if (closed) return;
    closed = true;
    root.remove();
    layer?.release();
  };
  const close = (): void => {
    if (closed) return;
    remove();
    o.onClose?.();
  };
  for (const b of o.buttons) {
    b.button.addEventListener('click', () => { remove(); b.run(); });
    if (b.dismiss) b.button.classList.add('nb-dialog__dismiss');
    btns.append(b.button);
  }
  if (o.buttons.length) box.append(btns);
  root.append(box);
  document.body.append(root);
  fitActions(btns);
  const first = (o.buttons.find((b) => b.button.classList.contains('nb-btn--primary')) ?? o.buttons[0])?.button ?? null;
  const layer = openLayer([root], { kind: 'dialog', close, focus: first, keysThrough: o.keysThrough });
  return { root, close };
}
