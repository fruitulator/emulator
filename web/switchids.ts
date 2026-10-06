import type { NamedInput } from './inputs';
import type { SwitchControl } from '../src/layout/fmlconfig';
import type { MachineInfo } from './emu-protocol';
import { str } from './i18n';

const GENERIC: Record<SwitchControl, { label: string; toggle: boolean }> = {
  Cash: { label: str('switchids.cashbox_door'), toggle: true },
  Service: { label: str('switchids.service_door'), toggle: true },
  Refill: { label: str('switchids.refill_key'), toggle: true },
  Test: { label: str('switchids.test_button'), toggle: false },
  'Test 2': { label: str('switchids.test_button_2'), toggle: false },
  'Top Up': { label: str('switchids.top_up_key'), toggle: true },
};

const ORDER: SwitchControl[] = ['Refill', 'Cash', 'Service', 'Test', 'Test 2', 'Top Up'];

export function namedInputId(n: NamedInput): number {
  return n.strobe * 8 + n.bit;
}

export function layoutNamedInputs(
  platform: readonly NamedInput[],
  ids: Partial<Record<SwitchControl, number>>,
): NamedInput[] {
  const seen = new Set<SwitchControl>();
  const out: NamedInput[] = platform.map((n) => {
    if (!n.control) return { ...n };
    const id = ids[n.control];
    seen.add(n.control);
    if (id === undefined) return { ...n };
    return { ...n, strobe: id >> 3, bit: id & 7 };
  });
  for (const control of ORDER) {
    const id = ids[control];
    if (id === undefined || seen.has(control)) continue;
    const g = GENERIC[control];
    out.push({ label: g.label, strobe: id >> 3, bit: id & 7, control, ...(g.toggle ? { toggle: true } : {}) });
  }
  return out;
}

const TEST_CONTROLS: readonly SwitchControl[] = ['Test', 'Test 2'];

export function testRowsForPanel(
  platform: readonly NamedInput[],
  ids: Partial<Record<SwitchControl, number>>,
  panelIds: Iterable<number>,
): NamedInput[] {
  const have = new Set(panelIds);
  const out: NamedInput[] = [];
  for (const n of layoutNamedInputs(platform, ids)) {
    if (!n.control || !TEST_CONTROLS.includes(n.control)) continue;
    const id = namedInputId(n);
    if (have.has(id)) continue;
    have.add(id);
    out.push(n);
  }
  return out;
}

export function testLabelsForPanel(
  platform: readonly NamedInput[],
  ids: Partial<Record<SwitchControl, number>>,
  panel: readonly { id: number; label: string }[],
): Map<number, string> {
  const out = new Map<number, string>();
  for (const n of layoutNamedInputs(platform, ids)) {
    if (!n.control || !TEST_CONTROLS.includes(n.control)) continue;
    const id = namedInputId(n);
    const row = panel.find((s) => s.id === id);
    if (!row || out.has(id)) continue;
    const text = row.label.trim();
    if (text === String(id) || text === `Switch ${id}`) out.set(id, GENERIC[n.control].label);
  }
  return out;
}

export function hasOperatedSwitches(info: Pick<MachineInfo, 'switchPanel'>): boolean {
  return info.switchPanel.some((s) => !s.option);
}
