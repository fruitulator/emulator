import { openDialog, type Dialog } from '../web/ui/dialog';
import { sectionHeading } from '../web/ui/list';
import { str } from '../web/i18n';

export const PRIVACY_PAGE = '/arcade/?privacy';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function section(heading: string, lines: string[], list = false): HTMLElement {
  const sec = el('section', undefined, 'about-sec privacy-sec');
  sec.append(sectionHeading(heading));
  if (list) {
    const ul = el('ul', undefined, 'privacy-list');
    for (const l of lines) ul.append(el('li', l));
    sec.append(ul);
  } else {
    for (const l of lines) sec.append(el('p', l));
  }
  return sec;
}

export function privacyBody(): HTMLElement[] {
  return [
    el('p', str('arcade.privacy.what_the_arcade_keeps_about')),
    section(str('arcade.privacy.without_an_account'), [
      str('arcade.privacy.you_can_look_round_the'),
      str('arcade.privacy.the_arcade_uses_two_cookies'),
    ]),
    section(str('arcade.privacy.your_account'), [
      str('arcade.privacy.your_player_name_other_players'),
      str('arcade.privacy.your_picture_if_you_add'),
      str('arcade.privacy.your_passkey_s_public_half'),
      str('arcade.privacy.the_login_cookie_it_keeps'),
      str('arcade.privacy.if_you_log_in_another'),
      str('arcade.privacy.your_wallet_your_balance_and'),
      str('arcade.privacy.the_arcades_you_have_visited'),
    ], true),
    section(str('arcade.privacy.playing_and_hosting'), [
      str('arcade.privacy.each_machine_keeps_its_own'),
      str('arcade.privacy.if_you_host_an_arcade'),
    ]),
    section(str('arcade.privacy.what_the_arcade_does_not'), [
      str('arcade.privacy.no_adverts_no_tracking_or'),
    ]),
    section(str('arcade.privacy.cloudflare'), [
      str('arcade.privacy.the_arcade_runs_on_cloudflare'),
    ]),
    section(str('arcade.privacy.on_your_device'), [
      str('arcade.privacy.your_browser_keeps_your_games'),
    ]),
    section(str('arcade.privacy.deleting_your_account'), [
      str('arcade.privacy.tap_your_player_icon_at'),
      str('arcade.privacy.what_stays_each_machine_s'),
    ]),
    contact(),
  ];
}

export const PRIVACY_CONTACT = 'fruitulator@proton.me';

function contact(): HTMLElement {
  const sec = section(str('arcade.privacy.contact'), [str('arcade.privacy.questions_about_your_details')]);
  const a = el('a', PRIVACY_CONTACT);
  a.setAttribute('href', `mailto:${PRIVACY_CONTACT}`);
  const p = el('p');
  p.append(a);
  sec.append(p);
  return sec;
}

export function openPrivacy(onClose?: () => void): Dialog {
  const d = openDialog({ title: str('arcade.privacy.privacy'), body: privacyBody(), onClose });
  d.panel.classList.add('privacy');
  return d;
}

export function privacyLink(): HTMLAnchorElement {
  const a = el('a', str('arcade.privacy.how_the_arcade_keeps_your'), 'privacy-link');
  a.href = PRIVACY_PAGE;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

export function showPrivacyPage(): void {
  document.getElementById('loading')?.classList.add('done');
  openPrivacy(() => { location.href = '/arcade/'; });
}
