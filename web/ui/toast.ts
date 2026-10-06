import { str } from '../i18n';

export interface ToastOptions {
  action?: { label: string; run: () => void };
  sticky?: boolean;
  ms?: number;
}

const TOAST_MS = 8_000;
const HIDE_MS = 240;

let shown: HTMLElement | null = null;
let timer = 0;

export function showToast(message: string, opts: ToastOptions = {}): void {
  const { action, sticky = false, ms = TOAST_MS } = opts;
  shown?.remove();
  clearTimeout(timer);
  const el = document.createElement('div');
  el.className = 'ui-toast';
  el.setAttribute('role', 'status');
  const msg = document.createElement('span');
  msg.className = 'ui-toast-msg';
  msg.textContent = message;
  el.append(msg);
  if (action) {
    const act = document.createElement('button');
    act.type = 'button';
    act.className = 'ui-toast-act';
    act.textContent = action.label;
    act.addEventListener('click', (ev) => {
      ev.stopPropagation();
      action.run();
      hideToast();
    });
    el.append(act);
  }
  if (sticky) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ui-toast-close';
    close.setAttribute('aria-label', str('ui.toast.dismiss'));
    close.textContent = '×';
    el.append(close);
    el.classList.add('sticky');
    el.addEventListener('click', () => hideToast());
  }
  document.body.append(el);
  shown = el;
  requestAnimationFrame(() => {
    if (shown !== el) return;
    if (msg.getClientRects().length > 1 || msg.offsetHeight > 30) el.classList.add('tall');
    el.classList.add('open');
  });
  timer = sticky ? 0 : window.setTimeout(hideToast, ms);
}

export function hideToast(): void {
  clearTimeout(timer);
  timer = 0;
  const el = shown;
  if (!el) return;
  shown = null;
  el.classList.add('leaving');
  el.classList.remove('open');
  window.setTimeout(() => el.remove(), HIDE_MS);
}
