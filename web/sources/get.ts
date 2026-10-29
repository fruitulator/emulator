import { closeSheet, sheetLine, sheetRow, showSheet } from '../ui/sheet';
import { str } from '../i18n';
import { beginSignIn } from './auth';
import { SourceError, type SourceClient } from './client';
import { fetchIndex, type Source, type SourceIndex } from './index';
import type { CatSet } from './catalogue';
import type { SourceStore } from './store';

export const CALLBACK = '/auth/callback/';
const redirectUri = (): string => location.origin + CALLBACK;

export class Unusable extends Error {}

export async function readSource(typed: string): Promise<SourceIndex> {
  const idx = await fetchIndex(typed);
  const no = idx.unusable[0];
  if (!idx.sources.length) throw new Unusable(no?.why === 'no_client' ? str('sources.not_in_app', { name: no.name }) : str('sources.cannot_use'));
  return idx;
}

export function errText(e: unknown): string {
  if (e instanceof Unusable) return e.message;
  if (e instanceof SourceError) {
    if (e.why === 'forbidden') return e.detail ?? str('sources.not_allowed');
    return e.why === 'signin' ? str('sources.err_signin') : e.why === 'busy' ? str('sources.err_busy') : e.why === 'blocked' ? str('sources.err_blocked') : str('sources.err_failed');
  }
  const m = e instanceof Error ? e.message : '';
  return m === 'bad_host' ? str('sources.err_bad_host') : m === 'blocked' ? str('sources.err_blocked') : m === 'not_found' ? str('sources.err_not_found') : str('sources.err_failed');
}

export function getFailedText(e: unknown, title: string): string {
  const plain = e instanceof SourceError ? ['failed', 'bad_answer', 'missing'].includes(e.why) : !(e instanceof Error && e.message === 'blocked');
  return str('sources.get_failed', { title, why: plain ? str('sources.err_download') : errText(e) });
}

export async function startSignIn(store: SourceStore, idx: SourceIndex, s: Source, returnTo = location.href): Promise<void> {
  const { url, pending } = await beginSignIn(s, redirectUri());
  store.setPending({ ...pending, host: idx.host, returnTo });
  location.assign(url);
}

export function askInSheet(o: {
  title: string; line: HTMLElement; yes: string; yesSub?: string; returnTo: HTMLElement;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const end = (yes: boolean): void => { if (done) return; done = true; watch.disconnect(); resolve(yes); };
    const yes = sheetRow(o.yes, o.yesSub ?? '');
    yes.addEventListener('click', () => { end(true); closeSheet(); });
    const no = sheetRow(str('sources.not_now'), '');
    no.addEventListener('click', () => { end(false); closeSheet(); });
    showSheet(o.title, [o.line, yes, no], o.returnTo);
    const sheet = document.getElementById('sheet');
    const watch = new MutationObserver(() => { if (sheet && !sheet.classList.contains('open')) end(false); });
    if (sheet) watch.observe(sheet, { attributes: true, attributeFilter: ['class'] });
  });
}

export function agreeSheet(title: string, terms: string, returnTo: HTMLElement): Promise<boolean> {
  const text = sheetLine(terms, '');
  text.classList.add('source-terms');
  return askInSheet({ title, line: text, yes: str('sources.agree'), returnTo });
}

export const withShare = (text: string, fraction: number): string => str('sources.busy_share', { text, n: Math.round(fraction * 100) });

export interface GetUi {
  busy(text: string | null, fraction?: number): void;
  returnTo: HTMLElement;
  waiting?(left: number | null): void;
}

export async function fetchFromSource(c: SourceClient, set: Pick<CatSet, 'id' | 'download' | 'file'>, title: string, ui: GetUi): Promise<File> {
  const clock = (n: number): string => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const d = await c.download(set, {
    terms: (text) => agreeSheet(title, text, ui.returnTo),
    wait: async (seconds) => {
      for (let n = seconds; n > 0; n--) {
        ui.waiting?.(n);
        ui.busy(str('sources.busy_wait', { title, t: clock(n) }));
        await new Promise((r) => setTimeout(r, 1000));
      }
      ui.waiting?.(null);
    },
    start: () => ui.busy(str('sources.busy_downloading', { title })),
    progress: (f) => ui.busy(str('sources.busy_downloading', { title }), f),
  });
  return new File([d.blob], d.name);
}
