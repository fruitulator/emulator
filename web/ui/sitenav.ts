import { UI_ICONS } from './icons';
import { str } from '../i18n';
import { betaTag } from './beta';
import { bubbleTip } from './tip';
import { settingsButton } from './settings';

declare const __HAS_ARCADE__: boolean;

export function hasArcade(): boolean {
  return typeof __HAS_ARCADE__ !== 'undefined' && __HAS_ARCADE__;
}

function link(href: string, icon: string, label: string, tip: [name: string, what: string], id: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'nb-icon-btn';
  a.id = id;
  a.href = href;
  a.setAttribute('aria-label', label);
  bubbleTip(a, ...tip);
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = icon;
  a.append(s);
  return a;
}

export function siteNav(o: { here: 'games' | 'arcades'; settings?: boolean; onLocked?: () => void; help?: HTMLElement }): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'ui-sitenav';
  nav.setAttribute('aria-label', str('ui.sitenav.sections'));
  if (o.here === 'games') {
    if (hasArcade()) {
      const a = link('/arcade/', UI_ICONS.cabinet, str('index.arcades_beta'), [str('ui.tip.arcades_name'), str('ui.tip.arcades')], 'to-arcade');
      a.append(betaTag());
      nav.append(a);
    }
  } else {
    nav.append(link('/', UI_ICONS.library, str('index.open_the_library'), [str('ui.tip.my_games_name'), str('ui.tip.my_games')], 'to-games'));
  }
  if (o.help) nav.append(o.help);
  if (o.settings) nav.append(settingsButton({ onLocked: o.onLocked }));
  nav.hidden = !nav.childElementCount;
  return nav;
}
