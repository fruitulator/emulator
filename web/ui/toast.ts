import { str } from '../i18n';
import { holdClock } from './holdclock';
import { rowIcon, UI_ICONS } from './icons';

export type ToastKind = 'info' | 'warn' | 'error' | 'ok';

export interface ToastOptions {
  action?: { label: string; run: () => void };
  sticky?: boolean;
  ms?: number;
  onExpire?: () => void;
  list?: readonly string[];
  error?: boolean;
  kind?: ToastKind;
}

const TOAST_MS = 6_000;

const OUT_MS = 150;

const KIND_ICON: Record<ToastKind, string> = {
  info: UI_ICONS.info,
  warn: UI_ICONS.warn,
  ok: UI_ICONS.tick,
  error: UI_ICONS.failed,
};

let stack: HTMLElement | null = null;
function stackEl(): HTMLElement {
  if (stack?.isConnected) return stack;
  stack = document.createElement('div');
  stack.className = 'ui-toasts';
  document.body.append(stack);
  return stack;
}

function goAway(el: HTMLElement): void {
  if (!el.isConnected || el.classList.contains('nb-toast--out')) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { el.remove(); return; }
  el.classList.add('nb-toast--out');
  window.setTimeout(() => el.remove(), OUT_MS);
}

function closeButton(onClose: () => void): HTMLButtonElement {
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'nb-toast__close';
  close.setAttribute('aria-label', str('ui.toast.dismiss'));
  close.append(rowIcon(UI_ICONS.cross, 'row-icon', 14).firstElementChild!);
  close.addEventListener('click', onClose);
  return close;
}

function toastText(message: string, list?: readonly string[]): HTMLElement {
  const text = document.createElement('div');
  text.className = 'nb-toast__text';
  if (!list) { text.textContent = message; return text; }
  const rows = document.createElement('ul');
  rows.className = 'nb-toast__list';
  for (const item of list) {
    const row = document.createElement('li');
    row.textContent = item;
    rows.append(row);
  }
  const sentence = document.createElement('div');
  sentence.textContent = message;
  text.append(sentence, rows);
  return text;
}

export function showToast(message: string, opts: ToastOptions = {}): () => void {
  const { action, ms = TOAST_MS } = opts;
  const kind: ToastKind = opts.kind ?? (opts.error ? 'error' : 'info');
  const stays = opts.sticky === true;
  const el = document.createElement('div');
  el.className = kind === 'info' ? 'nb-toast' : `nb-toast nb-toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.append(rowIcon(KIND_ICON[kind], 'nb-toast__icon', 20), toastText(message, opts.list));
  let stopClock = (): void => undefined;
  const hide = (): void => {
    stopClock();
    goAway(el);
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
  if (stays) el.append(closeButton(hide));
  stackEl().append(el);
  if (!stays) {
    stopClock = holdClock(el, ms, () => {
      opts.onExpire?.();
      hide();
    });
  }
  return hide;
}

export function holdToast(): { say(text: string): void; close(): void } {
  const el = document.createElement('div');
  el.className = 'nb-toast';
  el.setAttribute('role', 'status');
  const msg = toastText('');
  el.append(rowIcon(KIND_ICON.info, 'nb-toast__icon', 20), msg, closeButton(() => el.remove()));
  return {
    say: (text) => { msg.textContent = text; if (!el.isConnected) stackEl().append(el); },
    close: () => el.remove(),
  };
}

export function hideToast(): void {
  for (const el of Array.from(stack?.children ?? [])) goAway(el as HTMLElement);
}
