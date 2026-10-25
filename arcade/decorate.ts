import { enhanceSelect } from '../web/ui/dropdown';
import { UI_ICONS } from '../web/ui/icons';
import { backRow, card, checkRow, menuRow, resetSlider } from '../web/ui/rows';
import { CARPETS, copyLook, HOUSE_LOOK, NEON_MOTIONS, NEON_SPEED, WINDOW_VIEWS, PANELLING, THEMES, themeOfLook, UPPER_WALLS, type RoomLook } from './roomlook';
import { str } from '../web/i18n';

const SAVE_AFTER_MS = 500;

let ids = 0;

export interface DecorateSection {
  open(slide?: 'in' | 'none'): void;
  escape(): boolean;
  leave(): void;
}

export function decorateSection(o: {
  look: RoomLook;
  apply(look: RoomLook): void;
  save(look: RoomLook): Promise<void>;
  panel: { show(nodes: Node[], slide?: 'in' | 'out' | 'none'): void; back(): void };
}): DecorateSection {
  let look: RoomLook = copyLook(o.look);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    void o.save(look);
  };
  const change = (next: Partial<RoomLook>): void => {
    look = copyLook({ ...look, ...next });
    o.apply(look);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_AFTER_MS);
  };

  const subhead = (text: string): HTMLElement => {
    const h = document.createElement('h3');
    h.className = 'ui-subhead';
    h.textContent = text;
    return h;
  };
  const labelled = (text: string, cls: string): HTMLElement => {
    const r = document.createElement('label');
    r.className = cls;
    const l = document.createElement('span');
    l.className = 'row-label ui-slider-label';
    l.textContent = text;
    r.append(l);
    return r;
  };
  const well = (text: string, get: () => string, put: (v: string) => void): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = 'color';
    i.className = 'ui-dock-colour';
    i.setAttribute('aria-label', text);
    i.value = get();
    i.addEventListener('input', () => put(i.value));
    i.addEventListener('change', flush);
    return i;
  };
  const colourRow = (text: string, get: () => string, put: (v: string) => void): HTMLElement => {
    const r = labelled(text, 'menu-row menu-vol ui-slider');
    r.append(well(text, get, put));
    return r;
  };
  const choiceRow = <T extends string>(text: string, list: { id: T; label: string }[], get: () => T, put: (v: T) => void): HTMLElement => {
    const r = labelled(text, 'menu-row menu-key');
    const sel = document.createElement('select');
    sel.id = `decorate${++ids}`;
    sel.setAttribute('aria-label', text);
    for (const x of list) {
      const opt = document.createElement('option');
      opt.value = x.id;
      opt.textContent = x.label;
      sel.append(opt);
    }
    sel.value = get();
    sel.addEventListener('change', () => put(sel.value as T));
    r.append(sel);
    enhanceSelect(sel);
    return r;
  };

  type View = 'home' | 'walls' | 'carpet' | 'neon';

  let view: View = 'home';
  const themesRow = (): HTMLElement => {
    const themes = document.createElement('div');
    themes.className = 'decorate-themes';
    themes.setAttribute('role', 'group');
    themes.setAttribute('aria-label', str('arcade.decorate.presets'));
    const cur = themeOfLook(look);
    for (const t of THEMES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'decorate-theme';
      b.setAttribute('aria-pressed', String(t.id === cur));
      const sw = document.createElement('span');
      sw.className = 'decorate-swatch';
      const l = t.look;
      const floor = l.carpet === 'neon' ? l.carpetInks[0] : l.carpetColour;
      sw.style.background = `linear-gradient(90deg, ${l.upperColour} 0 30%, ${l.lowerColour} 30% 55%, ${floor} 55% 78%, ${l.sign} 78%)`;
      b.append(sw, document.createTextNode(t.label));
      b.addEventListener('click', () => { change(copyLook(t.look)); render(); });
      themes.append(b);
    }
    return themes;
  };
  const wallsCard = (): HTMLElement => {
    const walls = card();
    walls.append(
      choiceRow(str('arcade.decorate.panels'), PANELLING, () => look.lower, (v) => {
        change({ lower: v, lowerColour: PANELLING.find((p) => p.id === v)!.colour });
        render();
      }),
      colourRow(str('arcade.decorate.panel_colour'), () => look.lowerColour, (v) => change({ lowerColour: v })),
      colourRow(str('arcade.decorate.rail'), () => look.rail, (v) => change({ rail: v })),
      choiceRow(str('arcade.decorate.upper_wall'), UPPER_WALLS, () => look.upper, (v) => {
        change({ upper: v, upperColour: UPPER_WALLS.find((p) => p.id === v)!.colour });
        render();
      }),
      colourRow(str('arcade.decorate.wall_colour'), () => look.upperColour, (v) => change({ upperColour: v })),
      choiceRow(str('arcade.decorate.window'), WINDOW_VIEWS, () => look.window, (v) => change({ window: v })),
    );
    return walls;
  };
  const neonCard = (): HTMLElement => {
    const neon = card();
    const tubes = labelled(str('arcade.decorate.tubes'), 'menu-row menu-vol ui-slider');
    const wells = document.createElement('span');
    wells.className = 'ui-dock-colours';
    (['back wall', 'front wall', 'side wall'] as const).forEach((where, n) => {
      wells.append(well(str('arcade.decorate.neon_n', { 0: where }), () => look.neon[n], (v) => {
        const next = [...look.neon] as RoomLook['neon'];
        next[n] = v;
        change({ neon: next });
      }));
    });
    tubes.append(wells);
    const sign = checkRow(str('arcade.decorate.sign'), (on) => { change({ signOn: on }); render(); });
    sign.box.checked = look.signOn;
    const lit = checkRow(str('arcade.decorate.neon'), (on) => { change({ neonOn: on }); render(); });
    lit.box.checked = look.neonOn;
    neon.append(lit.row);
    if (look.neonOn) neon.append(tubes, choiceRow(str('arcade.decorate.motion'), NEON_MOTIONS, () => look.neonMotion, (v) => { change({ neonMotion: v }); render(); }));
    if (look.neonOn && look.neonMotion !== 'still') {
      const speed = resetSlider({
        label: str('arcade.decorate.speed'), min: NEON_SPEED.min, max: NEON_SPEED.max, step: 0.05, value: look.neonSpeed, home: 1,
        format: (v) => `${v.toFixed(2)}×`, onInput: (v) => change({ neonSpeed: v }),
      });
      neon.append(speed.row);
    }
    neon.append(sign.row);
    if (look.signOn) neon.append(colourRow(str('arcade.decorate.sign_colour'), () => look.sign, (v) => change({ sign: v })));
    return neon;
  };
  const carpetCard = (): HTMLElement => {
    const floor = card();
    floor.append(choiceRow(str('arcade.decorate.type'), CARPETS, () => look.carpet, (v) => {
      change({ carpet: v, carpetColour: CARPETS.find((c) => c.id === v)!.colour });
      render();
    }));
    if (look.carpet === 'neon') {
      floor.append(colourRow(str('arcade.decorate.background'), () => look.carpetGround, (v) => change({ carpetGround: v })));
      const pattern = labelled(str('arcade.decorate.pattern'), 'menu-row menu-vol ui-slider');
      const inks = document.createElement('span');
      inks.className = 'ui-dock-colours';
      (['first', 'second', 'third'] as const).forEach((which, n) => {
        inks.append(well(str('arcade.decorate.carpet_pattern_n_colour', { 0: which }), () => look.carpetInks[n], (v) => {
          const next = [...look.carpetInks] as RoomLook['carpetInks'];
          next[n] = v;
          change({ carpetInks: next });
        }));
      });
      pattern.append(inks);
      floor.append(pattern);
    } else {
      floor.append(colourRow(str('arcade.decorate.carpet_colour'), () => look.carpetColour, (v) => change({ carpetColour: v })));
    }
    return floor;
  };
  const SECTIONS: Record<Exclude<View, 'home'>, { title: string; icon: string; build: () => HTMLElement }> = {
    walls: { title: str('arcade.decorate.walls'), icon: UI_ICONS.wall, build: wallsCard },
    carpet: { title: str('arcade.decorate.carpet'), icon: UI_ICONS.floor, build: carpetCard },
    neon: { title: str('arcade.decorate.neon_and_sign'), icon: UI_ICONS.neon, build: neonCard },
  };
  const dock = o.panel;
  const go = (v: View, slide: 'in' | 'out'): void => { view = v; render(slide); };
  const render = (slide: 'in' | 'out' | 'none' = 'none'): void => {
    if (view === 'home') {
      const parts = card();
      for (const k of Object.keys(SECTIONS) as (keyof typeof SECTIONS)[]) {
        parts.append(menuRow(SECTIONS[k].title, SECTIONS[k].icon, () => go(k, 'in'), true));
      }
      const reset = card();
      reset.append(menuRow(str('arcade.decorate.reset_theme'), UI_ICONS.reset, () => {
        change(copyLook(HOUSE_LOOK));
        render();
      }, false));
      dock.show([backRow(str('arcade.decorate.title'), () => { leave(); o.panel.back(); }),
        subhead(str('arcade.decorate.presets')), themesRow(), parts, reset], slide);
    } else {
      const sec = SECTIONS[view];
      dock.show([backRow(sec.title, () => go('home', 'out')), sec.build()], slide);
    }
  };
  const leave = (): void => {
    flush();
  };
  return {
    open(slide = 'in') {
      view = 'home';
      render(slide);
    },
    escape() {
      if (view !== 'home') { go('home', 'out'); return true; }
      leave();
      return false;
    },
    leave,
  };
}
