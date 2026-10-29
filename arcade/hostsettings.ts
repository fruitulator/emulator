import { openAlert, openDialog, type Dialog } from '../web/ui/dialog';
import { UI_ICONS, rowIcon } from '../web/ui/icons';
import { pillButton } from '../web/ui/list';
import { card, checkRow, menuRow } from '../web/ui/rows';
import { standing, unsourcedMachines, type ArcadeDoc, type DocMachine } from './doc';
import { serverMoney, statsMoney } from './moneyrecord';
import { ARCADE_NAME_MAX, cleanName } from './machines';
import { moneyTrust } from './moneygate';
import { showToast } from '../web/ui/toast';
import { str } from '../web/i18n';
import { textField } from '../web/ui/field';

export interface SettingsHooks {
  doc: ArcadeDoc;
  save(): Promise<void>;
  renamed(): void;
  claimName?(name: string): Promise<string | null>;
  remove(): Promise<void>;
  share?: ShareHooks | null;
}

export interface ShareHooks {
  isPublic(): Promise<boolean>;
  setPublic(on: boolean): Promise<void>;
  shareLink(): Promise<void>;
  shared(): boolean;
}

export const pounds = (p: number): string => `${p < 0 ? '-' : ''}£${(Math.abs(p) / 100).toFixed(2)}`;

export function machineMoney(m: DocMachine): { inPence: number; outPence: number } | null {
  if (moneyTrust(m.board).trust === 'none') return null;
  const f = statsMoney(m);
  return { inPence: f.inPence, outPence: f.outPence };
}

export function arcadeMoney(d: ArcadeDoc): { inPence: number; outPence: number } | null {
  let any = false;
  let inPence = 0;
  let outPence = 0;
  for (const m of d.machines) {
    const r = machineMoney(m);
    if (!r) continue;
    any = true;
    inPence += r.inPence;
    outPence += r.outPence;
  }
  return any ? { inPence, outPence } : null;
}

export interface ArcadeFigures {
  money: { inPence: number; outPence: number } | null;
  plays: number;
  machines: number;
}

export async function arcadeFigures(d: ArcadeDoc, server: boolean): Promise<ArcadeFigures> {
  const up = standing(d);
  let plays = 0;
  for (const m of up) plays += m.stats?.plays ?? 0;
  let any = false;
  let inPence = 0;
  let outPence = 0;
  const books = d.machines.filter((m) => moneyTrust(m.board).trust !== 'none');
  const reads = await Promise.all(books.map(async (m) => {
    const r = server ? await serverMoney(d.id, m.id) : undefined;
    return r === undefined ? statsMoney(m) : statsMoney(m, r);
  }));
  for (const f of reads) { any = true; inPence += f.inPence; outPence += f.outPence; }
  return { money: any ? { inPence, outPence } : null, plays, machines: up.length };
}

export function deleteLines(d: ArcadeDoc, shared: boolean): string[] {
  const lines = [str('arcade.hostsettings.deleting_this_arcade_will_also')];
  const money = d.machines.length ? arcadeMoney(d) : null;
  if (money && (money.inPence || money.outPence)) {
    lines.push(str('arcade.hostsettings.machine_cash_n_in_n', { 0: pounds(money.inPence), 1: pounds(money.outPence) }));
  }
  if (shared) lines.push(str('arcade.hostsettings.it_comes_off_the_arcades'));
  return lines;
}

let open: Dialog | null = null;

export interface SettingsParts {
  top: Node[];
  danger: Node[];
  keepName(): Promise<string | null>;
}

export function arcadeSettingsParts(h: SettingsHooks, onGone?: () => void): SettingsParts {
  const d = h.doc;
  const body: Node[] = [];
  let gone = false;

  const nameField = textField({ label: str('arcade.hostsettings.name'), value: d.name, maxLength: ARCADE_NAME_MAX, autocomplete: 'off' });
  const field = nameField.input;
  field.setAttribute('aria-label', str('arcade.hostsettings.arcade_name'));
  const sayName = nameField.error;
  let asking: { n: string; p: Promise<string | null> } | null = null;
  const keepName = async (): Promise<string | null> => {
    if (gone) return null;
    const n = cleanName(field.value);
    if (!n) { field.value = d.name; sayName(''); return null; }
    field.value = n;
    if (n === d.name) { sayName(''); return null; }
    if (asking?.n === n) return asking.p;
    const p = (async (): Promise<string | null> => {
      const why = h.claimName ? await h.claimName(n) : null;
      if (gone) return null;
      if (why) { sayName(why); return why; }
      sayName('');
      d.name = n;
      await h.save();
      h.renamed();
      return null;
    })();
    asking = { n, p };
    try { return await p; } finally { if (asking?.p === p) asking = null; }
  };
  field.addEventListener('input', () => sayName(''));
  field.addEventListener('change', () => { void keepName().then((why) => { if (why && field.isConnected) field.focus(); }); });
  field.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); field.blur(); }
  });
  body.push(nameField.el);

  const delCard = card();
  const del = menuRow(str('arcade.hostsettings.delete_arcade'), UI_ICONS.trash, () => confirmDelete(h, () => { gone = true; onGone?.(); }), false);
  del.classList.add('host-set-delete', 'nb-menu-item--danger');
  delCard.append(del);
  return { top: body, danger: [delCard], keepName };
}

export function darkNote(d: ArcadeDoc, cls: string, icon: string = UI_ICONS.warn): HTMLElement | null {
  const n = unsourcedMachines(d).length;
  if (!n) return null;
  const p = document.createElement('p');
  p.className = `${cls} host-caveat`;
  const text = document.createElement('span');
  text.textContent = str('arcade.host.n_dark_for_visitors', { n });
  p.append(rowIcon(icon, 'host-caveat-icon', 14), text);
  return p;
}

export function publicSwitch(s: ShareHooks, onChange?: (on: boolean) => void, label: (on: boolean) => string = () => str('arcade.hostsettings.public')): {
  row: HTMLLabelElement; box: HTMLInputElement; note: HTMLElement;
} {
  const pub = checkRow(label(false), (on) => {
    pub.box.disabled = true;
    void s.setPublic(on).catch(() => { pub.box.checked = !on; }).finally(() => {
      pub.box.disabled = false;
      sayVisit();
    });
  });
  pub.row.classList.add('host-set-public');
  const note = document.createElement('div');
  note.className = 'host-set-note';
  const sayVisit = (): void => {
    note.textContent = pub.box.checked
      ? str('arcade.hostsettings.on_the_arcades_list_for')
      : str('arcade.hostsettings.not_listed_only_people_you');
    const l = pub.row.querySelector('.row-label');
    if (l) l.textContent = label(pub.box.checked);
    onChange?.(pub.box.checked);
  };
  pub.box.checked = false;
  pub.box.disabled = true;
  sayVisit();
  void s.isPublic().then((on) => { pub.box.checked = on; }).catch(() => undefined).finally(() => {
    pub.box.disabled = false;
    sayVisit();
  });
  return { row: pub.row, box: pub.box, note };
}

export function openArcadeSettings(h: SettingsHooks): Dialog {
  open?.close();
  const parts = arcadeSettingsParts(h, () => open?.close());
  const keepName = parts.keepName;
  const wrap = document.createElement('div');
  wrap.className = 'host-settings';
  wrap.append(...parts.top, ...parts.danger);
  open = openDialog({
    title: str('arcade.hostsettings.arcade_settings'), body: [wrap], frost: true,
    onClose: () => {
      open = null;
      void keepName().then((why) => { if (why) showToast(why); });
    },
  });
  return open;
}

function confirmDelete(h: SettingsHooks, going: () => void): void {
  const d = h.doc;
  const keep = pillButton(str('arcade.hostsettings.keep_it'), () => undefined);
  const yes = pillButton(str('arcade.hostsettings.yes_delete_it'), () => undefined);
  yes.classList.add('nb-btn--danger');
  openAlert({
    info: true,
    message: str('arcade.hostsettings.delete_n', { 0: d.name || str('arcade.hostsettings.this_arcade') }),
    lines: deleteLines(d, !!h.share?.shared()),
    buttons: [
      { button: keep, run: () => undefined },
      {
        button: yes,
        run: () => {
          going();
          void h.remove();
        },
      },
    ],
  });
}
