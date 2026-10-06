import { str } from './i18n';

export type SwitchGroup = 'debug' | 'mode';

export type SwitchId =
  | 'diag' | 'bulbs' | 'bench'
  | 'wasm' | 'worker' | 'regions' | 'dirty' | 'smooth' | 'audio' | 'benchStep';

export interface AppSwitch {
  id: SwitchId;
  group: SwitchGroup;
  label: string;
  fallback: boolean;
  surfaced: boolean;
  applies: 'now' | 'reload';
  fromUrl(params: URLSearchParams): boolean | undefined;
}

const zeroOne = (name: string) => (p: URLSearchParams): boolean | undefined => {
  const v = p.get(name);
  return v === '0' ? false : v === '1' ? true : undefined;
};

const offByZero = (name: string) => (p: URLSearchParams): boolean | undefined =>
  (p.get(name) === '0' ? false : undefined);

const onByPresence = (name: string) => (p: URLSearchParams): boolean | undefined =>
  (p.has(name) ? true : undefined);

export const SWITCHES: readonly AppSwitch[] = [
  {
    id: 'diag',
    group: 'debug',
    label: str('settings.diagnostics_log'),
    fallback: false,
    surfaced: true,
    applies: 'now',
    fromUrl: zeroOne('diag'),
  },
  {
    id: 'bulbs',
    group: 'debug',
    label: str('settings.bulb_lab'),
    fallback: false,
    surfaced: false,
    applies: 'now',
    fromUrl: onByPresence('bulbs'),
  },
  {
    id: 'bench',
    group: 'debug',
    label: str('settings.frame_timings'),
    fallback: false,
    surfaced: false,
    applies: 'reload',
    fromUrl: onByPresence('bench'),
  },
  {
    id: 'wasm',
    group: 'mode',
    label: str('settings.webassembly_cpu_core'),
    fallback: true,
    surfaced: false,
    applies: 'reload',
    fromUrl: zeroOne('wasm'),
  },
  {
    id: 'worker',
    group: 'mode',
    label: str('settings.run_in_a_worker'),
    fallback: true,
    surfaced: false,
    applies: 'reload',
    fromUrl: offByZero('worker'),
  },
  {
    id: 'regions',
    group: 'mode',
    label: str('settings.rom_region_compiler'),
    fallback: true,
    surfaced: false,
    applies: 'reload',
    fromUrl: offByZero('regions'),
  },
  {
    id: 'dirty',
    group: 'mode',
    label: str('settings.repaint_only_what_changed'),
    fallback: true,
    surfaced: false,
    applies: 'now',
    fromUrl: offByZero('dirty'),
  },
  {
    id: 'smooth',
    group: 'mode',
    label: str('settings.smooth_small_views'),
    fallback: true,
    surfaced: false,
    applies: 'reload',
    fromUrl: offByZero('smooth'),
  },
  {
    id: 'audio',
    group: 'mode',
    label: str('settings.sound_chip_emulation'),
    fallback: true,
    surfaced: false,
    applies: 'reload',
    fromUrl: offByZero('audio'),
  },
  {
    id: 'benchStep',
    group: 'mode',
    label: str('settings.whole_frame_stepping'),
    fallback: true,
    surfaced: false,
    applies: 'reload',
    fromUrl: (p) => (p.get('bench') === 'step' ? false : undefined),
  },
];

const BY_ID = new Map(SWITCHES.map((s) => [s.id, s]));

function def(id: SwitchId): AppSwitch {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`no such switch: ${id}`);
  return s;
}

const slot = (id: SwitchId): string => `fruitulator:switch:${id}`;

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function params(): URLSearchParams {
  return new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
}

export function storedValue(id: SwitchId): boolean {
  if (!def(id).surfaced) return def(id).fallback;
  const raw = store()?.getItem(slot(id));
  return raw === '1' ? true : raw === '0' ? false : def(id).fallback;
}

export function urlValue(id: SwitchId): boolean | undefined {
  return def(id).fromUrl(params());
}

export function liveValue(id: SwitchId): boolean {
  return urlValue(id) ?? storedValue(id);
}

for (const s of SWITCHES) {
  if (s.surfaced) continue;
  try { store()?.removeItem(slot(s.id)); } catch {  }
}

const AT_BOOT = new Map<SwitchId, boolean>(SWITCHES.map((s) => [s.id, liveValue(s.id)]));

export function bootValue(id: SwitchId): boolean {
  return AT_BOOT.get(id) ?? def(id).fallback;
}

export function setSwitch(id: SwitchId, on: boolean): boolean {
  if (!def(id).surfaced || urlValue(id) !== undefined) return false;
  try {
    if (on === def(id).fallback) store()?.removeItem(slot(id));
    else store()?.setItem(slot(id), on ? '1' : '0');
  } catch {
  }
  return true;
}

export function wasmOption(): boolean | undefined {
  if (params().get('wasm') === '1') return true;
  return bootValue('wasm') ? undefined : false;
}
