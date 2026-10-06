import type { Machine } from './machine';
import { declaredDisplays, declaredBankDigits, declaredLedLamps } from './layoutdisplay';
import { declaredReels } from './layoutreels';
import type { ReelFit } from './reelfit';
import { declaredCoins, COIN_NOTE_BLANK } from './layoutcoins';
import { decodedLayout, effectGrid } from '../layout/fmlconfig';
import { EFFECT_SAMPLES, samplesForStored } from './effects';

export type UnservedAxis =
  | 'display' | 'panel' | 'reel' | 'lamp' | 'digit' | 'peripheral' | 'video' | 'sound';

export interface UnservedComponent {
  axis: UnservedAxis;
  component: string;
  type: number | string;
  reason: string;
  rect: { left: number; top: number; width: number; height: number } | null;
}

export function unservedDisplays(
  m: Machine, layout: Uint8Array | undefined, system: string,
): UnservedComponent[] {
  const declared = declaredDisplays(layout);
  if (!declared.length || m.display) return [];
  return declared.map((d) => ({
    axis: 'display' as const,
    component: d.component,
    type: d.type,
    reason: `this cabinet draws ${/^[AEIOU]/i.test(d.component) ? 'an' : 'a'}`
      + ` ${d.component} message display, and the`
      + ` ${system} board here does not drive one of that kind - so it is`
      + ` drawn struck out rather than blank. Everything else on the machine`
      + ` still runs.`,
    rect: d.rect,
  }));
}

export function unservedReels(
  m: Machine, layout: Uint8Array | undefined, system: string,
): UnservedComponent[] {
  const fit = (m as unknown as { reelFit?: ReelFit }).reelFit;
  const declared = declaredReels(layout);
  const out: UnservedComponent[] = [];
  if (!fit || !fit.beyond.length) return out;
  out.push(...fit.beyond.map((channel) => {
    const d = declared.find((r) => r.number === channel);
    return {
      axis: 'reel' as const,
      component: d?.component ?? 'Reel',
      type: d?.type ?? 0x03,
      reason: `this cabinet fits a reel on drive channel ${channel}, and the`
        + ` ${system} board here decodes only ${fit.channels} channel`
        + `${fit.channels === 1 ? '' : 's'} - so that reel is drawn struck out`
        + ` rather than left standing still with no explanation. Everything`
        + ` else on the machine still runs.`,
      rect: d?.rect ?? null,
    };
  }));
  return out;
}

export function unservedDigits(
  layout: Uint8Array | undefined, system: string, hasDigitBank: boolean,
): UnservedComponent[] {
  if (hasDigitBank) return [];
  const declared = declaredBankDigits(layout);
  return declared.map((d) => ({
    axis: 'digit' as const,
    component: d.component,
    type: d.type,
    reason: `this cabinet draws ${declared.length} seven-segment digit${declared.length === 1 ? '' : 's'}`
      + ` lit from a digit bank, and the ${system} board here has no digit`
      + ` bank modelled - so they are drawn struck out rather than dark.`
      + ` Everything else on the machine still runs.`,
    rect: d.rect,
  }));
}

export function unservedComponents(
  m: Machine, layout: Uint8Array | undefined, system: string, hasDigitBank = true,
): UnservedComponent[] {
  if (!layout || layout.length === 0) return [];
  return [
    ...unservedDisplays(m, layout, system),
    ...unservedDigits(layout, system, hasDigitBank),
    ...unservedReels(m, layout, system),
    ...unservedCoins(layout, system),
    ...unservedLedLamps(m, layout, system),
    ...unservedEffects(m, layout, system),
  ];
}

export function unservedLedLamps(
  m: Machine, layout: Uint8Array | undefined, system: string,
): UnservedComponent[] {
  const driven = ((m as unknown as { ledOutputs?: Uint8Array }).ledOutputs?.length ?? 0) * 8;
  const lamps = declaredLedLamps(layout)
    .filter((d) => d.leds.some((n) => n >= driven));
  if (!lamps.length) return [];
  const leds = [...new Set(lamps.flatMap((d) => d.leds.filter((n) => n >= driven)))].sort((a, b) => a - b);
  const shown = leds.length > 8 ? `${leds.slice(0, 8).join(', ')} …` : leds.join(', ');
  return [{
    axis: 'lamp',
    component: 'Lamp (LED)',
    type: 0x04,
    reason: `${lamps.length} lamp${lamps.length === 1 ? ' is' : 's are'} wired to LED`
      + ` output${leds.length === 1 ? '' : 's'} ${shown}, which the ${system} board here does`
      + ` not drive - so ${lamps.length === 1 ? 'it is' : 'they are'} lit from the lamp`
      + ` of the same number instead, which may not match. Everything else on the`
      + ` machine still runs.`,
    rect: null,
  }];
}

export function unservedCoins(
  layout: Uint8Array | undefined, system: string,
): UnservedComponent[] {
  const out: UnservedComponent[] = [];
  for (const c of declaredCoins(layout)) {
    if (c.note === null || c.note === COIN_NOTE_BLANK || c.named !== null) continue;
    out.push({
      axis: 'peripheral',
      component: `CoinNoteId ${c.note}`,
      type: c.note,
      reason: `this cabinet declares coin/note id ${c.note}, which is not in`
        + ` MFME's own coin list as we have it - so we cannot say what the`
        + ` slot takes and it drops the ${system} default coin. Everything`
        + ` else on the machine still runs.`,
      rect: c.rect,
    });
  }
  return out;
}

export function unservedEffects(
  m: Machine, layout: Uint8Array | undefined, system: string,
): UnservedComponent[] {
  const b = m as unknown as { triacLevels?: unknown; meterLevels?: unknown };
  const triacsKnown = typeof b.triacLevels === 'number';
  const metersKnown = typeof b.meterLevels === 'number';
  if (triacsKnown && metersKnown) return [];
  const payload = decodedLayout(layout);
  if (!payload) return [];
  const out: UnservedComponent[] = [];
  const rows = triacsKnown ? [] : effectGrid(payload, system, 'Triac Effects') ?? [];
  const lines = rows
    .map((r, i) => (samplesForStored(r.on).some((s) => EFFECT_SAMPLES[s].loop) ? i + 1 : 0))
    .filter((n) => n > 0);
  if (lines.length) {
    out.push({
      axis: 'sound',
      component: 'Triac Effects',
      type: 'loop',
      reason: `this cabinet plays a held sound on triac line${lines.length === 1 ? '' : 's'}`
        + ` ${lines.join(', ')}, which lasts as long as the line is on - and the`
        + ` ${system} board here does not report when its triac lines are on,`
        + ` so ${lines.length === 1 ? 'that sound is' : 'those sounds are'} not played.`
        + ` Everything else on the machine still runs.`,
      rect: null,
    });
  }
  const meterRows = metersKnown ? [] : effectGrid(payload, system, 'Meter Effects') ?? [];
  const offs = meterRows
    .map((r, i) => (samplesForStored(r.off).length ? i + 1 : 0))
    .filter((n) => n > 0);
  if (offs.length) {
    out.push({
      axis: 'sound',
      component: 'Meter Effects',
      type: 'off',
      reason: `this cabinet plays a sound when meter${offs.length === 1 ? '' : 's'}`
        + ` ${offs.join(', ')} ${offs.length === 1 ? 'stops' : 'stop'} - and the`
        + ` ${system} board here does not report when its meters stop,`
        + ` so ${offs.length === 1 ? 'that sound is' : 'those sounds are'} not played.`
        + ` Everything else on the machine still runs.`,
      rect: null,
    });
  }
  return out;
}
