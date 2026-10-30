import { openHelp } from '../help/help';
import { closeSheet, optionRow, sheetLine, showSheet } from '../ui/sheet';
import { UI_ICONS } from '../ui/icons';
import { actionButton } from '../ui/list';
import { textField } from '../ui/field';
import { showToast } from '../ui/toast';
import { finishSignIn } from './auth';
import { CALLBACK, errText, readSource, startSignIn } from './get';
import type { Source, SourceIndex } from './index';
import { SourceStore, sourceKey } from './store';
import { CATEGORY_PARAM, LIBRARY_PARAM, LOCAL, SourceView } from './view';
import { str } from '../i18n';

export interface App {
  importQuietly(file: File, origin: string): Promise<string | null>;
  originsHeld(): Promise<Map<string, string>>;
  play(hash: string): void;
  backToLibrary(): void;
  toGrid(): void;
  busy(msg: string | null, fraction?: number): void;
  returnTo: HTMLElement;
}

const store = new SourceStore();

function actions(...buttons: HTMLButtonElement[]): HTMLElement {
  const d = document.createElement('div');
  d.className = 'sheet-actions';
  d.append(...buttons);
  return d;
}

function addSheet(returnTo: HTMLElement, then: (host: string) => void): void {
  const f = textField({ label: str('sources.address'), type: 'url', autocomplete: 'off' });
  const field = f.el;
  field.classList.add('sheet-field');
  const input = f.input;
  input.inputMode = 'url';
  const go = actionButton(str('sources.add'), 'primary', () => void run());
  const status = sheetLine('', '', { quiet: true });
  status.hidden = true;
  const run = async (): Promise<void> => {
    go.disabled = true;
    status.hidden = false;
    status.textContent = str('sources.adding');
    try {
      const idx = await readSource(input.value);
      store.putHost(idx);
      closeSheet();
      then(idx.host);
    } catch (e) {
      status.textContent = errText(e);
      go.disabled = false;
    }
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); void run(); }
  });
  showSheet(str('sources.add_source'), [field, status], returnTo, { foot: [actions(go)], help: () => openHelp('source') });
  input.focus({ preventScroll: true });
}

async function signIn(idx: SourceIndex, s: Source, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    await startSignIn(store, idx, s);
  } catch (e) {
    button.disabled = false;
    button.textContent = errText(e);
  }
}

export const LINK = 'source';

let view: SourceView | null = null;
let app: App | null = null;

function showSource(key: string): void {
  app?.toGrid();
  view?.show(key);
}

export const sources = {
  mount(a: App): void {
    app = a;
    view = new SourceView(store, {
      importQuietly: a.importQuietly, originsHeld: a.originsHeld, play: a.play, backToLibrary: a.backToLibrary, busy: a.busy,
      signIn: (idx, s, b) => void signIn(idx, s, b),
      addSource: (returnTo, then) => addSheet(returnTo, then),
      errText,
    });
    view.mount(document.getElementById('lib-meta')!, document.getElementById('tiles')!, document.getElementById('lib-actions')!);
  },

  addGamesRow(returnTo: HTMLElement): HTMLElement {
    const row = optionRow(str('sources.add_source'), str('sources.add_source_sub'), UI_ICONS.globe);
    row.addEventListener('click', () => sources.addSource(returnTo));
    return row;
  },

  inSource(): boolean { return !!view?.showing; },

  leave(): void { if (view?.showing) view.show(LOCAL); },

  addSource(returnTo: HTMLElement): void {
    addSheet(returnTo, (host) => { app?.toGrid(); view?.showHost(host); });
  },

  async start(): Promise<boolean> {
    const linked = new URL(location.href).searchParams.get(LINK);
    if (linked !== null && location.pathname !== CALLBACK) {
      const clean = new URL(location.href);
      clean.searchParams.delete(LINK);
      history.replaceState(history.state, '', clean.href);
      try {
        const idx = await readSource(linked);
        store.putHost(idx);
        app?.toGrid();
        view?.showHost(idx.host);
      } catch (e) {
        showToast(errText(e), { error: true });
      }
      return true;
    }
    if (location.pathname === CALLBACK) {
      const here = location.href;
      const p = store.pending();
      store.setPending(undefined);
      history.replaceState(null, '', CALLBACK);
      let back = location.origin + '/';
      if (p) {
        try { if (new URL(p.returnTo ?? '').origin === location.origin) back = p.returnTo!; } catch {  }
        const idx = store.hosts().find((h) => h.host === p.host);
        const s = idx?.sources.find((x) => x.id === p.sourceId);
        let ok = false;
        if (idx && s) {
          try { store.tokenBox(idx.host, s.id).set(await finishSignIn(p, here)); ok = true; } catch {  }
          store.setBack({ host: idx.host, sourceId: s.id, ok });
        }
      }
      location.replace(back);
      return true;
    }
    const b = store.takeBack();
    if (!b) {
      const shown = new URL(location.href).searchParams.get(LIBRARY_PARAM);
      if (shown === null) return false;
      const key = store.keyOfSlug(shown);
      if (key) { showSource(key); return true; }
      const clean = new URL(location.href);
      clean.searchParams.delete(LIBRARY_PARAM);
      clean.searchParams.delete(CATEGORY_PARAM);
      history.replaceState(history.state, '', clean.href);
      return false;
    }
    const idx = store.hosts().find((h) => h.host === b.host);
    const s = idx?.sources.find((x) => x.id === b.sourceId);
    if (idx && s) showSource(sourceKey(idx.host, s.id));
    return true;
  },
};
