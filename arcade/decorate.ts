import { enhanceSelect } from '../web/ui/dropdown';
import { UI_ICONS } from '../web/ui/icons';
import { backRow, card, checkRow, menuRow, resetSlider } from '../web/ui/rows';
import {
  CARPETS, CEILING_FINISHES, CEILING_GLOW_MAX, CEILINGS, copyLook, fitSign, FONT_NAMES, fullHeight, HOUSE_LOOK, NEON_MOTIONS, NEON_SPEED, WINDOW_VIEWS,
  PANELLING, SIGN_BOARDS, SIGN_CHASE, SIGN_FONTS, SIGN_HEIGHT, SIGN_LEDS, SIGN_SIZE, SIGN_STYLES, SIGN_TEXT_MAX, signBlocked, THEMES,
  themeOfLook, UPPER_WALLS, upperTinted, WALL_FIXTURES, SCONCE_SHADES, SCONCE_METALS, WALL_LIGHT_STRENGTHS, type RoomLook, type SignStyle,
} from './roomlook';
import { textField } from '../web/ui/field';
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
    look = fitSign(copyLook({ ...look, ...next }));
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
  const labelled = (text: string, cls: string, dep = false): HTMLElement => {
    const r = document.createElement('label');
    r.className = `${cls} decorate-row${dep ? ' decorate-dep' : ''}`;
    const l = document.createElement('span');
    l.className = 'row-label ui-slider-label';
    l.textContent = text;
    r.append(l);
    return r;
  };
  const well = (text: string, get: () => string, put: (v: string) => void): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = 'color';
    i.className = 'decorate-swatch-well';
    i.setAttribute('aria-label', text);
    i.value = get();
    i.addEventListener('input', () => put(i.value));
    i.addEventListener('change', flush);
    return i;
  };
  const colourRow = (text: string, get: () => string, put: (v: string) => void, dep = false): HTMLElement => {
    const r = labelled(text, 'menu-row menu-vol ui-slider', dep);
    r.append(well(text, get, put));
    return r;
  };
  const choiceRow = <T extends string>(
    text: string, list: { id: T; label: string }[], get: () => T, put: (v: T) => void,
    blocked?: (v: T) => string | null, dep = false,
  ): HTMLElement => {
    const r = labelled(text, 'menu-row menu-key', dep);
    const sel = document.createElement('select');
    sel.id = `decorate${++ids}`;
    sel.setAttribute('aria-label', text);
    for (const x of list) {
      const opt = document.createElement('option');
      opt.value = x.id;
      opt.textContent = x.label;
      const why = blocked?.(x.id);
      if (why) { opt.disabled = true; opt.title = why; }
      sel.append(opt);
    }
    sel.value = get();
    sel.addEventListener('change', () => put(sel.value as T));
    r.append(sel);
    enhanceSelect(sel);
    return r;
  };

  type View = 'home' | 'walls' | 'carpet' | 'ceiling' | 'lights' | 'sign';

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
      b.className = 'nb-btn nb-btn--sm decorate-theme';
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
    if (!fullHeight(look.upper)) {
      walls.append(
        choiceRow(str('arcade.decorate.panels'), PANELLING, () => look.lower, (v) => {
          change({ lower: v, lowerColour: PANELLING.find((p) => p.id === v)!.colour });
          render();
        }),
        colourRow(str('arcade.decorate.panel_colour'), () => look.lowerColour, (v) => change({ lowerColour: v }), true),
        colourRow(str('arcade.decorate.rail'), () => look.rail, (v) => change({ rail: v }), true),
      );
    }
    walls.append(choiceRow(str('arcade.decorate.upper_wall'), UPPER_WALLS, () => look.upper, (v) => {
      change({ upper: v, upperColour: UPPER_WALLS.find((p) => p.id === v)!.colour });
      render();
    }));
    if (upperTinted(look.upper)) walls.append(colourRow(str('arcade.decorate.wall_colour'), () => look.upperColour, (v) => change({ upperColour: v }), true));
    walls.append(choiceRow(str('arcade.decorate.window'), WINDOW_VIEWS, () => look.window, (v) => change({ window: v })));
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
    return neon;
  };
  const SIGN_INKS: Partial<Record<SignStyle, { label: string; start?: string }>> = {
    neon: { label: str('arcade.decorate.tube_colour') },
    ghost: { label: str('arcade.decorate.paint_colour'), start: '#efe6cf' },
    vinyl: { label: str('arcade.decorate.vinyl_colour'), start: '#ffffff' },
  };
  const signCard = (): HTMLElement => {
    const box = card();
    const on = checkRow(str('arcade.decorate.sign'), (v) => { change({ signOn: v }); render(); });
    on.box.checked = look.signOn;
    box.append(on.row);
    if (!look.signOn) return box;
    const why = (st: SignStyle): string | null => {
      const b = signBlocked(st, look.upper);
      return b === 'brick' ? str('arcade.decorate.needs_brick') : b === 'flat' ? str('arcade.decorate.needs_flat') : null;
    };
    box.append(choiceRow(str('arcade.decorate.style'), SIGN_STYLES, () => look.signStyle, (v) => {
      const start = SIGN_INKS[v]?.start;
      change({ signStyle: v, signFont: SIGN_FONTS[v][0], ...(start ? { sign: start } : {}) });
      render();
    }, why, true));
    const fonts = SIGN_FONTS[look.signStyle];
    if (fonts.length > 1) {
      box.append(choiceRow(str('arcade.decorate.font'), fonts.map((f) => ({ id: f, label: FONT_NAMES[f] })), () => look.signFont, (v) => change({ signFont: v }), undefined, true));
    }
    const slider = (label: string, min: number, max: number, step: number, value: number, home: number, format: (v: number) => string, put: (v: number) => void): void => {
      box.append(resetSlider({ label, min, max, step, value, home, format, onInput: put }).row);
    };
    slider(str('arcade.decorate.size'), SIGN_SIZE.min, SIGN_SIZE.max, 0.05, look.signSize, HOUSE_LOOK.signSize, (v) => `${v.toFixed(2)}×`, (v) => change({ signSize: v }));
    slider(str('arcade.decorate.height'), SIGN_HEIGHT.min, SIGN_HEIGHT.max, 0.01, look.signHeight, HOUSE_LOOK.signHeight, (v) => `${v.toFixed(2)} m`, (v) => change({ signHeight: v }));
    slider(str('arcade.decorate.position'), -1, 1, 0.01, look.signPos, 0, (v) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`), (v) => change({ signPos: v }));
    const ink = SIGN_INKS[look.signStyle];
    if (ink) box.append(colourRow(ink.label, () => look.sign, (v) => change({ sign: v }), true));
    switch (look.signStyle) {
      case 'neon': {
        const b = checkRow(str('arcade.decorate.backboard'), (v) => change({ signBackboard: v }));
        b.box.checked = look.signBackboard;
        box.append(b.row);
        break;
      }
      case 'marquee':
        slider(str('arcade.decorate.speed'), 0, SIGN_CHASE.max, 0.05, look.signChase, HOUSE_LOOK.signChase,
          (v) => (v === 0 ? str('arcade.decorate.off') : `${v.toFixed(2)}×`), (v) => change({ signChase: v }));
        break;
      case 'ghost':
        slider(str('arcade.decorate.wear'), 0, 1, 0.01, look.signWear, HOUSE_LOOK.signWear, (v) => `${Math.round(v * 100)}%`, (v) => change({ signWear: v }));
        break;
      case 'gilded':
        box.append(choiceRow(str('arcade.decorate.board'), SIGN_BOARDS, () => look.signBoard, (v) => change({ signBoard: v }), undefined, true));
        break;
      case 'lightbox':
        box.append(colourRow(str('arcade.decorate.face_colour'), () => look.signFace, (v) => change({ signFace: v }), true));
        break;
      case 'matrix': {
        box.append(choiceRow(str('arcade.decorate.led_colour'), SIGN_LEDS, () => look.signLed, (v) => change({ signLed: v }), undefined, true));
        const named = checkRow(str('arcade.decorate.room_name'), (v) => change({ signShowName: v }));
        named.box.checked = look.signShowName;
        box.append(named.row);
        const text = textField({ label: str('arcade.decorate.custom_text'), value: look.signText, maxLength: SIGN_TEXT_MAX });
        text.el.classList.add('decorate-row', 'decorate-dep');
        text.input.addEventListener('input', () => change({ signText: text.input.value }));
        text.input.addEventListener('change', flush);
        box.append(text.el);
        break;
      }
      default:
    }
    return box;
  };
  const signSection = (): HTMLElement[] => [signCard(), neonCard()];
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
  const ceilingCard = (): HTMLElement => {
    const top = card();
    top.append(choiceRow(str('arcade.decorate.type'), CEILINGS, () => look.ceiling, (v) => {
      change({ ceiling: v, ceilingColour: CEILINGS.find((c) => c.id === v)!.colour, wallLights: WALL_FIXTURES[v].on });
      render();
    }));
    if (look.ceiling === 'coffered') {
      top.append(choiceRow(str('arcade.decorate.finish'), CEILING_FINISHES, () => look.ceilingFinish, (v) => {
        change({ ceilingFinish: v, ceilingColour: CEILING_FINISHES.find((c) => c.id === v)!.colour });
        render();
      }));
    }
    top.append(colourRow(str('arcade.decorate.ceiling_colour'), () => look.ceilingColour, (v) => change({ ceilingColour: v }), true));
    return top;
  };
  const lightsCard = (): HTMLElement => {
    const lit = card();
    const wall = checkRow(str('arcade.decorate.wall_lights'), (on) => { change({ wallLights: on }); render(); });
    wall.box.checked = look.wallLights;
    lit.append(wall.row);
    if (look.wallLights) {
      if (WALL_FIXTURES[look.ceiling].fixture === 'sconces') {
        lit.append(
          choiceRow(str('arcade.decorate.shade_colour'), SCONCE_SHADES, () => look.sconceShade, (v) => change({ sconceShade: v })),
          choiceRow(str('arcade.decorate.metal_finish'), SCONCE_METALS, () => look.sconceMetal, (v) => change({ sconceMetal: v })),
        );
      }
      lit.append(choiceRow(str('arcade.decorate.strength'), WALL_LIGHT_STRENGTHS, () => look.wallLightStrength, (v) => change({ wallLightStrength: v })));
    }
    if (look.ceiling === 'coffered') {
      const lamp = checkRow(str('arcade.decorate.chandelier'), (on) => change({ chandelier: on }));
      lamp.box.checked = look.chandelier;
      const glow = resetSlider({
        label: str('arcade.decorate.cove_glow'), min: 0, max: CEILING_GLOW_MAX, step: 0.05, value: look.ceilingGlow, home: HOUSE_LOOK.ceilingGlow,
        format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => change({ ceilingGlow: v }),
      });
      lit.append(lamp.row, glow.row);
    }
    if (look.ceiling === 'beams') {
      const lamps = checkRow(str('arcade.decorate.hanging_lamps'), (on) => change({ ceilingLamps: on }));
      lamps.box.checked = look.ceilingLamps;
      lit.append(lamps.row);
    }
    return lit;
  };
  const SECTIONS: Record<Exclude<View, 'home'>, { title: string; icon: string; build: () => HTMLElement | HTMLElement[] }> = {
    walls: { title: str('arcade.decorate.walls'), icon: UI_ICONS.wall, build: wallsCard },
    carpet: { title: str('arcade.decorate.carpet'), icon: UI_ICONS.floor, build: carpetCard },
    ceiling: { title: str('arcade.decorate.ceiling'), icon: UI_ICONS.ceiling, build: ceilingCard },
    lights: { title: str('arcade.decorate.lights'), icon: UI_ICONS.lamp, build: lightsCard },
    sign: { title: str('arcade.decorate.sign_section'), icon: UI_ICONS.neon, build: signSection },
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
      dock.show([backRow(sec.title, () => go('home', 'out')), ...[sec.build()].flat()], slide);
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
