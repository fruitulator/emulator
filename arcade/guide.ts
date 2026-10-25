import { openDialog, type Dialog } from '../web/ui/dialog';
import { str } from '../web/i18n';
import { openPrivacy } from './privacy';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function section(heading: string, lines: string[]): HTMLElement {
  const sec = el('section', undefined, 'about-sec privacy-sec');
  sec.append(el('h3', heading));
  for (const l of lines) sec.append(para(l));
  return sec;
}

function para(text: string): HTMLParagraphElement {
  const p = el('p');
  for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) p.append(el('strong', part.slice(2, -2)));
    else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) p.append(el('code', part.slice(1, -1)));
    else if (part) p.append(document.createTextNode(part));
  }
  return p;
}

let open: Dialog | null = null;

function guideBody(): HTMLElement[] {
  const protect = section(str('arcade.guide.how_we_protect'), []);
  const priv = el('button', str('arcade.privacy.how_the_arcade_keeps_your'), 'ui-beta-more');
  priv.type = 'button';
  priv.addEventListener('click', () => { open?.close(); openPrivacy(); });
  const p = el('p');
  p.append(priv);
  protect.append(p);
  return [
    para(str('arcade.guide.in_beta')),
    section(str('arcade.guide.your_games'), [
      str('arcade.guide.own_library_only'),
      str('arcade.guide.export_games'),
    ]),
    section(str('arcade.guide.money'), [
      str('arcade.guide.starting_wallet'),
      str('arcade.guide.payday'),
      str('arcade.guide.play_money'),
    ]),
    section(str('arcade.guide.playing'), [
      str('arcade.guide.one_player'),
    ]),
    section(str('arcade.guide.hosting'), [
      str('arcade.guide.host_one'),
    ]),
    section(str('arcade.guide.logging_in'), [
      str('arcade.guide.passkey'),
      str('arcade.guide.no_personal_details'),
    ]),
    protect,
  ];
}

export function openGuide(onClose?: () => void): Dialog {
  if (open) return open;
  const d = openDialog({
    title: str('arcade.guide.how_the_arcade_works'),
    body: guideBody(),
    onClose: () => { open = null; onClose?.(); },
  });
  d.panel.classList.add('privacy', 'guide');
  open = d;
  return d;
}
