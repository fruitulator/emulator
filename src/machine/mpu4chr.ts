import type { CharacteriserTable } from '../hw/characteriser';
import type { Mpu4CharacteriserConfig } from '../layout/fmlconfig';

export interface Mpu4CharacteriserChoice {
  table: CharacteriserTable | null;
  source: 'layout' | 'none';
  type: string;
  modelled: boolean;
}

export function mpu4CharacteriserFor(
  declared: Mpu4CharacteriserConfig | null,
): Mpu4CharacteriserChoice {
  const type = declared?.type ?? 'Barcrest';
  if (type === 'BWB') return { table: null, source: 'layout', type, modelled: true };
  if (type !== 'Barcrest' || !declared?.lamps) {
    return { table: null, source: 'none', type, modelled: type === 'Barcrest' };
  }
  return {
    table: { name: 'layout (Barcrest)', lamps: declared.lamps },
    source: 'layout',
    type,
    modelled: true,
  };
}
