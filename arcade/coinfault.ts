import type { CashLedger } from '../src/machine/machine';
import type { MachineInfo } from '../web/emu-protocol';
import type { PaidOutput } from './serverwire';
import { str } from '../web/i18n';

export const COIN_SETUP_FAULT_TEXT = str('arcade.coinfault.player');
export const COIN_SETUP_FAULT_HOST_TEXT = str('arcade.coinfault.host');
export const FREE_PLAY_TEXT = str('arcade.coinfault.free_play');

export function paidUnpriced(a: CashLedger | null, b: CashLedger | null): boolean {
  if (!a || !b) return false;
  return b.unpricedOut !== a.unpricedOut || b.unpricedTokenOut !== a.unpricedTokenOut;
}

export function paidOutputs(lines: readonly number[], info: Pick<MachineInfo, 'payoutDevices'> | null | undefined): PaidOutput[] {
  return lines.map((line) => {
    const d = info?.payoutDevices?.find((x) => x.line === line);
    return d ? { line, kind: d.kind, n: d.displayNumber ?? line + 1 } : { line, kind: 'tube', n: line + 1 };
  });
}

export function outputName(o: PaidOutput): string {
  return `${payoutKindLabel(o.kind)} ${o.n}`;
}

export function payoutKindLabel(kind: PaidOutput['kind']): string {
  switch (kind) {
    case 'tube': return str('arcade.wizard.tube');
    case 'token-tube': return str('arcade.wizard.token_tube');
    case 'hopper': return str('arcade.wizard.hopper');
    case 'token-hopper': return str('arcade.wizard.token_hopper');
  }
}
