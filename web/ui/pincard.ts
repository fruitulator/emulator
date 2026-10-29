import { UI_ICONS } from './icons';
import { str } from '../i18n';

const PIN_LENGTH = 4;
const ERROR_MS = 650;
const LOCKING_MS = 400;

const narrow = (): boolean => typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches;

function svg(icon: string): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = icon;
  return s;
}

export interface Modal {
  card: HTMLElement;
  close(): void;
}

export function openModal(o: {
  width: number; sheet?: boolean; label: string;
  onKey?: (ev: KeyboardEvent) => boolean; onClose?: () => void; returnTo?: HTMLElement | null;
}): Modal {
  const backdrop = document.createElement('div');
  backdrop.className = 'ui-dialog-backdrop nb-backdrop pc-backdrop';
  const wrap = document.createElement('div');
  wrap.className = o.sheet ? 'pc-sheet-wrap' : 'ui-dialog pc-wrap';
  const card = document.createElement('div');
  card.className = o.sheet ? 'nb-bottom-sheet pc-card pc-card--sheet' : 'nb-dialog ui-dialog-card pc-card';
  card.style.setProperty('--pc-w', `${o.width}px`);
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', o.label);
  if (o.sheet) {
    const grab = document.createElement('div');
    grab.className = 'nb-bottom-sheet__grab';
    card.append(grab);
  }
  wrap.append(card);
  let open = true;
  const onKey = (ev: KeyboardEvent): void => {
    if (!open) return;
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (o.onKey?.(ev)) { ev.preventDefault(); return; }
    if (ev.key === 'Tab') {
      const stops = [...card.querySelectorAll<HTMLElement>('button:not(:disabled)')];
      if (!stops.length) return;
      const i = stops.indexOf(document.activeElement as HTMLElement);
      const next = ev.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i + 1) % stops.length;
      ev.preventDefault();
      stops[next].focus();
    }
  };
  const close = (): void => {
    if (!open) return;
    open = false;
    window.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    wrap.remove();
    if (o.returnTo?.isConnected) o.returnTo.focus({ preventScroll: true });
    o.onClose?.();
  };
  backdrop.addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.append(backdrop, wrap);
  return { card, close };
}

export function modalHead(o: {
  icon: string; tile: number; title: string; sub?: string; id: string; onClose: () => void;
}): { head: HTMLElement; title: HTMLElement; sub: HTMLElement } {
  const head = document.createElement('div');
  head.className = 'pc-head';
  const tile = document.createElement('span');
  tile.className = 'pc-tile';
  tile.style.setProperty('--pc-tile', `${o.tile}px`);
  tile.append(svg(o.icon));
  const words = document.createElement('div');
  words.className = 'pc-words';
  const h = document.createElement('h2');
  h.className = 'pc-title';
  h.id = o.id;
  h.textContent = o.title;
  const sub = document.createElement('p');
  sub.className = 'pc-sub';
  sub.textContent = o.sub ?? '';
  sub.hidden = !o.sub;
  words.append(h, sub);
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'nb-icon-btn pc-close';
  x.setAttribute('aria-label', str('ui.dialog.close'));
  x.append(svg(UI_ICONS.cross));
  x.addEventListener('click', o.onClose);
  head.append(tile, words, x);
  return { head, title: h, sub };
}

export type PinCheck = { ok: true } | { ok: false; left: number } | { ok: false; wait: number };

export type PinCardOptions = { returnTo?: HTMLElement | null; onClose?: () => void } & (
  | { mode: 'choose'; onChosen(pin: string): Promise<void> | void }
  | { mode: 'unlock'; check(pin: string): Promise<PinCheck>; cooldownLeft(): number; onUnlocked(): void }
);

const LETTERS: Record<string, string> = {
  2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ',
};

export function openPinCard(o: PinCardOptions): Modal {
  let stage: 'choose' | 'confirm' | 'unlock' = o.mode === 'choose' ? 'choose' : 'unlock';
  let digits = '';
  let first = '';
  let busy = false;
  let coolTimer = 0;
  let pending = 0;

  const id = `pc-${Math.random().toString(36).slice(2, 8)}`;
  const modal = openModal({
    width: 400,
    sheet: o.mode === 'unlock' && narrow(),
    label: id,
    returnTo: o.returnTo,
    onKey: (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return false;
      if (/^[0-9]$/.test(ev.key)) { press(ev.key); return true; }
      if (ev.key === 'Backspace') { backspace(); return true; }
      return false;
    },
    onClose: () => {
      window.clearInterval(coolTimer);
      window.clearTimeout(pending);
      o.onClose?.();
    },
  });
  const { head, title, sub } = modalHead({ icon: UI_ICONS.lock, tile: 56, title: '', id, onClose: modal.close });

  const dotsBox = document.createElement('div');
  dotsBox.className = 'pc-dots';
  dotsBox.setAttribute('role', 'status');
  const dots = Array.from({ length: PIN_LENGTH }, () => {
    const d = document.createElement('span');
    d.className = 'pc-dot';
    d.setAttribute('aria-hidden', 'true');
    return d;
  });
  const said = document.createElement('span');
  said.className = 'pc-said';
  dotsBox.append(...dots, said);

  const msg = document.createElement('p');
  msg.className = 'pc-msg';
  msg.setAttribute('aria-live', 'polite');

  const pad = document.createElement('div');
  pad.className = 'pc-pad';
  const keys: HTMLButtonElement[] = [];
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']) {
    if (!k) { pad.append(document.createElement('span')); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nb-btn pc-key';
    if (k === 'del') {
      b.classList.add('pc-key--del');
      b.setAttribute('aria-label', str('kioskmode.delete_digit'));
      b.append(svg(UI_ICONS.backspace));
      b.addEventListener('click', backspace);
    } else {
      b.setAttribute('aria-label', k);
      const n = document.createElement('span');
      n.className = 'pc-digit';
      n.textContent = k;
      const l = document.createElement('span');
      l.className = 'pc-letters';
      l.setAttribute('aria-hidden', 'true');
      l.textContent = LETTERS[k] ?? '';
      b.append(n, l);
      b.addEventListener('click', () => press(k));
    }
    keys.push(b);
    pad.append(b);
  }

  const body = document.createElement('div');
  body.className = 'pc-body';
  body.append(dotsBox, msg, pad);
  modal.card.append(head, body);

  function setStage(s: typeof stage): void {
    stage = s;
    title.textContent = s === 'choose' ? str('kioskmode.choose_pin')
      : s === 'confirm' ? str('kioskmode.enter_again') : str('kioskmode.unlock_title');
    const line = s === 'choose' ? str('kioskmode.choose_sub') : s === 'confirm' ? str('kioskmode.again_sub') : '';
    sub.textContent = line;
    sub.hidden = !line;
  }

  function say(text: string, kind: '' | 'error' | 'ok' | 'wait' = ''): void {
    msg.textContent = text;
    msg.dataset.kind = kind;
  }

  function drawDots(error = false): void {
    dots.forEach((d, i) => {
      d.classList.toggle('is-on', i < digits.length);
      d.classList.toggle('is-error', error);
    });
    said.textContent = str('kioskmode.entered', { n: digits.length });
  }

  function shake(): void {
    dotsBox.classList.remove('is-shaking');
    void dotsBox.offsetWidth;
    dotsBox.classList.add('is-shaking');
  }

  function wrong(text: string, then?: () => void): void {
    busy = true;
    drawDots(true);
    shake();
    say(text, 'error');
    pending = window.setTimeout(() => {
      busy = false;
      digits = '';
      drawDots();
      then?.();
    }, ERROR_MS);
  }

  function cooling(): boolean {
    return o.mode === 'unlock' && o.cooldownLeft() > 0;
  }

  function startCooldown(): void {
    if (o.mode !== 'unlock') return;
    window.clearInterval(coolTimer);
    pad.classList.add('is-cooling');
    for (const k of keys) k.disabled = true;
    const tick = (): void => {
      const left = o.cooldownLeft();
      if (left <= 0) {
        window.clearInterval(coolTimer);
        pad.classList.remove('is-cooling');
        for (const k of keys) k.disabled = false;
        say('');
        keys[0].focus({ preventScroll: true });
        return;
      }
      say(str('kioskmode.wait', { n: Math.ceil(left / 1000) }), 'wait');
    };
    tick();
    coolTimer = window.setInterval(tick, 250);
  }

  function press(k: string): void {
    if (busy || cooling() || digits.length >= PIN_LENGTH) return;
    if (!digits.length && msg.dataset.kind === 'error') say('');
    digits += k;
    drawDots();
    if (digits.length === PIN_LENGTH) void complete();
  }

  function backspace(): void {
    if (busy || cooling() || !digits.length) return;
    digits = digits.slice(0, -1);
    drawDots();
  }

  async function complete(): Promise<void> {
    const pin = digits;
    if (stage === 'choose') {
      first = pin;
      busy = true;
      pending = window.setTimeout(() => {
        busy = false;
        digits = '';
        drawDots();
        setStage('confirm');
      }, 180);
      return;
    }
    if (stage === 'confirm' && o.mode === 'choose') {
      if (pin !== first) {
        wrong(str('kioskmode.mismatch'), () => { first = ''; setStage('choose'); });
        return;
      }
      busy = true;
      say(str('kioskmode.locking'), 'ok');
      await new Promise((r) => { pending = window.setTimeout(r, LOCKING_MS); });
      await o.onChosen(pin);
      modal.close();
      return;
    }
    if (o.mode !== 'unlock') return;
    busy = true;
    const res = await o.check(pin);
    busy = false;
    if (res.ok) {
      modal.close();
      o.onUnlocked();
      return;
    }
    if ('wait' in res) {
      wrong(str('kioskmode.wait', { n: Math.ceil(res.wait / 1000) }));
      startCooldown();
      return;
    }
    wrong(str('kioskmode.wrong', { n: res.left }));
  }

  setStage(stage);
  drawDots();
  if (cooling()) startCooldown();
  else keys[0].focus({ preventScroll: true });
  return modal;
}
