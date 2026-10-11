import { V20_DEFAULT_DES_KEY, parseDesKey } from '../hw/des';
import { JcmEba, type CcTalkDevice } from '../hw/cctalk';

export type CcTalkPart = 'mech' | 'hopper1' | 'hopper2' | 'note';

export interface PartKeys { readonly des: readonly number[] | null; readonly bnv: readonly number[] | null }

export type CcTalkKeys = Readonly<Record<CcTalkPart, PartKeys>>;

export const KEY_LINES: Readonly<Record<CcTalkPart, { des: string; bnv: string }>> = {
  mech: { des: 'MechDeskey', bnv: 'MechBNVkey' },
  hopper1: { des: 'Hop1Deskey', bnv: 'Hop1BNVkey' },
  hopper2: { des: 'Hop2Deskey', bnv: 'Hop2BNVkey' },
  note: { des: 'BNVDeskey', bnv: 'BNVkey' },
};

export const DEFAULT_CCTALK_KEYS: CcTalkKeys = {
  mech: { des: V20_DEFAULT_DES_KEY, bnv: null },
  hopper1: { des: V20_DEFAULT_DES_KEY, bnv: null },
  hopper2: { des: V20_DEFAULT_DES_KEY, bnv: null },
  note: { des: V20_DEFAULT_DES_KEY, bnv: null },
};

export function gamCcTalkKeys(settings: ReadonlyMap<string, string> | undefined): CcTalkKeys {
  const read = (part: CcTalkPart): PartKeys => {
    const desLine = settings?.get(KEY_LINES[part].des);
    const bnvLine = (settings?.get(KEY_LINES[part].bnv) ?? '').trim();
    return {
      des: desLine === undefined ? V20_DEFAULT_DES_KEY : parseDesKey(desLine),
      bnv: /^\d{6}$/.test(bnvLine) ? [...bnvLine].map(Number) : null,
    };
  };
  return { mech: read('mech'), hopper1: read('hopper1'), hopper2: read('hopper2'), note: read('note') };
}

export function applyPartKeys(dev: CcTalkDevice, keys: PartKeys): void {
  if (dev.des) dev.des.key = keys.des ? [...keys.des] : null;
  if (!keys.bnv) return;
  if (dev instanceof JcmEba) dev.setStoredKey(keys.bnv);
  else if ('bnvKey' in dev) (dev as { bnvKey: number[] }).bnvKey = [...keys.bnv];
}
