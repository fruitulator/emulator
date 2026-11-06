import type { CashLedger } from '../src/machine/machine';
import type { MachineInfo } from '../web/emu-protocol';
import type { MachineMoney, PaidOutput } from './serverwire';
import { coinStepKey, type DocMachine, type MachineConfig } from './doc';
import { payoutsAnswered } from '../web/coinask';
import { str } from '../web/i18n';

export const COIN_SETUP_FAULT_TEXT = str('arcade.coinfault.player');
export const COIN_SETUP_FAULT_HOST_TEXT = str('arcade.coinfault.host');
export const PAYOUTS_UNSET_HOST_TEXT = str('arcade.coinfault.payouts_unset_host');
export const FREE_PLAY_TEXT = str('arcade.coinfault.free_play');

export function freePlayOn(
  info: Pick<MachineInfo, 'meterOnlyPayout'> | null | undefined,
  config: Pick<MachineConfig, 'freePlay'> | null | undefined,
): boolean {
  if (config?.freePlay !== undefined) return config.freePlay === true;
  return info?.meterOnlyPayout === true;
}

export type PayoutsUnsetInfo = Pick<MachineInfo, 'unpricedPayouts' | 'tokenPayouts' | 'cashPayouts' | 'payoutDevices' | 'payoutRows'>;

export function payoutsUnsetFor(
  info: PayoutsUnsetInfo | null | undefined,
  config: Pick<MachineConfig, 'payouts' | 'notPayouts'> | null | undefined,
): boolean {
  return !!info?.unpricedPayouts?.length && !payoutsAnswered(info, config?.payouts, info.unpricedPayouts, config?.notPayouts);
}

export function hostPayoutsUnset(
  m: Pick<DocMachine, 'contentHash' | 'config' | 'coinStep' | 'build'>,
  record: Pick<MachineMoney, 'payoutsUnset'> | null | undefined,
  system: string | undefined | null,
): boolean {
  const c = m.coinStep;
  if (c && system && c.key === coinStepKey(m, m.build?.id, system)) return payoutsUnsetFor(c.info, m.config);
  return record?.payoutsUnset !== undefined;
}

export function paidUnpriced(a: CashLedger | null, b: CashLedger | null): boolean {
  if (!a || !b) return false;
  return b.unpricedOut !== a.unpricedOut || b.unpricedTokenOut !== a.unpricedTokenOut;
}

export function paidOutputs(lines: readonly number[], info: Pick<MachineInfo, 'payoutDevices' | 'payoutRows'> | null | undefined): PaidOutput[] {
  return lines.map((line) => {
    const d = info?.payoutDevices?.find((x) => x.line === line);
    if (d) return { line, kind: d.kind, n: d.displayNumber ?? line + 1 };
    const r = info?.payoutRows?.find((x) => x.kind === 'output' && x.line === line);
    if (r) return { line, kind: 'output', n: r.displayNumber ?? line + 1 };
    return { line, kind: 'tube', n: line + 1 };
  });
}

export function outputName(o: PaidOutput): string {
  if (o.kind === 'output') return str('arcade.wizard.output_n', { 0: o.n });
  return `${payoutKindLabel(o.kind)} ${o.n}`;
}

export function payoutKindLabel(kind: Exclude<PaidOutput['kind'], 'output'>): string {
  switch (kind) {
    case 'tube': return str('arcade.wizard.tube');
    case 'token-tube': return str('arcade.wizard.token_tube');
    case 'hopper': return str('arcade.wizard.hopper');
    case 'token-hopper': return str('arcade.wizard.token_hopper');
  }
}
