import { openDialog, type Dialog } from '../web/ui/dialog';
import { str } from '../web/i18n';
import { richInto } from '../web/ui/rich';
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
  return richInto(el('p'), text);
}

let open: Dialog | null = null;
let afterClose: (() => void) | undefined;

function guideBody(): HTMLElement[] {
  const protect = section(str('arcade.guide.how_we_protect'), []);
  const priv = el('button', str('arcade.privacy.how_the_arcade_keeps_your'), 'privacy-link');
  priv.type = 'button';
  priv.addEventListener('click', () => {
    const then = afterClose;
    afterClose = undefined;
    open?.close();
    openPrivacy(then);
  });
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
  afterClose = onClose;
  const d = openDialog({
    title: str('arcade.guide.how_the_arcade_works'),
    body: guideBody(),
    onClose: () => { open = null; afterClose?.(); },
  });
  d.panel.classList.add('privacy', 'guide');
  open = d;
  return d;
}
