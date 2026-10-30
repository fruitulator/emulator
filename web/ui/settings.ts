import { str } from '../i18n';
import { kioskRow } from '../kioskmodeui';
import { onKioskMode } from '../kioskmode';
import { UI_ICONS } from './icons';
import { closeSheet, showSheet, valueRow } from './sheet';
import { closeSideCard, escapeSideCard } from './sidecard';
import { languageRow } from './langpick';
import { themeRow } from './themepick';

const PHONE = '(max-width: 600px)';

function divider(): HTMLElement {
  const d = document.createElement('div');
  d.className = 'settings-split';
  d.hidden = true;
  return d;
}

function aboutRow(leave: () => void): HTMLButtonElement {
  const { row } = valueRow(str('ui.tip.about_name'), '');
  row.setAttribute('aria-haspopup', 'dialog');
  row.addEventListener('click', () => {
    leave();
    void import('../about').then((m) => { if (!m.aboutOpen()) m.openAbout(); });
  });
  return row;
}

function helpRow(leave: () => void): HTMLButtonElement {
  const { row } = valueRow(str('help.title'), '');
  row.setAttribute('aria-haspopup', 'dialog');
  row.addEventListener('click', () => {
    leave();
    void import('../help/help').then((m) => m.openHelpList());
  });
  return row;
}

export function mountSettings(btn: HTMLButtonElement, o: { onLocked?: () => void } = {}): void {
  let menu: { el: HTMLElement; off: () => void } | null = null;
  if (o.onLocked) onKioskMode((locked) => { if (locked) o.onLocked!(); });

  const closeMenu = (): void => {
    if (!menu) return;
    const m = menu;
    menu = null;
    closeSideCard();
    m.off();
    m.el.remove();
    btn.setAttribute('aria-expanded', 'false');
  };
  const leave = (): void => { closeMenu(); closeSheet(); };

  const rows = (phone: boolean): HTMLElement[] => [
    kioskRow({ returnTo: btn, leave }),
    themeRow({ returnTo: btn, back: phone ? openSheet : undefined, beforeSheet: closeMenu }),
    languageRow({ returnTo: btn, back: phone ? openSheet : undefined, beforeSheet: closeMenu }),
    divider(),
    helpRow(leave),
    aboutRow(leave),
  ];

  function openSheet(): void {
    showSheet(str('ui.settings.settings'), rows(true), btn);
  }

  const openMenu = (): void => {
    const el = document.createElement('div');
    el.className = 'nb-menu settings-menu';
    el.id = 'settings-menu';
    let group: HTMLElement | null = null;
    for (const r of rows(false)) {
      if (r.classList.contains('settings-split')) { group = null; continue; }
      if (!group) {
        group = document.createElement('div');
        group.className = 'nb-group';
        el.append(group);
      }
      group.append(r);
    }
    document.body.append(el);
    const b = btn.getBoundingClientRect();
    el.style.top = `${Math.round(b.bottom + 8)}px`;
    el.style.right = `${Math.round(document.documentElement.clientWidth - b.right)}px`;
    btn.setAttribute('aria-expanded', 'true');
    const outside = (e: PointerEvent): void => {
      const t = e.target as Element;
      if (el.contains(t) || btn.contains(t) || t.closest?.('.nb-theme-card, .lang-card')) return;
      closeMenu();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (escapeSideCard()) return;
      closeMenu();
      btn.focus();
    };
    const resize = (): void => closeMenu();
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', key, true);
    addEventListener('resize', resize);
    menu = { el, off: () => {
      removeEventListener('pointerdown', outside, true);
      removeEventListener('keydown', key, true);
      removeEventListener('resize', resize);
    } };
    (el.querySelector('button') as HTMLElement | null)?.focus();
  };

  btn.addEventListener('click', () => {
    if (menu) { closeMenu(); return; }
    if (matchMedia(PHONE).matches) openSheet();
    else openMenu();
  });
}

export function settingsButton(o: { onLocked?: () => void } = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nb-icon-btn';
  b.id = 'settingsBtn';
  b.setAttribute('aria-label', str('ui.settings.settings'));
  b.setAttribute('aria-haspopup', 'true');
  b.setAttribute('aria-expanded', 'false');
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = UI_ICONS.settings;
  b.append(s);
  mountSettings(b, o);
  return b;
}
