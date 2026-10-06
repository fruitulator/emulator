import {
  decodedLayout, dipSwitchLabelsFrom, effectGrid, fileLevelTags, fittedPeripheralsFrom,
  gameConfigControls, layoutSwitchIdsFrom, readSetting, recordTagReads, type Control,
} from './fmlconfig';
import { effectsMask } from '../machine/effects';
import type { Game } from '../machine/registry';

export interface UnreadSetting {
  from: 'layout' | 'gam';
  label: string;
  value?: string;
}

const GAM_NOT_REPORTED = new Set([
  'rating', 'tags', 'wip', 'lotech', 'played', 'hidden', 'loadmode', 'displayposition',
  'croppedposition', 'mastervolume', 'totalin', 'totalout', 'setpercent', 'linktype',
  'game', 'version', 'name',
]);

const GAM_KEY = /^[A-Za-z][A-Za-z0-9]{0,23}$/;
const GAM_NUMBER = /^-?\d{1,9}(\.\d{1,4})?$/;

const u32 = (b: Uint8Array, at = 0): number =>
  ((b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0);

export function statedValue(c: Readonly<Control>, raw: Uint8Array): { value?: string; nonDefault: boolean } | null {
  if (c.storage !== 'fml' || (c as { readOnly?: boolean }).readOnly || c.kind === 'text') return null;
  const off = c.byteOffset ?? 0;
  if (c.kind === 'checkbox' && c.byteIndex != null && c.mask != null) {
    const on = ((raw[c.byteIndex] ?? 0) & c.mask) !== 0;
    return { value: on ? 'on' : 'off', nonDefault: on !== !!c.inverted };
  }
  if (/grid|record-list|table|dip-banks/.test(c.kind)) {
    return { nonDefault: raw.some((b) => b !== 0) };
  }
  if (raw.length < off + 4) return { nonDefault: raw.some((b) => b !== 0) };
  const n = u32(raw, off);
  if (c.kind === 'switch-number') {
    return n === 255 ? { value: 'unassigned', nonDefault: false } : { value: `switch ${n | 0}`, nonDefault: true };
  }
  if (c.values) {
    const at = (i: number) => (raw.length >= off + 4 * i + 4 ? u32(raw, off + 4 * i) : -1);
    const entries = Object.entries(c.values);
    const hit = entries.find(([, v]) => (Array.isArray(v) ? v.every((x, i) => at(i) === x) : v === n));
    const first = entries[0]?.[1];
    const isFirst = hit ? hit[1] === first : false;
    if (hit) return { value: hit[0], nonDefault: Array.isArray(first) ? !isFirst : n !== 0 };
    return { value: `option ${n}`, nonDefault: n !== 0 };
  }
  return { value: String(n | 0), nonDefault: n !== 0 };
}

export function pageSideReads(game: Game): void {
  const payload = decodedLayout(game.layout);
  if (payload) {
    readSetting(payload, game.system, 'Cabinet Style');
    effectGrid(payload, game.system, 'Triac Effects');
    effectGrid(payload, game.system, 'Meter Effects');
  }
  layoutSwitchIdsFrom(game.layout, game.system);
  fittedPeripheralsFrom(game.layout, game.system);
  dipSwitchLabelsFrom(game.layout);
  effectsMask(game.gam?.settings);
}

export interface SettingReadWatch {
  finish(): UnreadSetting[];
}

export function watchSettingReads(game: Game): SettingReadWatch {
  const tagReads = new Set<number>();
  const gamReads = new Set<string>();
  const s = game.gam?.settings as (Map<string, string> & { get: Map<string, string>['get']; has: Map<string, string>['has'] }) | undefined;
  const hadOwnGet = !!s && Object.prototype.hasOwnProperty.call(s, 'get');
  const hadOwnHas = !!s && Object.prototype.hasOwnProperty.call(s, 'has');
  if (s && !hadOwnGet && !hadOwnHas) {
    const og = s.get; const oh = s.has;
    s.get = function get(k: string) { gamReads.add(String(k).toLowerCase()); return og.call(this, k); };
    s.has = function has(k: string) { gamReads.add(String(k).toLowerCase()); return oh.call(this, k); };
  }
  recordTagReads((t) => tagReads.add(t));
  let done: UnreadSetting[] | null = null;
  return {
    finish(): UnreadSetting[] {
      if (done) return done;
      try {
        pageSideReads(game);
      } catch {
      } finally {
        recordTagReads(null);
        if (s && !hadOwnGet && !hadOwnHas) {
          delete (s as { get?: unknown }).get;
          delete (s as { has?: unknown }).has;
        }
      }
      done = unreadSettings(game, tagReads, gamReads);
      return done;
    },
  };
}

export function unreadSettings(game: Game, tagReads: ReadonlySet<number>, gamReads: ReadonlySet<string>): UnreadSetting[] {
  const out: UnreadSetting[] = [];
  const payload = decodedLayout(game.layout);
  const controls = gameConfigControls(game.system);
  if (payload && controls) {
    const tags = fileLevelTags(payload);
    for (const [label, c] of Object.entries(controls)) {
      const t = Number(c.tag ?? c.tags?.[0]);
      if (!Number.isFinite(t)) continue;
      const raw = tags.get(t);
      if (!raw || tagReads.has(t)) continue;
      const st = statedValue(c, raw);
      if (!st?.nonDefault) continue;
      out.push({ from: 'layout', label, ...(st.value !== undefined ? { value: st.value } : {}) });
    }
  }
  const settings = game.gam?.settings;
  if (settings) {
    for (const [k, v] of settings) {
      const lk = k.toLowerCase();
      if (gamReads.has(lk) || GAM_NOT_REPORTED.has(lk) || !GAM_KEY.test(k)) continue;
      const value = String(v).trim();
      out.push({ from: 'gam', label: k, ...(GAM_NUMBER.test(value) ? { value } : {}) });
    }
  }
  return out;
}

export function unreadSettingLine(u: UnreadSetting): string {
  return u.from === 'layout'
    ? `unread setting · ${u.label}${u.value !== undefined ? ` = ${u.value}` : ''} (layout)`
    : `unread line · ${u.label}${u.value !== undefined ? ` ${u.value}` : ''} (.gam)`;
}
