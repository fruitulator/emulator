import { str } from './i18n';
import { UI_ICONS } from './ui/icons';
import { valueRow } from './ui/sheet';
import { modalHead, openModal, openPinCard } from './ui/pincard';
import { cooldownLeft, isLocked, lockWith, onKioskMode, tryUnlock } from './kioskmode';

function svg(icon: string): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = icon;
  return s;
}

function canRow(can: boolean, text: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pl-row';
  const mark = document.createElement('span');
  mark.className = can ? 'pl-mark pl-mark--can' : 'pl-mark pl-mark--cannot';
  mark.append(svg(can ? UI_ICONS.tick : UI_ICONS.cross));
  const t = document.createElement('span');
  t.textContent = text;
  row.append(mark, t);
  return row;
}

function openIntro(returnTo: HTMLElement): void {
  const id = `pl-${Math.random().toString(36).slice(2, 8)}`;
  let choosing = false;
  const modal = openModal({
    width: 440, label: id,
    returnTo,
    onClose: () => { if (choosing) openChoose(returnTo); },
  });
  const { head } = modalHead({
    icon: UI_ICONS.lock, tile: 48, id,
    title: str('kioskmode.title'), sub: str('kioskmode.subtitle'),
    onClose: modal.close,
  });
  head.classList.add('pl-intro-head');
  const list = document.createElement('div');
  list.className = 'nb-group pl-list';
  list.append(
    canRow(true, str('kioskmode.can_play')),
    canRow(true, str('kioskmode.can_coins')),
    canRow(false, str('kioskmode.cannot_library')),
    canRow(false, str('kioskmode.cannot_games')),
  );
  const note = document.createElement('p');
  note.className = 'nb-meta pl-note';
  note.textContent = str('kioskmode.note');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'nb-btn';
  cancel.textContent = str('kioskmode.cancel');
  cancel.addEventListener('click', modal.close);
  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'nb-btn nb-btn--primary';
  choose.textContent = str('kioskmode.choose_pin');
  choose.addEventListener('click', () => { choosing = true; modal.close(); });
  const actions = document.createElement('div');
  actions.className = 'nb-dialog__actions';
  actions.append(cancel, choose);
  const body = document.createElement('div');
  body.className = 'pl-intro-body';
  body.append(list, note, actions);
  modal.card.append(head, body);
  choose.focus({ preventScroll: true });
}

function openChoose(returnTo: HTMLElement): void {
  openPinCard({
    mode: 'choose',
    returnTo,
    onChosen: (pin) => lockWith(pin),
  });
}

function openUnlock(returnTo: HTMLElement): void {
  openPinCard({
    mode: 'unlock',
    returnTo: null,
    check: tryUnlock,
    cooldownLeft: () => cooldownLeft(),
    onUnlocked: () => {
      document.body.classList.add('kiosk-unlocked');
      window.setTimeout(() => document.body.classList.remove('kiosk-unlocked'), 400);
      document.getElementById('settingsBtn')?.focus({ preventScroll: true });
    },
    onClose: () => { if (isLocked() && returnTo.isConnected) returnTo.focus({ preventScroll: true }); },
  });
}

export function kioskRow(o: { returnTo: HTMLElement; leave: () => void }): HTMLButtonElement {
  const { row } = valueRow(str('kioskmode.title'), '');
  row.setAttribute('aria-haspopup', 'dialog');
  row.addEventListener('click', () => {
    o.leave();
    if (isLocked()) openUnlock(o.returnTo);
    else openIntro(o.returnTo);
  });
  return row;
}

export function mountKioskMode(changed: (locked: boolean) => void): void {
  const sync = (): void => { document.body.classList.toggle('kiosk-locked', isLocked()); };
  sync();
  onKioskMode((locked) => {
    sync();
    changed(locked);
    if (locked) document.getElementById('settingsBtn')?.focus({ preventScroll: true });
  });
}
