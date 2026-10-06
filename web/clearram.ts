import { openAlert } from './ui/dialog';
import { actionButton } from './ui/list';
import { str } from './i18n';

export const CLEAR_RAM_QUESTION = str('clearram.clear_ram_and_restart_this');
export const CLEAR_RAM_LINES: readonly string[] = [
  str('clearram.it_starts_again_as_a'),
  str('clearram.any_credit_still_on_the'),
  str('clearram.your_saved_game_becomes_this'),
];
export const CLEAR_RAM_KEEP = str('clearram.cancel');
export const CLEAR_RAM_YES = str('clearram.clear_ram');

export function askClearRam(): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const answer = (yes: boolean): void => { if (!done) { done = true; resolve(yes); } };
    const a = openAlert({
      message: CLEAR_RAM_QUESTION,
      lines: [...CLEAR_RAM_LINES],
      buttons: [
        { button: actionButton(CLEAR_RAM_KEEP, 'secondary', () => undefined), run: () => answer(false) },
        { button: actionButton(CLEAR_RAM_YES, 'primary', () => undefined), run: () => answer(true) },
      ],
      onClose: () => answer(false),
    });
    a.root.addEventListener('click', (ev) => { if (ev.target === a.root) a.close(); });
    a.root.querySelector('.ui-alert-msg')?.classList.add('ui-alert-info');
  });
}
