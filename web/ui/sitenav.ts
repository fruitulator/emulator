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

export function siteNav(o: { here: 'games' | 'arcades' }): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'ui-sitenav';
  nav.setAttribute('aria-label', str('ui.sitenav.sections'));
  if (o.here === 'games') {
    if (hasArcade()) nav.append(link('/arcade/', UI_ICONS.cabinet, str('index.arcades'), str('index.arcades'), 'to-arcade'));
  } else {
    nav.append(link('/', UI_ICONS.library, str('index.open_the_library'), str('index.library'), 'to-games'));
  }
  nav.hidden = !nav.childElementCount;
  return nav;
}
