import { UI_ICONS } from './icons';
import { str } from '../i18n';

declare const __HAS_ARCADE__: boolean;

export function hasArcade(): boolean {
  return typeof __HAS_ARCADE__ !== 'undefined' && __HAS_ARCADE__;
}

function link(href: string, icon: string, label: string, title: string, id: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'iconbtn';
  a.id = id;
  a.href = href;
  a.setAttribute('aria-label', label);
  a.title = title;
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = icon;
  a.append(s);
  return a;
}

export function aboutButton(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'iconbtn about';
  b.id = 'aboutBtn';
  b.setAttribute('aria-label', str('index.about_fruitulator'));
  b.title = str('index.about');
  b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('aria-expanded', 'false');
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = UI_ICONS.info;
  b.append(s);
  b.addEventListener('click', () => {
    void import('../about').then((m) => {
      const up = m.aboutOpen();
      if (up) { up.close(); return; }
      b.setAttribute('aria-expanded', 'true');
      m.openAbout({ onClose: () => b.setAttribute('aria-expanded', 'false') });
    });
  });
  return b;
}

export function siteNav(o: { here: 'games' | 'arcades'; about?: boolean }): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'ui-sitenav';
  nav.setAttribute('aria-label', str('ui.sitenav.sections'));
  if (o.here === 'games') {
    if (hasArcade()) nav.append(link('/arcade/', UI_ICONS.cabinet, str('index.arcades'), str('index.arcades'), 'to-arcade'));
  } else {
    nav.append(link('/', UI_ICONS.library, str('index.open_the_library'), str('index.library'), 'to-games'));
  }
  if (o.about) nav.append(aboutButton());
  nav.hidden = !nav.childElementCount;
  return nav;
}
