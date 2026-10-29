import { str } from '../i18n';
import { rowIcon, UI_ICONS } from './icons';

export type ToastKind = 'info' | 'warn' | 'error' | 'ok';

export interface ToastOptions {
  action?: { label: string; run: () => void };
  sticky?: boolean;
  ms?: number;
  error?: boolean;
  kind?: ToastKind;
}

const TOAST_MS = 6_000;

let stack: HTMLElement | null = null;
function stackEl(): HTMLElement {
  if (stack?.isConnected) return stack;
  stack = document.createElement('div');
  stack.className = 'ui-toasts';
  document.body.append(stack);
  return stack;
}

export function showToast(message: string, opts: ToastOptions = {}): () => void {
  const { action, ms = TOAST_MS } = opts;
  const kind: ToastKind = opts.kind ?? (opts.error ? 'error' : 'info');
  const stays = opts.sticky === true || kind === 'error';
  const el = document.createElement('div');
  el.className = kind === 'info' ? 'nb-toast' : `nb-toast nb-toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const msg = document.createElement('p');
  msg.textContent = message;
  el.append(msg);
  let timer = 0;
  const hide = (): void => {
    clearTimeout(timer);
    el.remove();
  };
  if (action) {
    const act = document.createElement('button');
    act.type = 'button';
    act.className = 'nb-btn nb-btn--sm';
    act.textContent = action.label;
    act.addEventListener('click', () => {
      action.run();
      hide();
    });
    el.append(act);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'nb-toast__close';
  close.setAttribute('aria-label', str('ui.toast.dismiss'));
  close.append(rowIcon(UI_ICONS.cross, 'row-icon', 16).firstElementChild!);
  close.addEventListener('click', hide);
  el.append(close);
  stackEl().append(el);
  if (!stays) timer = window.setTimeout(hide, ms);
  return hide;
}

export function holdToast(): { say(text: string): void; close(): void } {
  const el = document.createElement('div');
  el.className = 'nb-toast';
  el.setAttribute('role', 'status');
  const msg = document.createElement('p');
  el.append(msg);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'nb-toast__close';
  close.setAttribute('aria-label', str('ui.toast.dismiss'));
  close.append(rowIcon(UI_ICONS.cross, 'row-icon', 16).firstElementChild!);
  close.addEventListener('click', () => el.remove());
  el.append(close);
  return {
    say: (text) => { msg.textContent = text; if (!el.isConnected) stackEl().append(el); },
    close: () => el.remove(),
  };
}

export function hideToast(): void {
  stack?.replaceChildren();
}
