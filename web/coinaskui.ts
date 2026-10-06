import type { NamedCoin } from '../src/machine/machine';
import { openAlert } from './ui/dialog';
import { actionButton } from './ui/list';
import { COIN_CHOICES, COIN_QUESTION, COIN_QUESTION_HINT } from './coinask';

export function askCoin(): Promise<NamedCoin | null> {
  return new Promise((resolve) => {
    let done = false;
    const answer = (c: NamedCoin | null): void => { if (!done) { done = true; resolve(c); } };
    const a = openAlert({
      message: COIN_QUESTION,
      lines: [COIN_QUESTION_HINT],
      buttons: COIN_CHOICES.map((c) => ({
        button: actionButton(c.label, 'secondary', () => undefined),
        run: () => answer(c.coin),
      })),
      onClose: () => answer(null),
    });
    a.root.classList.add('coin-ask');
    a.root.addEventListener('click', (ev) => { if (ev.target === a.root) a.close(); });
    a.root.querySelector('.ui-alert-msg')?.classList.add('ui-alert-info');
    a.root.querySelector('.ui-alert-btns')?.classList.add('ui-alert-choices');
  });
}
