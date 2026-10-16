import { openDialog, type Dialog } from './dialog';
import { rowIcon, UI_ICONS } from './icons';
import { str } from '../i18n';
import { chooseStandIn, ensureLegendFonts, legendCaps, legendStandIn, STAND_IN_CHOICES } from '../legendfonts';

export function fontChoiceRows(face: string, onPick: (family: string) => void): HTMLElement[] {
  const sample = legendCaps(face) ? 'HOLD · NUDGE · £3 JACKPOT' : 'Hold · Nudge · £3 Jackpot';
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
