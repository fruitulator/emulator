
import { makeLogo } from './ui/logo';
import { BRAND_MARKS, UI_ICONS, brandMark, rowIcon } from './ui/icons';
import { openDialog, type Dialog } from './ui/dialog';
import { buildStamp } from './downloads';
import { str } from './i18n';

export const COMMUNITY_URL = 'https://desertislandfruits.com/';

export const REPO_URL = 'https://github.com/fruitulator/emulator';

export const ISSUES_URL = `${REPO_URL}/issues`;

export const INTRO: readonly string[] = [
  str('about.fruitulator_lets_you_play_classic'),
  str('about.it_runs_the_original_game'),
  str('about.games_are_not_included_community', { 0: COMMUNITY_URL }),
  str('about.anything_you_add_stays_on'),
];

export interface Credit {
  name: string;
  work?: string;
  url?: string;
  thanks: readonly string[];
}

export const CREDITS: readonly Credit[] = [
  {
    name: 'John Parker and Paul Maidment',
    work: 'Oasis',
    url: 'https://github.com/johnparker007/Oasis',
    thanks: [
      str('about.john_recovered_the_fml_layout'),
    ],
  },
  {
    name: str('about.the_mame_team'),
    work: 'MAME',
    url: 'https://www.mamedev.org/',
    thanks: [
      str('about.mame_has_been_an_important'),
      str('about.particular_thanks_to_james_wallace'),
    ],
  },
  {
    name: 'Mitsutaka Okazaki',
    work: 'emu2413',
    url: 'https://github.com/digital-sound-antiques/emu2413',
    thanks: [
      str('about.the_ym2413_implementation_is_based'),
    ],
  },
  {
    name: 'SingleStepTests',
    work: '680x0 test vectors',
    url: 'https://github.com/SingleStepTests/680x0',
    thanks: [
      str('about.the_68000_cpu_core_is'),
    ],
  },
  {
    name: 'Robsonmeg46',
    thanks: [
      str('about.for_testing_fruitulator_on_far'),
    ],
  },
  {
    name: str('about.the_layout_authors_rom_dumpers'),
    thanks: [
      str('about.every_cabinet_represents_somebody_s'),
    ],
  },
];

export const ABOUT_LINKS: readonly string[] = [
  COMMUNITY_URL,
  REPO_URL,
  ISSUES_URL,
  ...CREDITS.flatMap((c) => (c.url ? [c.url] : [])),
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = el('a', undefined, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function rich(node: HTMLElement, text: string): HTMLElement {
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) node.append(text.slice(at, m.index));
    if (m[3] !== undefined) node.append(el('code', undefined, m[3]));
    else node.append(ABOUT_LINKS.includes(m[2]) ? link(m[2], m[1]) : m[1]);
    at = m.index + m[0].length;
  }
  if (at < text.length) node.append(text.slice(at));
  return node;
}

export function renderAbout(build: string): HTMLElement {
  const root = el('div', 'about-body');

  const brand = el('div', 'about-brand');
  brand.append(makeLogo());
  root.append(brand);

  const lead = el('div', 'about-lead');
  for (const p of INTRO) lead.append(rich(el('p'), p));
  root.append(lead);

  const links = el('div', 'about-links');
  const repo = link(REPO_URL, '');
  repo.className = 'about-repo';
  repo.append(brandMark(BRAND_MARKS.github), el('span', undefined, str('about.view_the_source_on_github')));
  const issues = link(ISSUES_URL, '');
  issues.className = 'about-repo';
  issues.append(rowIcon(UI_ICONS.bug, 'about-repo-icon', 18), el('span', undefined, str('about.report_a_bug_or_suggest')));
  links.append(repo, issues);
  root.append(links);

  const thanks = el('section', 'about-sec');
  thanks.append(el('h3', undefined, str('about.thanks')));
  for (const c of CREDITS) {
    const row = el('div', 'about-row');
    const who = el('p', 'about-who');
    who.append(el('strong', undefined, c.name));
    if (c.work) who.append(' - ', c.url ? link(c.url, c.work) : c.work);
    row.append(who);
    for (const p of c.thanks) row.append(rich(el('p', 'about-thanks'), p));
    thanks.append(row);
  }
  root.append(thanks);

  root.append(el('p', 'about-build', build));
  return root;
}

let open: Dialog | null = null;

export function openAbout(o: { onClose?: () => void } = {}): Dialog {
  if (open) return open;
  const d = openDialog({
    title: str('index.about'),
    body: [renderAbout(buildStamp())],
    onClose: () => { open = null; o.onClose?.(); },
  });
  d.panel.classList.add('about-dialog');
  open = d;
  return d;
}

export function aboutOpen(): Dialog | null {
  return open;
}
