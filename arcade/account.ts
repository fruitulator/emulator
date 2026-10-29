import { openDialog, type Dialog } from '../web/ui/dialog';
import { actionButton } from '../web/ui/list';
import { asPlayer, devPlayer, serverFlag } from './remote';
import {
  ACCOUNT_PATH, AVATAR_PATH, PAIR_CODE_LENGTH, PAIR_POLL_MS, PLAYER_NAME_MAX,
  type PairApproveReply, type PairDevice, type PairFindReply, type PairStartReply, type PairWaitReply,
  type AccountInfo, type AccountReply, type ArcadeListing, type AvatarReply, type CreateOptionsJson, type DeleteAccountReply, type GetOptionsJson, type NameReply, type OptionsReply, type PasskeyJson, type SignedInReply,
  type AccountTheme, type ThemeReply,
} from './serverwire';
import { formatBalance } from './wallet';
import { str } from '../web/i18n';
import { textField } from '../web/ui/field';
import { privacyLink } from './privacy';

interface Known { account: AccountInfo; mine: ArcadeListing[] | null }
let asked: Promise<Known | null> | null = null;
let unreachable = false;

function ask(server: string): Promise<Known | null> {
  return (async () => {
    try {
      const res = await fetch(`${server}${ACCOUNT_PATH}`, { method: 'GET', ...asPlayer(devPlayer()) });
      unreachable = res.status >= 500;
      if (res.status !== 200) return null;
      const r = (await res.json()) as AccountReply;
      return r.ok ? { account: r.account, mine: r.mine ?? [] } : null;
    } catch (e) {
      unreachable = true;
      console.warn('[arcade] could not ask the arcade server who is signed in', e);
      return null;
    }
  })();
}

export async function currentAccount(server: string | null = serverFlag()): Promise<AccountInfo | null> {
  if (!server) return null;
  return (await (asked ??= ask(server)))?.account ?? null;
}

export async function serverReachable(server: string | null = serverFlag()): Promise<boolean> {
  if (!server) return true;
  await (asked ??= ask(server));
  return !unreachable;
}

export async function serverArcades(server: string | null = serverFlag()): Promise<ArcadeListing[]> {
  if (!server) return [];
  let k = await (asked ??= ask(server));
  if (k && k.mine === null) k = await (asked = ask(server));
  return k?.mine ?? [];
}

const signedInAs = (a: AccountInfo): void => { asked = Promise.resolve({ account: a, mine: null }); };

export function accountChanged(a: AccountInfo): void {
  const was = asked;
  asked = (async () => ({ account: a, mine: (await was)?.mine ?? null }))();
}

export async function setPlayerName(server: string, name: string): Promise<NameReply> {
  const r = await post<NameReply>(server, 'name', { name });
  if (r.ok) accountChanged(r.account);
  return r;
}

export async function setAccountTheme(server: string, theme: AccountTheme): Promise<ThemeReply> {
  const r = await post<ThemeReply>(server, 'theme', { theme });
  if (r.ok) accountChanged(r.account);
  return r;
}

export async function putAvatar(server: string, bytes: Uint8Array, type: string): Promise<AvatarReply> {
  const res = await fetch(`${server}${ACCOUNT_PATH}/${AVATAR_PATH}`, {
    method: 'PUT', ...asPlayer('', { 'content-type': type }), body: bytes as BodyInit,
  });
  if (res.status !== 200) throw new Error(`the arcade server answered ${res.status}`);
  const r = (await res.json()) as AvatarReply;
  if (r.ok) accountChanged(r.account);
  return r;
}

export function avatarUrl(server: string, a: AccountInfo): string | null {
  return a.avatarAt ? `${server}${ACCOUNT_PATH}/${AVATAR_PATH}/${encodeURIComponent(a.id)}?v=${a.avatarAt}` : null;
}

export async function needLogin(server: string | null = serverFlag()): Promise<boolean> {
  if (!server) return true;
  if (await currentAccount(server)) return true;
  const a = await openLogin(server);
  return a !== null;
}

export function rememberDevice(server: string | null = serverFlag()): Promise<AccountInfo | null> {
  return openLogin(server, 'remember');
}

export async function logOut(server: string | null = serverFlag()): Promise<void> {
  if (!server) return;
  try {
    await fetch(`${server}${ACCOUNT_PATH}/logout`, { method: 'POST', ...asPlayer('', { 'content-type': 'application/json' }), body: '{}' });
  } catch (e) {
    console.warn('[arcade] could not reach the arcade server to log out', e);
  }
  asked = null;
  location.href = '/arcade/';
}

export async function deleteAccount(server: string): Promise<DeleteAccountReply> {
  const r = await post<DeleteAccountReply>(server, 'delete', { confirm: true });
  if (r.ok) {
    asked = null;
    location.href = '/arcade/';
  }
  return r;
}

const bytes = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64u = (b: ArrayBuffer | null): string => {
  if (!b) return '';
  let s = '';
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const SAY = {
  cancelled: str('arcade.account.that_didn_t_finish_try'),
  address: str('arcade.account.logging_in_doesn_t_work'),
  insecure: str('arcade.account.logging_in_needs_a_secure'),
  noSupport: str('arcade.account.this_browser_can_t_use'),
  noSupportCode: str('arcade.account.this_browser_can_t_use_2'),
  codeGone: str('arcade.account.that_code_has_run_out'),
  noCode: str('arcade.account.there_s_no_code_like'),
  down: str('arcade.account.the_arcade_can_t_be'),
  refused: str('arcade.account.that_passkey_didn_t_work'),
  unknown: str('arcade.account.there_s_no_account_for'),
  expired: str('arcade.account.that_took_too_long_try'),
  name: str('arcade.account.choose_a_player_name_first'),
  exists: str('arcade.account.this_device_already_has_a'),
  'signed-out': str('arcade.account.you_ve_been_logged_out'),
  remembered: str('arcade.account.this_device_already_remembers_you'),
} as const;

async function post<T>(server: string, op: string, body: unknown): Promise<T> {
  const res = await fetch(`${server}${ACCOUNT_PATH}/${op}`, {
    method: 'POST', ...asPlayer('', { 'content-type': 'application/json' }), body: JSON.stringify(body),
  });
  if (res.status !== 200) throw new Error(`the arcade server answered ${res.status}`);
  return (await res.json()) as T;
}

function browserSays(e: unknown): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return SAY.cancelled;
  if (name === 'InvalidStateError') return SAY.exists;
  if (name === 'SecurityError') return SAY.address;
  if (name === 'NotSupportedError') return SAY.noSupport;
  return SAY.cancelled;
}

class Failed extends Error {}

const createOptions = (j: CreateOptionsJson): PublicKeyCredentialCreationOptions => ({
  ...j, challenge: bytes(j.challenge), user: { ...j.user, id: bytes(j.user.id) },
  excludeCredentials: (j.excludeCredentials ?? []).map((c) => ({ type: c.type, id: bytes(c.id) })),
});

async function createAccount(server: string, name: string): Promise<SignedInReply & { ok: true }> {
  const o = await post<OptionsReply>(server, 'new-options', { name });
  if (!o.ok) throw new Failed(SAY[o.why]);
  const j = o.options as CreateOptionsJson;
  let cred: PublicKeyCredential | null;
  try {
    cred = await navigator.credentials.create({
      publicKey: createOptions(j),
    }) as PublicKeyCredential | null;
  } catch (e) {
    throw new Failed(browserSays(e));
  }
  if (!cred) throw new Failed(SAY.cancelled);
  const r = cred.response as AuthenticatorAttestationResponse;
  const answer: PasskeyJson = {
    id: cred.id, type: 'public-key',
    response: { clientDataJSON: b64u(r.clientDataJSON), attestationObject: b64u(r.attestationObject) },
  };
  const done = await post<SignedInReply>(server, 'new', { credential: answer });
  if (!done.ok) throw new Failed(SAY[done.why]);
  return done;
}

async function logIn(server: string): Promise<SignedInReply & { ok: true; fromAfar: boolean }> {
  const o = await post<OptionsReply>(server, 'login-options', {});
  if (!o.ok) throw new Failed(SAY[o.why === 'name' ? 'refused' : o.why]);
  const j = o.options as GetOptionsJson;
  let cred: PublicKeyCredential | null;
  try {
    cred = await navigator.credentials.get({ publicKey: { ...j, challenge: bytes(j.challenge) } }) as PublicKeyCredential | null;
  } catch (e) {
    throw new Failed(browserSays(e));
  }
  if (!cred) throw new Failed(SAY.cancelled);
  const r = cred.response as AuthenticatorAssertionResponse;
  const answer: PasskeyJson = {
    id: cred.id, type: 'public-key',
    response: {
      clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData),
      signature: b64u(r.signature), userHandle: r.userHandle ? b64u(r.userHandle) : null,
    },
  };
  const done = await post<SignedInReply>(server, 'login', { credential: answer });
  if (!done.ok) throw new Failed(SAY[done.why]);
  return { ...done, fromAfar: cred.authenticatorAttachment === 'cross-platform' };
}

async function addPasskey(server: string): Promise<'made' | 'already'> {
  const o = await post<OptionsReply>(server, 'passkey-options', {});
  if (!o.ok) throw new Failed(SAY[o.why === 'name' ? 'refused' : o.why]);
  const j = o.options as CreateOptionsJson;
  let cred: PublicKeyCredential | null;
  try {
    cred = await navigator.credentials.create({
      publicKey: createOptions(j),
    }) as PublicKeyCredential | null;
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'InvalidStateError') return 'already';
    throw new Failed(browserSays(e));
  }
  if (!cred) throw new Failed(SAY.cancelled);
  const r = cred.response as AuthenticatorAttestationResponse;
  const answer: PasskeyJson = {
    id: cred.id, type: 'public-key',
    response: { clientDataJSON: b64u(r.clientDataJSON), attestationObject: b64u(r.attestationObject) },
  };
  const done = await post<SignedInReply>(server, 'passkey', { credential: answer });
  if (!done.ok) throw new Failed(SAY[done.why]);
  return 'made';
}

function privacyNote(): HTMLElement {
  const d = el('div', null, 'account-privacy');
  d.append(privacyLink());
  return d;
}

const errorLine = (): HTMLElement => {
  const e = el('div', '', 'host-set-note account-error');
  e.setAttribute('role', 'alert');
  e.hidden = true;
  return e;
};
const show = (line: HTMLElement, text: string): void => { line.textContent = text; line.hidden = !text; };
const busy = (b: HTMLButtonElement[], on: boolean): void => { for (const x of b) x.disabled = on; };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string | null, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

export function openLogin(server: string | null = serverFlag(), start: 'login' | 'create' | 'remember' = 'login'): Promise<AccountInfo | null> {
  if (!server) return Promise.resolve(null);
  return new Promise((resolve) => {
    let signedIn: AccountInfo | null = null;
    const wrap = el('div', null, 'host-settings account-dialog');
    const dlg: Dialog = openDialog({
      title: str('arcade.account.log_in'), body: [wrap], frost: true,
      onClose: () => resolve(signedIn),
    });
    dlg.panel.classList.add('account');
    const title = (t: string): void => { const h = dlg.panel.querySelector('h2'); if (h) h.textContent = t; };
    const supported = typeof PublicKeyCredential !== 'undefined' && !!navigator.credentials;

    const loginView = (): void => {
      title(str('arcade.account.log_in'));
      const err = errorLine();
      const lead = el('p', str('arcade.account.log_in_to_make_your'), 'account-lead');
      const how = el('div', str('arcade.account.your_device_will_ask_for'), 'host-set-note');
      const go = actionButton(str('arcade.account.log_in'), 'primary', () => { void run(); });
      const make = actionButton(str('arcade.account.create_account'), 'secondary', () => createView());
      const byCode = actionButton(str('arcade.account.log_in_with_a_code'), supported ? 'tertiary' : 'primary', () => codeView());
      const run = async (): Promise<void> => {
        show(err, '');
        busy([go, make, byCode], true);
        try {
          const r = await logIn(server);
          signedIn = r.account;
          signedInAs(r.account);
          if (r.fromAfar) rememberView(r.account, true); else dlg.close();
        } catch (e) {
          show(err, e instanceof Failed ? e.message : SAY.down);
          if (!(e instanceof Failed)) console.warn('[arcade] log in failed', e);
        } finally {
          busy([go, make, byCode], false);
        }
      };
      const acts = el('div', null, 'landing-create-actions account-actions');
      const newHere = el('div', null, 'account-new');
      newHere.append(el('span', str('arcade.account.new_here'), 'account-new-text'), make);
      if (supported) {
        acts.append(byCode, go);
        wrap.replaceChildren(lead, how, acts, err, newHere, privacyNote());
        go.focus();
      } else {
        acts.append(byCode);
        make.disabled = true;
        wrap.replaceChildren(lead, acts, err, newHere, privacyNote());
        show(err, SAY.noSupportCode);
        byCode.focus();
      }
    };

    const codeView = (): void => {
      title(str('arcade.account.log_in_with_a_code'));
      const err = errorLine();
      const lead = el('p', str('arcade.account.on_a_phone_or_computer'), 'account-lead');
      const code = el('div', '\u2026', 'account-code');
      code.setAttribute('aria-live', 'polite');
      const note = el('div', str('arcade.account.no_account_yet_create_one'), 'host-set-note');
      const back = actionButton(str('arcade.account.back'), 'tertiary', () => loginView());
      const again = actionButton(str('arcade.account.get_a_new_code'), 'primary', () => codeView());
      const acts = el('div', null, 'landing-create-actions account-actions');
      acts.append(back);
      wrap.replaceChildren(lead, code, note, acts, err);
      back.focus();
      const left = (): boolean => !code.isConnected;
      const over = (why: string): void => {
        code.classList.add('expired');
        show(err, why);
        acts.append(again);
        again.focus();
      };
      void (async () => {
        let s: PairStartReply;
        try {
          s = await post<PairStartReply>(server, 'pair-start', {});
        } catch (e) {
          console.warn('[arcade] could not ask for a log-in code', e);
          if (!left()) over(SAY.down);
          return;
        }
        if (left()) return;
        if (!s.ok) { over(SAY.insecure); return; }
        code.textContent = `${s.code.slice(0, PAIR_CODE_LENGTH / 2)}-${s.code.slice(PAIR_CODE_LENGTH / 2)}`;
        const until = Date.now() + s.expiresMs;
        for (;;) {
          await new Promise((r) => setTimeout(r, PAIR_POLL_MS));
          if (left()) return;
          if (Date.now() > until) { over(SAY.codeGone); return; }
          let w: PairWaitReply;
          try {
            w = await post<PairWaitReply>(server, 'pair-wait', { token: s.token });
          } catch (e) {
            console.warn('[arcade] could not ask whether the code was approved', e);
            continue;
          }
          if (left()) return;
          if (w.ok) {
            signedIn = w.account;
            signedInAs(w.account);
            dlg.close();
            return;
          }
          if (w.why !== 'waiting') { over(w.why === 'insecure' ? SAY.insecure : SAY.codeGone); return; }
        }
      })();
    };

    const createView = (): void => {
      title(str('arcade.account.create_account'));
      const err = errorLine();
      const nameField = textField({ label: str('arcade.account.player_name'), maxLength: PLAYER_NAME_MAX, autocomplete: 'nickname' });
      const field = nameField.input;
      const note = el('div', str('arcade.account.choose_a_player_name_it'), 'host-set-note');
      const how = el('div', str('arcade.account.then_your_device_makes_a'), 'host-set-note');
      const make = actionButton(str('arcade.account.create_account'), 'primary', () => { void run(); });
      const back = actionButton(str('arcade.account.i_already_have_an_account'), 'tertiary', () => loginView());
      const sync = (): void => { make.disabled = !supported || !field.value.trim(); };
      const run = async (): Promise<void> => {
        const name = field.value.trim();
        if (!name) { show(err, SAY.name); field.focus(); return; }
        show(err, '');
        busy([make, back], true);
        try {
          const r = await createAccount(server, name);
          signedIn = r.account;
          signedInAs(r.account);
          welcome(r.account, r.wallet ? formatBalance(r.wallet) : null);
        } catch (e) {
          show(err, e instanceof Failed ? e.message : SAY.down);
          if (!(e instanceof Failed)) console.warn('[arcade] creating an account failed', e);
          busy([make, back], false);
          sync();
        }
      };
      field.addEventListener('input', sync);
      field.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void run(); } });
      const acts = el('div', null, 'landing-create-actions account-actions');
      acts.append(back, make);
      wrap.replaceChildren(nameField.el, note, how, acts, err, privacyNote());
      sync();
      if (!supported) show(err, SAY.noSupport);
      field.focus();
    };

    const welcome = (a: AccountInfo, balance: string | null): void => {
      title(str('arcade.account.welcome'));
      const hi = el('p', str('arcade.account.you_re_in_n', { 0: a.name }), 'account-lead');
      const money = el('p', balance ? str('arcade.account.your_starting_balance_is_n', { 0: balance }) : '', 'account-lead account-balance');
      const on = actionButton(str('arcade.account.carry_on'), 'primary', () => dlg.close());
      const acts = el('div', null, 'landing-create-actions account-actions');
      acts.append(on);
      wrap.replaceChildren(hi, money, acts);
      on.focus();
    };

    const rememberView = (a: AccountInfo, justIn: boolean): void => {
      title(justIn ? str('arcade.account.you_re_in_n_2', { 0: a.name }) : str('arcade.account.remember_this_device'));
      const err = errorLine();
      const lead = el('p', justIn
        ? str('arcade.account.you_logged_in_with_another')
        : str('arcade.account.next_time_log_in_here'), 'account-lead');
      const go = actionButton(str('arcade.account.remember_this_device'), 'primary', () => { void run(); });
      const later = actionButton(str('arcade.account.not_now'), 'tertiary', () => dlg.close());
      const run = async (): Promise<void> => {
        show(err, '');
        busy([go, later], true);
        try {
          const got = await addPasskey(server);
          remembered(got === 'made' ? str('arcade.account.done_next_time_log_in') : SAY.remembered);
        } catch (e) {
          show(err, e instanceof Failed ? e.message : SAY.down);
          if (!(e instanceof Failed)) console.warn('[arcade] remembering this device failed', e);
          busy([go, later], false);
        }
      };
      const acts = el('div', null, 'landing-create-actions account-actions');
      acts.append(later, go);
      wrap.replaceChildren(lead, acts, err);
      if (!supported) { show(err, SAY.noSupport); go.disabled = true; }
      go.focus();
    };

    const remembered = (said: string): void => {
      title(str('arcade.account.remember_this_device'));
      const line = el('p', said, 'account-lead');
      const on = actionButton(str('arcade.account.carry_on'), 'primary', () => dlg.close());
      const acts = el('div', null, 'landing-create-actions account-actions');
      acts.append(on);
      wrap.replaceChildren(line, acts);
      on.focus();
    };

    if (start === 'remember') {
      void currentAccount(server).then((a) => {
        signedIn = a;
        if (a && !a.dev) rememberView(a, false); else loginView();
      });
    } else if (start === 'create') createView(); else loginView();
  });
}

function deviceName(d: PairDevice): string {
  if (d.browser && d.os) return str('arcade.account.n_on_n', { 0: d.browser, 1: d.os });
  if (d.browser || d.os) return (d.browser ?? d.os)!;
  return str('arcade.account.a_device_that_doesn_t');
}

export function openApprove(server: string): Promise<void> {
  return new Promise((resolve) => {
    const wrap = el('div', null, 'host-settings account-dialog');
    const dlg: Dialog = openDialog({
      title: str('arcade.account.log_in_another_device'), body: [wrap], frost: true,
      onClose: () => resolve(),
    });
    dlg.panel.classList.add('account');

    const askView = (typed = ''): void => {
      const err = errorLine();
      const lead = el('p', str('arcade.account.enter_the_code_the_other'), 'account-lead');
      const codeField = textField({ label: str('arcade.account.code'), value: typed, maxLength: PAIR_CODE_LENGTH + 3, autocomplete: 'off' });
      const field = codeField.input;
      field.setAttribute('autocapitalize', 'characters');
      const go = actionButton(str('arcade.account.continue'), 'primary', () => { void run(); });
      const cancel = actionButton(str('arcade.account.cancel'), 'tertiary', () => dlg.close());
      const sync = (): void => { go.disabled = field.value.replace(/[\s-]/g, '').length !== PAIR_CODE_LENGTH; };
      const run = async (): Promise<void> => {
        if (go.disabled) return;
        show(err, '');
        busy([go, cancel], true);
        try {
          const r = await post<PairFindReply>(server, 'pair-find', { code: field.value });
          if (r.ok) { confirmView(field.value, r.device); return; }
          show(err, r.why === 'code' ? SAY.noCode : SAY['signed-out']);
        } catch (e) {
          show(err, SAY.down);
          console.warn('[arcade] could not look up the code', e);
        }
        busy([go, cancel], false);
        sync();
      };
      field.addEventListener('input', sync);
      field.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void run(); } });
      const acts = el('div', null, 'landing-create-actions account-actions');
      acts.append(cancel, go);
      wrap.replaceChildren(lead, codeField.el, acts, err);
      sync();
      field.focus();
    };

    const confirmView = (typed: string, device: PairDevice): void => {
      const err = errorLine();
      const lead = el('p', str('arcade.account.log_in_n_as_you', { 0: deviceName(device) }), 'account-lead');
      void currentAccount(server).then((a) => {
        if (a && lead.isConnected) lead.textContent = str('arcade.account.log_in_n_as_n', { 0: deviceName(device), 1: a.name });
      });
      const warn = el('div', str('arcade.account.only_do_this_for_a'), 'host-set-note');
      const go = actionButton(str('arcade.account.log_it_in'), 'primary', () => { void run(); });
      const back = actionButton(str('arcade.account.back'), 'tertiary', () => askView(typed));
      const run = async (): Promise<void> => {
        show(err, '');
        busy([go, back], true);
        try {
          const r = await post<PairApproveReply>(server, 'pair-approve', { code: typed });
          if (r.ok) { doneView(); return; }
          show(err, r.why === 'code' ? SAY.noCode : SAY['signed-out']);
        } catch (e) {
          show(err, SAY.down);
          console.warn('[arcade] could not approve the code', e);
        }
        busy([go, back], false);
      };
      const acts = el('div', null, 'landing-create-actions account-actions');
      acts.append(back, go);
      wrap.replaceChildren(lead, warn, acts, err);
      back.focus();
    };

    const doneView = (): void => {
      const line = el('p', str('arcade.account.done_the_other_device_is'), 'account-lead');
      const on = actionButton(str('arcade.account.carry_on'), 'primary', () => dlg.close());
      const acts = el('div', null, 'landing-create-actions account-actions');
      acts.append(on);
      wrap.replaceChildren(line, acts);
      on.focus();
    };

    askView();
  });
}
