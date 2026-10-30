import { AGE_OK_CLASS, APP_READY_CLASS, ageGate } from '../web/agegate';
import { followOtherTabs } from '../web/ui/theme';

followOtherTabs();

const page = new URLSearchParams(location.search);
if (page.has('guide')) {
  document.documentElement.classList.add(AGE_OK_CLASS);
  const { applyStrings } = await import('../web/i18n');
  applyStrings();
  document.getElementById('loading')?.classList.add('done');
  (await import('./guide')).openGuide(() => { location.href = '/arcade/'; });
  document.documentElement.classList.add(APP_READY_CLASS);
} else if (page.has('privacy')) {
  document.documentElement.classList.add(AGE_OK_CLASS);
  const { applyStrings } = await import('../web/i18n');
  applyStrings();
  (await import('./privacy')).showPrivacyPage();
  document.documentElement.classList.add(APP_READY_CLASS);
} else {
  ageGate(() => import('./main'));
}

export {};
