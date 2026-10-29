import { fillSources, type ArcadeDoc, type MachineSource } from './doc';
import { uploadToLibrary } from './upload';
import { putMeta, type GameMeta } from '../web/store';
import { SourceClient, SourceError } from '../web/sources/client';
import { askInSheet, errText, fetchFromSource, getFailedText, readSource, startSignIn } from '../web/sources/get';
import { SourceStore, hostOfKey, sourceKey, splitOrigin } from '../web/sources/store';
import { sheetLine } from '../web/ui/sheet';
import { showToast } from '../web/ui/toast';
import { str } from '../web/i18n';

function siteOf(key: string): string {
  try { return new URL(hostOfKey(key)).hostname.replace(/^www\./i, ''); } catch { return key; }
}

export function librarySource(g: Pick<GameMeta, 'origin'>, store = new SourceStore()): MachineSource | undefined {
  const o = splitOrigin(g.origin);
  if (!o) return undefined;
  return { key: o.key, item: o.item, name: store.byKey(o.key)?.s.name ?? siteOf(o.key) };
}

export function fillDocSources(doc: ArcadeDoc, library: readonly GameMeta[]): boolean {
  const store = new SourceStore();
  const byHash = new Map(library.map((g) => [g.hash, g]));
  return fillSources(doc, library, (g) => { const r = byHash.get(g.hash); return r ? librarySource(r, store) : undefined; });
}

export function settleSignIn(): void {
  const store = new SourceStore();
  const b = store.takeBack();
  if (!b) return;
  const found = store.byKey(sourceKey(b.host, b.sourceId));
  if (!found) return;
  showToast(b.ok ? str('arcade.source.signed_in_n', { 0: found.s.name }) : str('sources.err_signin'), b.ok ? { kind: 'ok' } : { error: true });
}

export interface GetProgress { (text: string | null, fraction?: number): void }

function confirmAdd(name: string, site: string, returnTo: HTMLElement): Promise<boolean> {
  const line = sheetLine(str('arcade.source.add_ask', { name, site }), '', { quiet: true });
  return askInSheet({ title: name, line, yes: str('arcade.source.add_n', { 0: name }), yesSub: site, returnTo });
}

export async function getMachineSet(
  m: { source: MachineSource; contentHash: string; name: string },
  progress: GetProgress, returnTo: HTMLElement,
): Promise<GameMeta | 'other' | null> {
  const store = new SourceStore();
  const title = m.name;
  try {
    let found = store.byKey(m.source.key);
    if (!found) {
      const idx = await readSource(hostOfKey(m.source.key));
      const s = idx.sources.find((x) => sourceKey(idx.host, x.id) === m.source.key) ?? idx.sources[0];
      if (!await confirmAdd(s.name, siteOf(sourceKey(idx.host, s.id)), returnTo)) return null;
      store.putHost(idx);
      found = { idx, s };
    }
    const { idx, s } = found;
    const tokens = store.tokenBox(idx.host, s.id);
    if (s.auth.type !== 'none' && !tokens.get()) {
      await startSignIn(store, idx, s);
      return null;
    }
    const file = await fetchFromSource(new SourceClient(s, tokens), { id: m.source.item }, title, { busy: progress, returnTo });
    progress(str('arcade.source.importing_n', { 0: title }));
    const result = await uploadToLibrary([file], (text, done) => progress(text, done));
    progress(null);
    const exact = result.games.find((g) => g.contentHash === m.contentHash);
    for (const g of result.games) if (!g.origin) await putMeta({ ...g, origin: `${sourceKey(idx.host, s.id)}#${m.source.item}` }).catch(() => undefined);
    if (exact) return exact;
    if (result.games.length) return 'other';
    showToast(str('sources.get_failed', { title, why: result.problems[0]?.reason ?? str('sources.err_download') }), { error: true });
    return null;
  } catch (e) {
    progress(null);
    if (e instanceof SourceError && e.why === 'declined') return null;
    if (e instanceof SourceError && e.why === 'signin') {
      const found = store.byKey(m.source.key);
      showToast(getFailedText(e, title), {
        error: true,
        ...(found ? { action: { label: str('sources.sign_in'), run: () => { void startSignIn(store, found.idx, found.s); } } } : {}),
      });
      return null;
    }
    showToast(e instanceof SourceError ? getFailedText(e, title) : str('sources.get_failed', { title, why: errText(e) }), { error: true });
    return null;
  }
}
