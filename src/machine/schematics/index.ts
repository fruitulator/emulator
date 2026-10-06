import type { Schematic } from '../schematic';
import { MPU5_SCHEMATIC } from './mpu5';
import { SC5_SCHEMATIC } from './sc5';
import { SC4_SCHEMATIC } from './sc4';
import { SC2_SCHEMATIC } from './sc2';
import { MPU4_SCHEMATIC } from './mpu4';
import { IMPACT_SCHEMATIC } from './impact';
import { M1AB_SCHEMATIC } from './m1ab';
import { ACESP_SCHEMATIC } from './acesp';
import { EPOCH_SCHEMATIC } from './epoch';
import { SC1_SCHEMATIC } from './sc1';
import { SYS5_SCHEMATIC } from './sys5';
import { SYS85_SCHEMATIC } from './sys85';
import { MPS2_SCHEMATIC } from './mps2';
import { SYS80_SCHEMATIC } from './sys80';
import { SRU_SCHEMATIC } from './sru';
import { ASTRA_SCHEMATIC } from './astra';
import { SYS1_SCHEMATIC } from './sys1';
import { PROCONN_SCHEMATIC } from './proconn';
import { ELECTROCOIN_SCHEMATIC } from './electrocoin';
import { PHOENIX_SCHEMATIC } from './phoenix';
import { BLACKBOX_SCHEMATIC } from './blackbox';
import { MPU3_SCHEMATIC } from './mpu3';
import { MPU4VIDEO_SCHEMATIC } from './mpu4video';

const BY_SYSTEM: Record<string, Schematic> = {
  MPU5: MPU5_SCHEMATIC,
  SCORPION5: SC5_SCHEMATIC,
  ADDER5: SC5_SCHEMATIC,
  SCORPION4: SC4_SCHEMATIC,
  SCORPION2: SC2_SCHEMATIC,
  MPU4: MPU4_SCHEMATIC,
  IMPACT: IMPACT_SCHEMATIC,
  M1AB: M1AB_SCHEMATIC,
  SPACE: ACESP_SCHEMATIC,
  EPOCH: EPOCH_SCHEMATIC,
  SCORPION1: SC1_SCHEMATIC,
  SYS5: SYS5_SCHEMATIC,
  SYS85: SYS85_SCHEMATIC,
  MPS2: MPS2_SCHEMATIC,
  SYSTEM80: SYS80_SCHEMATIC,
  SRU: SRU_SCHEMATIC,
  ASTRASYSA1: ASTRA_SCHEMATIC,
  SYS1: SYS1_SCHEMATIC,
  PROCONN: PROCONN_SCHEMATIC,
  ELECTROCOIN: ELECTROCOIN_SCHEMATIC,
  PHOENIX: PHOENIX_SCHEMATIC,
  PHOENIX2: PHOENIX_SCHEMATIC,
  BLACKBOX: BLACKBOX_SCHEMATIC,
  MPU3: MPU3_SCHEMATIC,
  MPU4VIDEO: MPU4VIDEO_SCHEMATIC,
};

export function schematicFor(system: string): Schematic | null {
  return BY_SYSTEM[system] ?? null;
}

export function allSchematics(): Schematic[] {
  return Object.values(BY_SYSTEM);
}
