import { decryptFml, isEncryptedFml } from '../layout/fml';
import { parseLayout } from '../layout/fmlparse';
import { datCheckboxes, datCheckboxesFromDfm } from '../layout/datreels';
import type { CabinetSwitch } from './machine';

export interface LayoutSwitch {
  number: number;
  label: string;
  closed: boolean;
}

const CHECKBOX_COMPONENT = 0x14;

export function layoutSwitches(layout: Uint8Array | undefined): LayoutSwitch[] {
  if (!layout || layout.length === 0) return [];
  const dat = datCheckboxes(layout);
  if (dat.length) return sortSwitches(dat);
  let payload: Uint8Array;
  try {
    payload = isEncryptedFml(layout) ? decryptFml(layout) : layout;
  } catch {
    return [];
  }
  return layoutSwitchesFromPayload(payload);
}

export function layoutSwitchesFromPayload(payload: Uint8Array): LayoutSwitch[] {
  if (isDfm(payload)) return sortSwitches(datCheckboxesFromDfm(payload));
  let comps;
  try {
    comps = parseLayout(payload);
  } catch {
    return [];
  }
  const out: LayoutSwitch[] = [];
  for (const c of comps) {
    if (c.type !== CHECKBOX_COMPONENT || c.number < 0) continue;
    out.push({
      number: c.number,
      label: c.texts.get('Label') ?? '',
      closed: !!c.values.get('Checked'),
    });
  }
  return sortSwitches(out);
}

function sortSwitches(out: LayoutSwitch[]): LayoutSwitch[] {
  return out.sort((a, b) => a.number - b.number);
}

function isDfm(payload: Uint8Array): boolean {
  const n = Math.min(payload.length - 4, 8192);
  for (let i = 0; i < n; i++) {
    if (payload[i] === 0x54 && payload[i + 1] === 0x50 && payload[i + 2] === 0x46 && payload[i + 3] === 0x30) {
      return true;
    }
  }
  return false;
}

export function layoutPanelRows(
  list: readonly LayoutSwitch[],
  level: (id: number) => boolean,
  extra: Partial<Omit<CabinetSwitch, 'id' | 'label' | 'on'>> = {},
): CabinetSwitch[] {
  const seen = new Set<number>();
  const drawn: { number: number; label: string }[] = [];
  for (const s of list) {
    if (seen.has(s.number)) continue;
    seen.add(s.number);
    const text = s.label.replace(/\s+/g, ' ').trim();
    drawn.push({ number: s.number, label: /^\d*$/.test(text) ? '' : text });
  }
  const repeats = new Map<string, number>();
  for (const s of drawn) if (s.label) repeats.set(s.label, (repeats.get(s.label) ?? 0) + 1);
  const nth = new Map<string, number>();
  return drawn.map((s) => {
    const n = (nth.get(s.label) ?? 0) + 1;
    nth.set(s.label, n);
    const label = !s.label ? `Switch ${s.number}`
      : repeats.get(s.label)! > 1 ? `${s.label} ${n}` : s.label;
    return { id: s.number, label, on: level(s.number), ...extra };
  });
}
