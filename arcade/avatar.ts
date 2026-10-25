import { Avatar, avatarFace } from '../web/ui/avatar';
import { closeSheet, escapeCloses, sheetRow, showSheet } from '../web/ui/sheet';
import { type Cropper, openCropper } from '../web/ui/cropper';
import { avatarUrl, currentAccount, deleteAccount, logOut, openApprove, openLogin, putAvatar, setPlayerName } from './account';
import { devPlayer, serverFlag, walletServer } from './remote';
import { formatBalance, type Balance, type Wallet } from './wallet';
import { AVATAR_LIMIT, AVATAR_SIZE, PLAYER_NAME_MAX, type AccountInfo, type WalletPayDay } from './serverwire';
import { str } from '../web/i18n';
import { openPrivacy } from './privacy';

const money = (pence: number): string => formatBalance({ cashPence: pence, tokenPence: 0 });

export function payDayText(p: WalletPayDay, at: number = Date.now()): string {
  const mins = Math.max(1, Math.ceil((p.at - at) / 60_000));
  const h = Math.floor(mins / 60);
  if (h === 0) return str('arcade.avatar.n_in_n_min', { 0: money(p.floorPence), 1: mins });
  return str('arcade.avatar.n_in_n_h_n_min', { 0: money(p.floorPence), 1: h, 2: mins % 60 });
}

export interface AvatarOptions {
  wallet?: Wallet | null;
  beforeDelete?: () => Promise<void>;
}

export async function mountAvatar(at: HTMLElement, o: AvatarOptions = {}): Promise<Avatar | null> {
  const server = serverFlag();
  if (!server) return null;
  let account: AccountInfo | null = null;
  const avatar = new Avatar(() => {
    if (!account) {
      void openLogin(server).then((got) => { if (got) location.reload(); });
      return;
    }
    openOptions(avatar, account, server, o.wallet ?? null, show, o.beforeDelete);
  }, { pillId: 'balance' });
  const show = (a: AccountInfo): void => {
    account = a;
    avatar.face(a.name);
    avatar.picture(avatarUrl(server, a));
    avatar.label(a.dev ? str('arcade.avatar.test_player_n', { 0: a.name }) : str('arcade.avatar.n_your_options', { 0: a.name }));
  };
  avatar.el.classList.add('arcade-avatar');
  at.append(avatar.el);
  account = await currentAccount(server);
  if (!account) {
    avatar.face(null);
    avatar.pill(str('arcade.avatar.log_in'));
    avatar.label(str('arcade.avatar.log_in'));
    return avatar;
  }
  show(account);
  const wallet = o.wallet;
  if (wallet) {
    const show = (): void => {
      const b = wallet.shown();
      avatar.pill(b ? money(b.cashPence) : null);
      if (sheetOpen) fillBalances(b);
    };
    wallet.onChange = show;
    show();
  } else {
    void walletServer(server, devPlayer()).balance().then((b) => {
      avatar.pill(money(b.cashPence));
    }).catch((e) => {
      console.warn('[arcade] the balance could not be read', e);
    });
  }
  return avatar;
}

let sheetOpen: HTMLElement | null = null;

function fillBalances(b: Balance | null): void {
  const at = sheetOpen;
  if (!at) return;
  const rows: HTMLElement[] = [];
  if (!b) rows.push(figureRow(str('arcade.avatar.cash'), '…'));
  else {
    rows.push(figureRow(str('arcade.avatar.cash'), money(b.cashPence)));
    if (b.tokenPence) rows.push(figureRow(str('arcade.avatar.tokens'), money(b.tokenPence)));
    if (b.payDay) rows.push(figureRow(str('arcade.avatar.pay_day'), payDayText(b.payDay)));
  }
  at.replaceChildren(...rows);
}

function figureRow(label: string, amount: string): HTMLElement {
  const r = sheetRow(label, '');
  r.classList.add('inert');
  r.tabIndex = -1;
  const a = document.createElement('span');
  a.className = 'sheet-amount';
  a.textContent = amount;
  r.append(a);
  return r;
}

function openOptions(avatar: Avatar, first: AccountInfo, server: string, wallet: Wallet | null, changed: (a: AccountInfo) => void,
  beforeDelete?: () => Promise<void>): void {
  let a = first;
  const balances = document.createElement('div');
  balances.className = 'avatar-balances';
  balances.style.display = 'contents';
  sheetOpen = balances;
  fillBalances(wallet?.shown() ?? null);
  if (!wallet) {
    void walletServer(server, devPlayer()).balance().then((b) => {
      if (sheetOpen === balances) fillBalances(b);
    }).catch((e) => {
      console.warn('[arcade] the balance could not be read', e);
      if (sheetOpen === balances) balances.replaceChildren(figureRow(str('arcade.avatar.cash'), str('arcade.avatar.not_available_just_now')));
    });
  }
  const title = (): string => a.dev ? str('arcade.avatar.test_player_n', { 0: a.name }) : a.name;
  const open = (rows: HTMLElement[]): void => {
    showSheet(title(), rows, avatar.el);
    document.getElementById('sheet-title')?.prepend(avatarFace(a.name, a.dev ? null : avatarUrl(server, a), 44));
  };

  const noteRow = (): { row: HTMLElement; say(text: string): void } => {
    const row = sheetRow('', '');
    row.classList.add('inert', 'avatar-note');
    row.tabIndex = -1;
    row.hidden = true;
    return { row, say: (text) => { row.firstElementChild!.textContent = text; row.hidden = !text; } };
  };

  const options = (): void => {
    const rows: HTMLElement[] = [balances];
    let out: HTMLButtonElement | null = null;
    if (!a.dev) {
      const edit = sheetRow(str('arcade.avatar.edit_name'), '');
      edit.addEventListener('click', () => nameField());
      const pic = sheetRow(str('arcade.avatar.upload_a_picture'), '');
      const note = noteRow();
      pic.addEventListener('click', () => pickPicture(pic, note.say));
      out = sheetRow(str('arcade.avatar.log_out'), '');
      out.addEventListener('click', () => { closeSheet(); void logOut(server); });
      const del = sheetRow(str('arcade.avatar.delete_my_account'), '');
      del.classList.add('destructive');
      del.addEventListener('click', () => confirmDelete());
      const pair = sheetRow(str('arcade.avatar.log_in_another_device'), '');
      pair.addEventListener('click', () => { closeSheet(); void openApprove(server); });
      const priv = sheetRow(str('arcade.privacy.privacy'), '');
      priv.addEventListener('click', () => { closeSheet(); openPrivacy(); });
      const guide = sheetRow(str('arcade.guide.how_the_arcade_works'), '');
      guide.addEventListener('click', () => { closeSheet(); void import('./guide').then((m) => m.openGuide()); });
      rows.push(edit, pic, note.row, pair, guide, priv, out, del);
    }
    open(rows);
    out?.focus();
  };

  const nameField = (): void => {
    const row = document.createElement('div');
    row.className = 'sheet-row sheet-field';
    const cap = document.createElement('span');
    cap.textContent = str('arcade.account.player_name');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = a.name;
    input.maxLength = PLAYER_NAME_MAX;
    input.setAttribute('aria-label', str('arcade.account.player_name'));
    input.setAttribute('autocomplete', 'nickname');
    input.spellcheck = false;
    row.append(cap, input);
    const note = noteRow();
    const save = sheetRow(str('arcade.avatar.save'), '');
    const cancel = sheetRow(str('arcade.avatar.cancel'), '');
    const busy = (on: boolean): void => { save.disabled = on; cancel.disabled = on; input.disabled = on; };
    const run = async (): Promise<void> => {
      const name = input.value.trim();
      if (!name) { note.say(str('arcade.account.choose_a_player_name_first')); input.focus(); return; }
      if (name === a.name) { options(); return; }
      note.say('');
      busy(true);
      try {
        const r = await setPlayerName(server, name);
        if (!r.ok) {
          note.say(r.why === 'name' ? str('arcade.avatar.that_name_can_t_be') : str('arcade.account.you_ve_been_logged_out'));
          busy(false);
          input.focus();
          return;
        }
        a = r.account;
        changed(a);
        options();
      } catch (e) {
        console.warn('[arcade] the name could not be changed', e);
        note.say(str('arcade.account.the_arcade_can_t_be'));
        busy(false);
      }
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); void run(); }
    });
    save.addEventListener('click', () => { void run(); });
    cancel.addEventListener('click', () => options());
    open([row, note.row, save, cancel]);
    input.focus();
    input.select();
  };

  const confirmDelete = (): void => {
    const para = (text: string): HTMLElement => {
      const p = document.createElement('p');
      p.className = 'sheet-note';
      p.textContent = text;
      return p;
    };
    const cash = para('');
    const sayCash = (b: Balance | null): void => {
      cash.textContent = !b ? str('arcade.avatar.the_money_in_your_wallet')
        : b.tokenPence
          ? str('arcade.avatar.the_money_in_your_wallet_2', { 0: money(b.cashPence), 1: money(b.tokenPence) })
          : str('arcade.avatar.the_money_in_your_wallet_3', { 0: money(b.cashPence) });
    };
    sayCash(wallet?.shown() ?? null);
    if (!wallet) void walletServer(server, devPlayer()).balance().then(sayCash).catch(() => undefined);
    const note = noteRow();
    const yes = sheetRow(str('arcade.avatar.delete_my_account'), '');
    yes.classList.add('destructive');
    const cancel = sheetRow(str('arcade.avatar.cancel'), '');
    const busy = (on: boolean): void => { yes.disabled = on; cancel.disabled = on; };
    yes.addEventListener('click', () => {
      void (async () => {
        note.say('');
        busy(true);
        try {
          await beforeDelete?.();
          const r = await deleteAccount(server);
          if (!r.ok) { note.say(str('arcade.account.you_ve_been_logged_out')); busy(false); }
        } catch (e) {
          console.warn('[arcade] the account could not be deleted', e);
          note.say(str('arcade.account.the_arcade_can_t_be'));
          busy(false);
        }
      })();
    });
    cancel.addEventListener('click', () => options());
    open([
      para(str('arcade.avatar.your_player_name_your_picture')),
      cash,
      para(str('arcade.avatar.if_you_host_an_arcade')),
      para(str('arcade.avatar.this_cannot_be_undone_your')),
      note.row, yes, cancel,
    ]);
    cancel.focus();
  };

  const pickPicture = (row: HTMLButtonElement, say: (text: string) => void): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) void cropPicture(f, say);
    });
    input.click();
  };

  let cropper: Cropper | null = null;
  const dropCropper = (): void => { cropper?.destroy(); cropper = null; };

  const cropPicture = async (file: File, say: (text: string) => void): Promise<void> => {
    say('');
    dropCropper();
    try {
      cropper = await openCropper(file, { out: AVATAR_SIZE, zoomLabel: str('arcade.avatar.zoom'), round: true });
    } catch (e) {
      console.warn('[arcade] the picture could not be read', e);
      say(str('arcade.avatar.that_picture_can_t_be'));
      return;
    }
    const c = cropper;
    const pic = document.createElement('div');
    pic.className = 'sheet-row sheet-crop';
    pic.append(c.view);
    const zoom = document.createElement('div');
    zoom.className = 'sheet-row sheet-field sheet-zoom';
    const cap = document.createElement('span');
    cap.textContent = str('arcade.avatar.zoom');
    zoom.append(cap, c.slider);
    const note = noteRow();
    const save = sheetRow(str('arcade.avatar.save'), '');
    const cancel = sheetRow(str('arcade.avatar.cancel'), '');
    const busy = (on: boolean): void => { save.disabled = on; cancel.disabled = on; c.slider.disabled = on; };
    save.addEventListener('click', () => { void upload(c, save, note.say, busy); });
    cancel.addEventListener('click', () => { dropCropper(); options(); });
    open([pic, zoom, note.row, save, cancel]);
    c.view.focus({ preventScroll: true });
  };

  const upload = async (c: Cropper, row: HTMLButtonElement, say: (text: string) => void, busy: (on: boolean) => void): Promise<void> => {
    const label = row.firstElementChild!;
    const was = label.textContent;
    say('');
    busy(true);
    label.textContent = str('arcade.avatar.uploading');
    try {
      let pic: { bytes: Uint8Array; type: string };
      try {
        pic = await encodeAvatar(c.render(AVATAR_SIZE, '#1c1c1f'));
      } catch (e) {
        console.warn('[arcade] the picture could not be encoded', e);
        say(str('arcade.avatar.that_picture_can_t_be'));
        return;
      }
      const r = await putAvatar(server, pic.bytes, pic.type);
      if (!r.ok) { say(r.why === 'bad' ? str('arcade.avatar.that_picture_can_t_be') : str('arcade.account.you_ve_been_logged_out')); return; }
      a = r.account;
      changed(a);
      dropCropper();
      closeSheet();
    } catch (e) {
      console.warn('[arcade] the picture could not be sent', e);
      say(str('arcade.account.the_arcade_can_t_be'));
    } finally {
      busy(false);
      label.textContent = was;
    }
  };

  options();
  escapeCloses(() => {
    if (sheetOpen === balances) sheetOpen = null;
    dropCropper();
  });
}

export async function encodeAvatar(canvas: HTMLCanvasElement): Promise<{ bytes: Uint8Array; type: string }> {
  for (const q of [0.86, 0.7, 0.5]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (!blob) break;
    if (blob.size <= AVATAR_LIMIT) return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg' };
  }
  throw new Error('the picture could not be made small enough');
}
