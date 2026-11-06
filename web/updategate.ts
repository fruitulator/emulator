
import { BUILD_HEADER, BUILD_PARAM, TOO_OLD_HEADER, TOO_OLD_STATUS } from './updatewire';

export { BUILD_HEADER, BUILD_PARAM, TOO_OLD_HEADER, TOO_OLD_STATUS };

export function pageBuild(doc: Pick<Document, 'querySelector'> | undefined = globalThis.document): string | null {
  const c = doc?.querySelector<HTMLMetaElement>('meta[name="fruitulator-build"]')?.content;
  return c && c !== 'dev' ? c : null;
}

export function buildHeaders(build: string | null = pageBuild()): Record<string, string> {
  return build ? { [BUILD_HEADER]: build } : {};
}

export function withBuild(url: URL, build: string | null = pageBuild()): URL {
  if (build) url.searchParams.set(BUILD_PARAM, build);
  return url;
}

export type GatePage = 'app' | 'arcade';

export interface GateState {
  page: GatePage;
  online: boolean;
  inGame: boolean;
  tries: number;
}

export type Decision =
  | 'run'
  | 'hold'
  | 'defer'
  | 'give-up';

export const MAX_TRIES = 3;

export function decide(s: GateState): Decision {
  if (!s.online) return 'run';
  if (s.tries >= MAX_TRIES) return 'give-up';
  if (s.page === 'app' && s.inGame) return 'defer';
  return 'hold';
}

export function inGame(body: Pick<Element, 'classList'> | null | undefined = globalThis.document?.body): boolean {
  return !!body?.classList.contains('nb-play');
}

const ASK_MS = 3000;
const TRIES_KEY = 'fruitulator.update-tries';

export function askBuild(w: ServiceWorker, ms = ASK_MS): Promise<string | null> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => { ch.port1.close(); resolve(null); }, ms);
    ch.port1.onmessage = (e: MessageEvent) => {
      clearTimeout(t);
      ch.port1.close();
      resolve(typeof e.data?.build === 'string' ? e.data.build : null);
    };
    try { w.postMessage({ type: 'build' }, [ch.port2]); } catch { clearTimeout(t); resolve(null); }
  });
}

export function retryDelayMs(n: number): number {
  return n <= 0 ? 0 : Math.min(30_000, 1000 * 2 ** n);
}

function tries(): number {
  try { return Number(sessionStorage.getItem(TRIES_KEY)) || 0; } catch { return 0; }
}
function setTries(n: number): void {
  try {
    if (n) sessionStorage.setItem(TRIES_KEY, String(n));
    else sessionStorage.removeItem(TRIES_KEY);
  } catch {  }
}

let page: GatePage = 'app';
let reg: ServiceWorkerRegistration | null = null;
let holding = false;
let deferred = false;

function state(reachable = true): GateState {
  return { page, online: navigator.onLine && reachable, inGame: page === 'app' && inGame(), tries: tries() };
}

function onUpdate(): boolean {
  if (holding) return true;
  switch (decide(state())) {
    case 'hold':
      holdForUpdate();
      return true;
    case 'defer':
      deferred = true;
      watchLeaving();
      return false;
    case 'give-up':
      sayGaveUp();
      return false;
    default:
      return false;
  }
}

let saidGaveUp = false;
function sayGaveUp(): void {
  if (saidGaveUp || typeof document === 'undefined') return;
  saidGaveUp = true;
  void Promise.all([import('./i18n'), import('./ui/toast')])
    .then(([{ str }, { showToast }]) => { showToast(str('update.unable_to_update_fruitulator'), { kind: 'warn' }); })
    .catch(() => undefined);
}

let leavingWatched = false;
function watchLeaving(): void {
  if (leavingWatched || !globalThis.MutationObserver) return;
  leavingWatched = true;
  new MutationObserver(() => {
    if (deferred && !inGame()) { deferred = false; onUpdate(); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

export function holdForUpdate(): Promise<void> {
  if (!holding) {
    holding = true;
    gaveUp = new Promise<void>((resolve) => { endHold = resolve; });
    void hold();
  }
  return gaveUp;
}
let gaveUp = Promise.resolve();
let endHold: () => void = () => undefined;

async function hold(): Promise<void> {
  const sw = navigator.serviceWorker;
  const { str } = await import('./i18n');
  const card = progressCard(str('update.updating'));
  let reloading = false;
  const reload = (afterMs: number): void => {
    if (reloading) return;
    reloading = true;
    const n = tries();
    setTries(n + 1);
    setTimeout(() => location.reload(), Math.max(afterMs, retryDelayMs(n)));
  };
  const giveUp = (): void => {
    if (reloading) return;
    reloading = true;
    card.remove();
    holding = false;
    endHold();
    sayGaveUp();
  };
  const onProgress = (e: MessageEvent): void => {
    const d = e.data as { type?: string; done?: number; total?: number; failed?: number } | null;
    if (d?.type !== 'precache-progress' || typeof d.done !== 'number' || typeof d.total !== 'number' || !d.total) return;
    card.label(str('update.updating_n_n', { 0: d.done, 1: d.total }));
    card.fill(d.done / d.total);
  };
  sw?.addEventListener('message', onProgress);
  sw?.startMessages();
  sw?.addEventListener('controllerchange', () => reload(0));
  if (!sw) { reload(0); return; }
  try {
    reg ??= await sw.getRegistration() ?? null;
    await reg?.update();
  } catch {
    giveUp();
    return;
  }
  const w = reg?.installing ?? reg?.waiting ?? null;
  if (w) {
    const tell = (): void => { w.postMessage({ type: 'skip-waiting' }); };
    if (w.state === 'installed') tell();
    w.addEventListener('statechange', () => {
      if (w.state === 'installed') tell();
      else if (w.state === 'redundant') giveUp();
    });
    return;
  }
  reload(1000);
}

function progressCard(text: string): { label(t: string): void; fill(share: number): void; remove(): void } {
  const veil = document.createElement('div');
  veil.className = 'nb-backdrop agegate';
  veil.id = 'update-hold';
  veil.setAttribute('role', 'dialog');
  veil.setAttribute('aria-modal', 'true');
  veil.style.cssText = 'z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  veil.innerHTML = '<div class="nb-progress" role="status" aria-live="polite">'
    + '<span class="nb-spinner" aria-hidden="true"></span>'
    + '<div class="nb-progress__body"><span class="nb-progress__label"></span>'
    + '<div class="nb-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span style="width:0%"></span></div>'
    + '</div></div>';
  const label = veil.querySelector<HTMLElement>('.nb-progress__label')!;
  const meter = veil.querySelector<HTMLElement>('.nb-meter')!;
  label.textContent = text;
  const held = Array.from(document.body.children) as HTMLElement[];
  for (const el of held) el.inert = true;
  document.body.append(veil);
  return {
    label: (t) => { label.textContent = t; },
    fill: (share) => {
      const pc = Math.round(Math.max(0, Math.min(1, share)) * 100);
      (meter.firstElementChild as HTMLElement).style.width = `${pc}%`;
      meter.setAttribute('aria-valuenow', String(pc));
    },
    remove: () => {
      for (const el of held) el.inert = false;
      veil.remove();
    },
  };
}

export function isTooOld(res: Pick<Response, 'status' | 'headers'>): boolean {
  return res.status === TOO_OLD_STATUS && res.headers.get(TOO_OLD_HEADER) !== null;
}

function watchResponses(check: () => void): void {
  const real = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (...a: Parameters<typeof fetch>) => {
    const res = await real(...a);
    if (isTooOld(res)) {
      if (page === 'arcade') onUpdate();
      else check();
    }
    return res;
  };
}

function watchSaving(sw: ServiceWorkerContainer): void {
  let bar: HTMLElement | null = null;
  sw.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; done?: number; total?: number; failed?: number } | null;
    if (holding || d?.type !== 'precache-progress' || typeof d.done !== 'number' || typeof d.total !== 'number' || !d.total) return;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'offline-bar';
      bar.className = 'nb-meter agegate';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100;height:3px;border-radius:0;pointer-events:none;background:transparent';
      bar.append(document.createElement('span'));
      (bar.firstElementChild as HTMLElement).style.cssText = 'width:0%;transition:width .3s ease';
      document.body.append(bar);
    }
    const pc = Math.round((d.done / d.total) * 100);
    (bar.firstElementChild as HTMLElement).style.width = `${pc}%`;
    bar.setAttribute('aria-valuenow', String(pc));
    bar.hidden = d.done + (d.failed ?? 0) >= d.total;
  });
  sw.startMessages();
}

function watchInstalling(w: ServiceWorker): void {
  if (page === 'arcade') { onUpdate(); return; }
  const ready = (): void => { if (w.state === 'installed') onUpdate(); };
  ready();
  w.addEventListener('statechange', ready);
}

export async function updateGate(which: GatePage = 'app'): Promise<void> {
  page = which;
  const mine = pageBuild();
  if (!mine || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  try { reg = (await sw.getRegistration()) ?? null; } catch { reg = null; }
  const registering = sw.register('/sw.js').catch((e: Error) => {
    console.warn('[fruitulator] service worker not registered', e.message);
    return null;
  });
  reg ??= await registering;
  const r = reg;
  if (!r) return;
  const check = (): void => { void r.update().catch(() => undefined); };
  watchResponses(check);
  const ctl = sw.controller;
  if (ctl && (await askBuild(ctl)) !== mine) {
    if (onUpdate()) await gaveUp;
  } else {
    setTries(0);
  }
  watchSaving(sw);
  const hadController = !!ctl;
  r.addEventListener('updatefound', () => {
    if ((hadController || sw.controller) && r.installing) watchInstalling(r.installing);
  });
  if (r.waiting) onUpdate();
  else if (r.installing && hadController) watchInstalling(r.installing);
  sw.addEventListener('controllerchange', () => {
    const now = sw.controller;
    if (!now) return;
    void askBuild(now).then((b) => { if (b !== mine) onUpdate(); });
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(check, 60 * 60 * 1000);
}
