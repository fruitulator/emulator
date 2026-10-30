import { AGE_OK_CLASS, APP_READY_CLASS, ageGate } from './agegate';
import { followOtherTabs } from './ui/theme';

followOtherTabs();

const help = new URLSearchParams(location.search);
if (help.has('help')) {
  document.documentElement.classList.add(AGE_OK_CLASS);
  const { applyStrings } = await import('./i18n');
  applyStrings();
  (await import('./help/help')).showHelpPage(help.get('help'));
  document.documentElement.classList.add(APP_READY_CLASS);
} else {
  ageGate(() => import('./main'));
}

export {};
