
export type ControlTable = readonly [number, number, number, number, number, number, number];

export function eaCost68(mode: number, reg: number, size: number): number {
  const long = size === 4;
  switch (mode) {
    case 0:
    case 1:
      return 0;
    case 2:
    case 3:
      return long ? 8 : 4;
    case 4:
      return long ? 10 : 6;
    case 5:
      return long ? 12 : 8;
    case 6:
      return long ? 14 : 10;
    case 7:
      switch (reg) {
        case 0:
          return long ? 12 : 8;
        case 1:
          return long ? 16 : 12;
        case 2:
          return long ? 12 : 8;
        case 3:
          return long ? 14 : 10;
        case 4:
          return long ? 8 : 4;
      }
  }
  return 0;
}

export function moveDstCost68(mode: number, reg: number, size: number): number {
  if (mode === 4) return size === 4 ? 8 : 4;
  return eaCost68(mode, reg, size);
}

export function aluBase68(toMemory: boolean, size: number, mode: number, reg: number): number {
  if (toMemory) return size === 4 ? 12 : 8;
  if (size !== 4) return 4;
  const fromRegisterOrImmediate = mode === 0 || mode === 1 || (mode === 7 && reg === 4);
  return fromRegisterOrImmediate ? 8 : 6;
}

export function rmwBase68(size: number, mode: number): number {
  if (mode === 0) return size === 4 ? 6 : 4;
  return size === 4 ? 12 : 8;
}

export function controlCost68(table: ControlTable, mode: number, reg: number): number {
  if (mode === 2) return table[0];
  if (mode === 5) return table[1];
  if (mode === 6) return table[2];
  if (mode === 7) {
    if (reg === 0) return table[3];
    if (reg === 1) return table[4];
    if (reg === 2) return table[5];
    if (reg === 3) return table[6];
  }
  return table[0];
}

export const MOVEM_TO_REG68: ControlTable = [12, 16, 18, 16, 20, 16, 18];
export const MOVEM_TO_MEM68: ControlTable = [8, 12, 14, 12, 16, 12, 14];
export const LEA_CYCLES68: ControlTable = [4, 8, 12, 8, 12, 8, 12];
export const PEA_CYCLES68: ControlTable = [12, 16, 20, 16, 20, 16, 20];
export const JMP_CYCLES68: ControlTable = [8, 10, 14, 10, 12, 10, 14];
export const JSR_CYCLES68: ControlTable = [16, 18, 22, 18, 20, 18, 22];
