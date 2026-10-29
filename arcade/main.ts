import { applyStrings, str } from '../web/i18n';
import { betaTag } from '../web/ui/beta';

applyStrings();
document.querySelector('#menu .menu-brand')?.append(betaTag());

const q = new URLSearchParams(location.search);
async function serverCheck(): Promise<void> {
  const { serverFlag } = await import('./remote');
  if (!serverFlag()) return;
  const { serverReachable } = await import('./account');
  if (await serverReachable()) return;
  const { showToast } = await import('../web/ui/toast');
  showToast(str('arcade.main.server_not_reachable'), {
    error: true,
    action: { label: str('arcade.landing.try_again'), run: () => location.reload() },
  });
}
void serverCheck();
async function signedIn(): Promise<void> {
  const { serverFlag } = await import('./remote');
  if (!serverFlag()) return;
  const { needLogin } = await import('./account');
  if (await needLogin()) return;
  location.href = '/arcade/';
  await new Promise(() => undefined);
}
if (q.has('host')) {
  await signedIn();
  document.getElementById('loading')?.classList.add('done');
  await (await import('./host')).openHost();
} else if (q.has('arcade') || (import.meta.env.DEV && (q.has('stats') || q.has('bench')))) {
  await signedIn();
  await import('./roompage');
} else {
  await (await import('./landing')).openLanding();
}

export {};
