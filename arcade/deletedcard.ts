import { actionButton } from '../web/ui/list';
import { openDialog } from '../web/ui/dialog';
import { textField } from '../web/ui/field';
import { showToast } from '../web/ui/toast';
import { UI_ICONS } from '../web/ui/icons';
import { str } from '../web/i18n';
import type { ArcadeDoc } from './doc';
import { ARCADE_NAME_MAX, cleanName } from './machines';
import { HAVE_ONE, NAME_TAKEN, publishRefusal, restoreArcade, type ArcadeServer } from './share';

export interface DeletedCardHooks {
  restore(): void;
  remove(): void;
}

export function deletedCard(d: ArcadeDoc, art: HTMLElement, h: DeletedCardHooks): HTMLElement {
  const box = document.createElement('article');
  box.className = 'nb-glass nb-glass--hero landing-hero landing-deleted';
  box.setAttribute('aria-label', d.name || str('arcade.landing.your_arcade'));
  art.classList.add('landing-hero-art');
  const body = document.createElement('div');
  body.className = 'landing-hero-body';
  const name = document.createElement('h2');
  name.className = 'nb-display landing-hero-name';
  name.textContent = d.name || str('arcade.landing.no_name');
  const line = document.createElement('p');
  line.className = 'nb-meta landing-hero-line';
  line.textContent = str('arcade.landing.this_arcade_was_deleted');
  const acts = document.createElement('div');
  acts.className = 'landing-hero-actions';
  const restore = actionButton(str('arcade.landing.restore'), 'primary', () => h.restore());
  const remove = actionButton(str('arcade.landing.remove_from_this_device'), 'secondary', () => h.remove(), UI_ICONS.trash);
  restore.classList.add('nb-btn--lg');
  remove.classList.add('nb-btn--lg');
  acts.append(restore, remove);
  body.append(name, line, acts);
  box.append(art, body);
  return box;
}

export async function startRestore(server: ArcadeServer, d: ArcadeDoc, mayHaveOne: () => Promise<boolean>, done: () => void): Promise<void> {
  if (!(await mayHaveOne())) { showToast(HAVE_ONE, { kind: 'warn' }); return; }
  const r = await restoreArcade(server, d);
  if (r?.ok) { done(); return; }
  if (r?.why === 'taken') { askName(server, d, done); return; }
  showToast(publishRefusal(r), { error: true, sticky: true });
}

function askName(server: ArcadeServer, d: ArcadeDoc, done: () => void): void {
  const nameField = textField({ label: str('arcade.landing.name'), value: d.name, maxLength: ARCADE_NAME_MAX, autocomplete: 'off' });
  const field = nameField.input;
  field.setAttribute('aria-label', str('arcade.landing.arcade_name'));
  const go = async (): Promise<void> => {
    const n = cleanName(field.value);
    if (!n || busy) { field.focus(); return; }
    busy = true;
    sync();
    const r = await restoreArcade(server, d, n);
    if (r?.ok) { dialog.close(); done(); return; }
    busy = false;
    sync();
    nameField.error(publishRefusal(r));
    field.focus();
  };
  const yes = actionButton(str('arcade.landing.restore'), 'primary', () => { void go(); });
  let busy = false;
  const sync = (): void => { yes.disabled = busy || !cleanName(field.value); };
  const acts = document.createElement('div');
  acts.className = 'landing-create-actions';
  acts.append(yes);
  const wrap = document.createElement('div');
  wrap.className = 'host-settings landing-create';
  wrap.append(nameField.el, acts);
  field.addEventListener('input', () => { nameField.error(''); sync(); });
  field.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void go(); } });
  sync();
  const dialog = openDialog({ title: str('arcade.landing.restore'), body: [wrap], frost: true });
  nameField.error(NAME_TAKEN);
  field.select();
}
