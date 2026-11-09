import { openDialog, type Dialog } from './dialog';
import { MENU_ICONS, rowIcon, UI_ICONS } from './icons';
import { str } from '../i18n';
import { chooseStandIn, ensureLegendFonts, legendCaps, legendShownIn, legendStandIn, STAND_IN_CHOICES } from '../legendfonts';

export function fontChoiceRows(face: string, onPick: (family: string) => void, sampleText?: string): HTMLElement[] {
  const sample = sampleText || (legendCaps(face) ? 'HOLD · NUDGE · £3 JACKPOT' : 'Hold · Nudge · £3 Jackpot');
  const rows: { b: HTMLButtonElement; family: string; mark: HTMLSpanElement }[] = [];
  const show = (): void => {
    const current = legendStandIn(face);
    for (const r of rows) {
      const on = r.family === current;
      r.b.classList.toggle('is-current', on);
      if (on) r.b.setAttribute('aria-current', 'true'); else r.b.removeAttribute('aria-current');
      const mark = on ? rowIcon(UI_ICONS.tick, 'fontpick-tick', 18) : document.createElement('span');
      mark.classList.add('fontpick-mark');
      r.mark.replaceWith(mark);
      r.mark = mark;
    }
  };
  for (const family of STAND_IN_CHOICES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-row fontpick-row';
    const name = document.createElement('span');
    name.className = 'fontpick-name';
    name.textContent = family;
    const line = document.createElement('span');
    line.className = 'fontpick-sample';
    line.style.fontFamily = `"${family}", sans-serif`;
    line.textContent = sample;
    const mark = document.createElement('span');
    mark.classList.add('fontpick-mark');
    b.append(mark, name, line);
    b.addEventListener('click', () => {
      chooseStandIn(face, family);
      show();
      void ensureLegendFonts([face]).then(() => onPick(family));
    });
    rows.push({ b, family, mark });
  }
  show();
  void ensureLegendFonts(STAND_IN_CHOICES);
  return rows.map((r) => r.b);
}

export function openFontPicker(o: {
  face: string;
  onPick: (family: string) => void;
  onClose?: () => void;
}): Dialog {
  const note = document.createElement('p');
  note.className = 'fontpick-note';
  note.textContent = str('ui.fontpick.this_layout_s_lettering_is', { 0: o.face });
  const list = document.createElement('div');
  list.className = 'fontpick-list';
  let dialog: Dialog;
  list.append(...fontChoiceRows(o.face, (family) => { o.onPick(family); dialog.close(); }));
  dialog = openDialog({ title: str('ui.fontpick.lettering_font'), body: [note, list], onClose: o.onClose });
  dialog.panel.classList.add('fontpick');
  return dialog;
}

function faceNote(face: string): HTMLParagraphElement {
  const note = document.createElement('p');
  note.className = 'fontpick-note';
  const [before, after = ''] = str('ui.fontpick.this_layout_s_lettering_is', { 0: '\u0000' }).split('\u0000');
  const name = document.createElement('strong');
  name.className = 'fontpick-note-face';
  name.textContent = face;
  note.append(before, name, after);
  return note;
}

export function openFontList(o: {
  faces: { face: string; captions: string[] }[];
  onPick: (face: string, family: string) => void;
  onClose?: () => void;
}): Dialog {
  const reduced = (): boolean => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const sampleOf = (f: { face: string; captions: string[] }): string => {
    const caps = legendCaps(f.face);
    return [...new Set(f.captions.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean))]
      .slice(0, 12).map((c) => (caps ? c.toUpperCase() : c)).join(' · ');
  };
  const view = document.createElement('div');
  view.className = 'fontpick-view';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'nb-icon-btn fontpick-back';
  back.setAttribute('aria-label', str('ui.rows.back'));
  back.append(rowIcon(MENU_ICONS.chevLeft, 'row-chev', 20).firstElementChild!);
  back.hidden = true;
  const rows = new Map<string, HTMLButtonElement>();
  let level: 'list' | 'choices' = 'list';

  const swap = (nodes: Node[]): void => {
    view.replaceChildren(...nodes);
    view.classList.remove('fontpick-fade');
    if (!reduced()) { void view.offsetWidth; view.classList.add('fontpick-fade'); }
  };

  const faceRow = (f: { face: string; captions: string[] }): HTMLButtonElement => {
    const shown = legendShownIn(f.face);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-row nb-menu-item fontpick-face';
    b.setAttribute('aria-label', `${f.face}, ${str('ui.fontpick.using', { 0: shown })}`);
    const text = document.createElement('span');
    text.className = 'fontpick-face-text';
    const name = document.createElement('span');
    name.className = 'fontpick-face-name';
    name.textContent = f.face;
    const using = document.createElement('span');
    using.className = 'fontpick-face-using';
    using.textContent = str('ui.fontpick.using', { 0: shown });
    text.append(name, using);
    const sample = document.createElement('span');
    sample.className = 'fontpick-face-sample';
    sample.style.fontFamily = `"${shown}", sans-serif`;
    sample.textContent = sampleOf(f);
    const chev = rowIcon(MENU_ICONS.chevRight, 'row-chev', 16);
    b.append(text, sample, chev);
    b.addEventListener('click', () => showChoices(f));
    return b;
  };

  const showList = (picked?: string): void => {
    level = 'list';
    back.hidden = true;
    const note = document.createElement('p');
    note.className = 'fontpick-note';
    note.textContent = str('ui.fontpick.this_layout_uses_n_fonts', { n: o.faces.length });
    const group = document.createElement('div');
    group.className = 'nb-group fontpick-faces';
    rows.clear();
    for (const f of o.faces) {
      const r = faceRow(f);
      rows.set(f.face, r);
      group.append(r);
    }
    swap([note, group]);
    if (picked !== undefined) {
      const r = rows.get(picked);
      if (r) {
        r.classList.add('is-just-chosen');
        setTimeout(() => r.classList.remove('is-just-chosen'), reduced() ? 1500 : 1800);
        r.focus();
      }
    }
  };

  let from = '';
  const showChoices = (f: { face: string; captions: string[] }): void => {
    level = 'choices';
    from = f.face;
    back.hidden = false;
    const list = document.createElement('div');
    list.className = 'fontpick-list';
    list.append(...fontChoiceRows(f.face, (family) => o.onPick(f.face, family), sampleOf(f)));
    list.addEventListener('click', (ev) => {
      if ((ev.target as Element).closest('.fontpick-row')) showList(f.face);
    });
    swap([faceNote(f.face), list]);
    ((list.querySelector('.is-current') as HTMLElement | null) ?? back).focus();
  };

  const toList = (): void => { const f = from; showList(); rows.get(f)?.focus(); };
  back.addEventListener('click', toList);
  const dialog = openDialog({
    title: str('ui.fontpick.lettering_fonts'),
    body: [view],
    lead: back,
    onClose: o.onClose,
    onEscape: () => { if (level !== 'choices') return false; toList(); return true; },
  });
  dialog.panel.classList.add('fontpick', 'fontpick-several');
  void ensureLegendFonts(STAND_IN_CHOICES);
  showList();
  return dialog;
}
