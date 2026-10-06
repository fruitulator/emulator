
export interface GamReel {
  position: number;
  complement: number;
}

export interface GamSecCounter {
  label: string;
  value: number;
}

export interface Gam {
  system: string;
  roms: string[];
  sound: string[];
  slaveRoms: string[];
  vidRoms: string[];
  layout?: string;
  dips: Map<number, string>;
  reels: GamReel[];
  sec: GamSecCounter[];
  instances: string[];
  settings: Map<string, string>;
}

class SettingsMap extends Map<string, string> {
  private readonly folded = new Map<string, string>();

  override set(key: string, value: string): this {
    const lower = key.toLowerCase();
    const existing = this.folded.get(lower);
    if (existing !== undefined) return super.set(existing, value);
    this.folded.set(lower, key);
    return super.set(key, value);
  }

  override get(key: string): string | undefined {
    return super.get(this.folded.get(key.toLowerCase()) ?? key);
  }

  override has(key: string): boolean {
    return super.has(this.folded.get(key.toLowerCase()) ?? key);
  }
}

export function newSettings(): Map<string, string> {
  return new SettingsMap();
}

export function parseGam(text: string): Gam {
  const gam: Gam = {
    system: '',
    roms: [],
    sound: [],
    slaveRoms: [],
    vidRoms: [],
    instances: [],
    dips: new Map(),
    reels: [],
    sec: [],
    settings: newSettings(),
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sp = line.search(/\s/);
    const key = sp < 0 ? line : line.slice(0, sp);
    const val = sp < 0 ? '' : line.slice(sp + 1).trim();
    switch (key.toLowerCase()) {
      case 'system': gam.system = val.toUpperCase(); break;
      case 'rom': gam.roms.push(val); break;
      case 'sound': gam.sound.push(val); break;
      case 'dotrom': case 'slaverom': gam.slaveRoms.push(val); break;
      case 'vidrom': gam.vidRoms.push(val); break;
      case 'layout': gam.layout = val; break;
      case 'instance': {
        const m = /^"([^"]*)"/.exec(val);
        if (m && m[1]) gam.instances.push(m[1]);
        break;
      }
      case 'dip': {
        const m = /^(\d+)\s+(\S+)$/.exec(val);
        if (m) gam.dips.set(Number(m[1]), m[2]);
        break;
      }
      case 'reel': {
        const m = /^(\d+)\s+(\d+)\s+(\d+)$/.exec(val);
        if (m) {
          const n = Number(m[1]) - 1;
          if (n >= 0 && n < 16) {
            while (gam.reels.length < n) gam.reels.push({ position: 0, complement: 0 });
            gam.reels[n] = { position: Number(m[2]), complement: Number(m[3]) };
          }
        }
        break;
      }
      default: {
        const sec = /^sec(\d+)$/i.exec(key);
        const m = sec ? /^"([^"]*)"\s+(-?\d+)$/.exec(val) : null;
        if (sec && m) {
          const n = Number(sec[1]) - 1;
          if (n >= 0 && n < 32) {
            while (gam.sec.length < n) gam.sec.push({ label: '', value: 0 });
            gam.sec[n] = { label: m[1].trim(), value: Number(m[2]) };
          }
          break;
        }
        gam.settings.set(key, val);
        break;
      }
    }
  }
  return gam;
}

export const GAM_JSON_VERSION = 1;

export interface GamJson {
  v: number;
  system: string;
  roms: string[];
  sound: string[];
  slaveRoms: string[];
  vidRoms?: string[];
  layout?: string;
  dips: [number, string][];
  reels: GamReel[];
  sec: GamSecCounter[];
  instances: string[];
  settings: [string, string][];
}

export function gamToJson(gam: Gam): GamJson {
  return {
    v: GAM_JSON_VERSION,
    system: gam.system,
    roms: [...gam.roms],
    sound: [...gam.sound],
    slaveRoms: [...gam.slaveRoms],
    vidRoms: [...gam.vidRoms],
    ...(gam.layout !== undefined ? { layout: gam.layout } : {}),
    dips: [...gam.dips],
    reels: gam.reels.map((r) => ({ ...r })),
    sec: gam.sec.map((c) => ({ ...c })),
    instances: [...gam.instances],
    settings: [...gam.settings],
  };
}

export function gamFromJson(j: GamJson): Gam {
  if (typeof j.v !== 'number' || j.v > GAM_JSON_VERSION) {
    throw new Error(`manifest JSON v${String(j.v)} is newer than this build reads (v${GAM_JSON_VERSION})`);
  }
  const settings = newSettings();
  for (const [key, value] of j.settings) settings.set(key, value);
  return {
    system: j.system,
    roms: [...j.roms],
    sound: [...j.sound],
    slaveRoms: [...j.slaveRoms],
    vidRoms: [...(j.vidRoms ?? [])],
    ...(j.layout !== undefined ? { layout: j.layout } : {}),
    dips: new Map(j.dips),
    reels: j.reels.map((r) => ({ ...r })),
    sec: j.sec.map((c) => ({ ...c })),
    instances: [...j.instances],
    settings,
  };
}
