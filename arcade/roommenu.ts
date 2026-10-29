import { MenuDrawer } from '../web/ui/drawer';
import { card, choreograph, menuRow, sliderRow } from '../web/ui/rows';
import { UI_ICONS, rowIcon } from '../web/ui/icons';
import { starPicker } from '../web/ui/stars';
import { showToast } from '../web/ui/toast';
import { fillKeyTable } from '../web/keytable';
import { chordCaps } from '../web/shortcuts';
import { showKeysRow } from '../web/play/keys';
import { viewFor } from '../web/platform';
import { SchematicPanel } from '../web/schematic';
import { appendItems, appendMenuFoot, disabledItems, menuItems, saveState, type ActionId, type ActionSurface } from '../web/play/actions';
import { StopNote } from '../web/stopnote';
import type { Glass } from './glass';
import type { Room } from './room';
import type { RoomSound, SoundView } from './roomsound';
import type { BrightnessControl } from '../web/ui/brightness';
import { str } from '../web/i18n';

declare const __BUILD_ID__: string;

const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

export function leaveArcade(): void {
  location.href = '/arcade/';
}

export class RoomMenu {
  readonly drawer = new MenuDrawer({
    menu: byId('menu'), backdrop: byId('menuBackdrop'), content: byId('menuContent'),
    sub: byId('menuSub'), fly: byId('menuFly'),
  });
  readonly schem: SchematicPanel;
  private builtFor: Glass | null | undefined = undefined;
  private readonly soundView: SoundView;
  private frames = 0;
  private fps = 0;
  private fpsAt = 0;

  constructor(
    private readonly room: Room,
    sound: RoomSound,
    private readonly bright: BrightnessControl,
    private readonly burger: HTMLButtonElement,
    readonly host: boolean,
    private readonly rating?: { get: () => Promise<number | null>; set: (stars: number) => Promise<boolean> },
  ) {
    this.soundView = sound.view();
    const live = room.live;
    this.schem = new SchematicPanel(byId('schemPanel'), byId('schemBackdrop'), () => live.emu.ioActivity(), () => ({
      fps: this.fps,
      tickHz: live.emu.benchStats()?.tickHz ?? 0,
      stepMs: live.emu.benchStats()?.stepMs ?? 0,
      clockHz: live.emu.info?.clockHz ?? 0,
      droppedMs: live.emu.benchStats()?.droppedMs ?? 0,
      buildId: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev',
    }));
    live.onFrame = (v) => {
      this.frames++;
      const now = performance.now();
      if (now - this.fpsAt >= 1000) {
        this.fps = this.frames;
        this.frames = 0;
        this.fpsAt = now;
      }
      if (this.schem.isOpen) this.schem.sampleFrame(v);
    };
    live.stopNote = new StopNote(document, host ? () => this.openSystem() : undefined,
      () => void saveState(this.actions()));
    if (!host) byId('stopnote-more').hidden = true;
    live.emu.onCoins = () => {
      const g = this.builtFor;
      if (g && live.running && live.glass === g) this.build(g);
    };
    burger.addEventListener('click', () => this.drawer.open());
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.schem.isOpen) this.schem.close();
      else if (this.drawer.isOpen) this.drawer.close();
      else return;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
  }

  private actions(g: Glass | null = this.builtFor ?? null): ActionSurface {
    const live = this.room.live;
    return {
      emu: live.emu,
      game: () => g?.game ?? null,
      sound: () => live.audio.describe(),
      running: () => live.running,
      closeMenu: () => this.drawer.close(),
      coin: (c) => {
        if (g && live.payCoin(c.bit)) live.dropCoin(c.bit);
      },
      coinList: () => (g ? live.menuCoins() : null),
      throwSwitch: (sw, on) => live.throwSwitch(sw, on),
      namedSwitch: (id, level) => live.emu.input(id, level),
      effects: live.effects,
      redraw: () => g?.painter?.invalidate(),
      fillKeys: (root) => {
        const esc = [chordCaps([], 'Esc')];
        fillKeyTable(root, [
          { title: str('arcade.roommenu.arcade'), rows: [showKeysRow(), { label: str('arcade.roommenu.close_menu'), chords: esc }, { label: str('arcade.roommenu.leave_machine'), chords: esc }] },
        ]);
      },
      openSystem: () => this.openSystem(),
      reboot: () => live.powerCycle(),
      leave: () => this.room.stepBack(),
      ...(this.host && g && import.meta.env.DEV ? { loadState: (file: File) => this.loadState(g, file) } : {}),
    };
  }

  private loadState(g: Glass, file: File): void {
    if (!import.meta.env.DEV) return;
    void Promise.all([file.text(), import('./loadstate')]).then(([text, { readStateFile }]) => {
      const r = readStateFile(text, g.machine.name);
      if (!r.ok) { showToast(r.why); return; }
      this.drawer.close();
      const live = this.room.live;
      return live.start(g, { snapshot: r.snapshot, stampPlay: false, saveOnLeave: false }).then(() => {
        if (live.glass !== g) return;
        showToast(live.lastStart?.resumed
          ? str('arcade.roommenu.state_loaded_nothing_you_do')
          : str('arcade.roommenu.the_state_could_not_be', { 0: live.lastStart?.why ?? 'unknown' }));
      });
    }, (e: Error) => showToast(str('arcade.roommenu.the_state_could_not_be_2', { 0: e.message })));
  }

  private openSystem(): void {
    const g = this.builtFor;
    const info = this.room.live.emu.info;
    if (!g || !info) return;
    this.drawer.close();
    this.schem.open(info.schematic ?? null, g.machine.name);
  }

  get isOpen(): boolean {
    return this.drawer.isOpen || this.schem.isOpen;
  }

  update(): void {
    const live = this.room.live;
    const g = live.running ? live.glass : null;
    this.burger.hidden = false;
    if (!g || !g.game || !live.emu.info) {
      if (this.builtFor !== null) {
        if (this.builtFor !== undefined) this.drawer.close();
        if (this.schem.isOpen) this.schem.close();
        this.builtFor = null;
        this.buildRoom();
      }
      return;
    }
    if (this.builtFor !== g) {
      this.builtFor = g;
      this.schem.reset();
      this.build(g);
    }
  }

  private soundCard(): HTMLElement {
    const sound = card();
    sound.append(
      sliderRow(this.soundView.button, this.soundView.slider),
      sliderRow(this.bright.button, this.bright.slider, 'menu-bright'),
    );
    return sound;
  }

  private rateCard(r: { get: () => Promise<number | null>; set: (stars: number) => Promise<boolean> }): HTMLElement {
    const c = card();
    const row = document.createElement('div');
    row.className = 'menu-row menu-rate';
    const label = document.createElement('span');
    label.className = 'row-label';
    label.textContent = str('arcade.roommenu.rate_this_arcade');
    let mine = 0;
    const stars = starPicker({
      label: str('arcade.roommenu.rate_this_arcade'),
      value: 0,
      onPick: (n) => {
        void r.set(n).then((ok) => {
          if (ok) { mine = n; showToast(str('arcade.roommenu.thanks_for_rating'), { kind: 'ok' }); return; }
          stars.set(mine);
          showToast(str('arcade.roommenu.rating_not_kept'));
        });
      },
    });
    void r.get().then((n) => { if (n) { mine = n; stars.set(n); } });
    row.append(rowIcon(UI_ICONS.star, 'row-icon', 20), label);
    const item = document.createElement('div');
    item.className = 'menu-rate-item';
    item.append(row, stars.el);
    c.append(item);
    return c;
  }

  private get ids(): ActionId[] {
    return this.host
      ? ['coins', 'switches', 'options', 'keyboard', 'download', 'system', 'reboot', 'stepBack']
      : ['coins', 'options', 'keyboard', 'download', 'stepBack'];
  }

  private buildRoom(): void {
    const { content, sub } = this.drawer.el;
    content.replaceChildren();
    sub.replaceChildren();
    this.drawer.closeSubmenu();
    this.drawer.closeFlyout();
    content.append(this.soundCard());
    appendItems(content, disabledItems(this.ids), (label, icon, panel) => this.drawer.navRow(label, icon, panel));
    if (!this.host && this.rating) content.lastElementChild?.before(this.rateCard(this.rating));
    const out = card();
    out.append(menuRow(str('arcade.roompage.arcades'), UI_ICONS.back, leaveArcade, false));
    content.append(out);
    appendMenuFoot(content);
    choreograph(content, 90);
  }

  private build(g: Glass): void {
    const live = this.room.live;
    const info = live.emu.info!;
    const game = g.game!;
    const view = viewFor(game.system);
    const { content, sub } = this.drawer.el;
    content.replaceChildren();
    sub.replaceChildren();
    this.drawer.closeSubmenu();
    this.drawer.closeFlyout();

    content.append(this.soundCard());

    appendItems(content, menuItems(this.actions(g), { info, view, system: game.system }, this.ids),
      (label, icon, panel) => this.drawer.navRow(label, icon, panel));
    appendMenuFoot(content);

    choreograph(content, 90);
  }
}
