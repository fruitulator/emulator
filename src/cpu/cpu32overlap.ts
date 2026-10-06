
function longExtra(sizeField: number): number {
  return sizeField === 2 ? 2 : 0;
}

function isMem(mode: number): boolean {
  return mode >= 2;
}

function moveTail(op: number, sizeField: number): number {
  const dstMode = (op >> 6) & 7;
  if (!isMem(dstMode)) return 0;
  const srcReg = (op & 0x38) === 0 || (op & 0x38) === 0x08;
  const extra = longExtra(sizeField);
  if (dstMode === 3) return (srcReg ? 1 : 2) + extra;
  if (dstMode === 2 || dstMode === 4) return 2 + extra;
  return (srcReg ? 3 : 2) + extra;
}

function rmwTail(mode: number, sizeField: number): number {
  return isMem(mode) ? 3 + longExtra(sizeField) : 0;
}

export function cpu32Tail(op: number): number {
  const mode = (op >> 3) & 7;
  const reg = op & 7;
  const sizeField = (op >> 6) & 3;

  switch (op >> 12) {
    case 0x0: {
      if ((op & 0x0138) === 0x0108) return (op & 0x0080) ? 0 : 2;
      if ((op & 0x0100) !== 0 || (op & 0x0f00) === 0x0800) {
        if (((op >> 6) & 3) === 0) return 0;
        return isMem(mode) ? 2 : 0;
      }
      if ((op & 0x00ff) === 0x003c) return 0;
      if ((op & 0x00ff) === 0x007c) return -2;
      if ((op & 0x0e00) === 0x0e00) return 1;
      if (sizeField === 3) return 0;
      return rmwTail(mode, sizeField);
    }

    case 0x1: return moveTail(op, 0);
    case 0x2: return moveTail(op, 2);
    case 0x3: return moveTail(op, 1);

    case 0x4: {
      if ((op & 0x0fc0) === 0x0ec0) return -2;
      if ((op & 0x0fc0) === 0x0e80) return -2;
      if ((op & 0x0ff0) === 0x0e40) return -2;
      if ((op & 0x0ff8) === 0x0e50) return 0;
      if ((op & 0x0ff8) === 0x0e58) return 0;
      if ((op & 0x0ff0) === 0x0e60) return 0;
      switch (op & 0x0fff) {
        case 0x0e70: return 0;
        case 0x0e71: return 0;
        case 0x0e72: return 0;
        case 0x0e73: return -2;
        case 0x0e74: return -2;
        case 0x0e75: return -2;
        case 0x0e76: return 0;
        case 0x0e77: return -2;
        case 0x0e7a: case 0x0e7b: return 0;
        case 0x0afc: return -2;
      }
      if ((op & 0x0fc0) === 0x01c0) return 0;
      if ((op & 0x0f00) === 0x0100) return 0;
      if ((op & 0x0fb8) === 0x0880) return 0;
      if ((op & 0x0f80) === 0x0880 || (op & 0x0f80) === 0x0c80) {
        const toMemory = (op & 0x0400) === 0;
        const long = (op & 0x0040) !== 0;
        return toMemory && long ? 2 : 0;
      }
      if ((op & 0x0fc0) === 0x0840) return 0;
      if ((op & 0x0fc0) === 0x0800) return isMem(mode) ? 2 : 0;
      if ((op & 0x0fc0) === 0x0ac0) return 0;
      if ((op & 0x0f00) === 0x0a00) return 0;
      if ((op & 0x0fc0) === 0x00c0) return isMem(mode) ? 2 : 0;
      if ((op & 0x0fc0) === 0x02c0) return isMem(mode) ? 2 : 0;
      if ((op & 0x0fc0) === 0x04c0) return 0;
      if ((op & 0x0fc0) === 0x06c0) return -2;
      if ((op & 0x0f00) === 0x0c00) return 0;
      if ((op & 0x0f00) === 0x0200) return isMem(mode) ? 2 + longExtra(sizeField) : 0;
      if ((op & 0x0f00) === 0x0000 || (op & 0x0f00) === 0x0400 || (op & 0x0f00) === 0x0600) {
        return rmwTail(mode, sizeField);
      }
      return 0;
    }

    case 0x5: {
      if (sizeField === 3) {
        if (mode === 1) return 0;
        if (mode === 7 && reg >= 2) return 0;
        return isMem(mode) ? 2 : 0;
      }
      return mode === 1 ? 0 : rmwTail(mode, sizeField);
    }

    case 0x6: return ((op >> 8) & 0xf) === 1 ? -2 : 0;

    case 0x7: return 0;

    case 0x8: case 0x9: case 0xb: case 0xc: case 0xd: {
      const opmode = (op >> 6) & 7;
      if (opmode === 3 || opmode === 7) return 0;
      if (opmode < 4) return 0;
      if (isMem(mode)) return rmwTail(mode, opmode & 3);
      const group = op >> 12;
      if (group === 0xb) return 0;
      const exg = op & 0x01f8;
      if (group === 0xc && (exg === 0x0140 || exg === 0x0148 || exg === 0x0188)) return 0;
      return (op & 0x0008) !== 0 ? 2 : 0;
    }

    case 0xe: return sizeField === 3 ? (isMem(mode) ? 2 : 0) : 0;

    default: return 0;
  }
}

let table: Int8Array | null = null;

export function cpu32TailTable(): Int8Array {
  if (!table) {
    table = new Int8Array(0x10000);
    for (let op = 0; op < 0x10000; op++) table[op] = cpu32Tail(op);
  }
  return table;
}

export const CPU32_EXCEPTION_TAIL = -2;

export const HEAD_FROM_EA = -1;

function srcIsRegister(op: number): boolean {
  const m = op & 0x38;
  return m === 0x00 || m === 0x08;
}

export function cpu32OpHead(op: number): number {
  const mode = (op >> 3) & 7;
  const reg = op & 7;

  switch (op >> 12) {
    case 0x0: {
      if ((op & 0x0138) === 0x0108) return (op & 0x0080) ? 2 : 1;
      if ((op & 0x0100) !== 0 || (op & 0x0f00) === 0x0800) {
        if (mode >= 2) return HEAD_FROM_EA;
        const isStatic = (op & 0x0100) === 0;
        if (((op >> 6) & 3) === 0) return isStatic ? 1 : 2;
        return isStatic ? 1 : 4;
      }
      if ((op & 0x00ff) === 0x003c) return 2;
      if ((op & 0x00ff) === 0x007c) return 0;
      return HEAD_FROM_EA;
    }

    case 0x1: case 0x2: case 0x3: {
      if (!srcIsRegister(op)) return HEAD_FROM_EA;
      const dst = (op >> 6) & 7;
      if (dst <= 2) return 0;
      if (dst === 3) return 1;
      if (dst === 4) return 2;
      return HEAD_FROM_EA;
    }

    case 0x4: {
      if ((op & 0x0fc0) === 0x0ec0) return HEAD_FROM_EA;
      if ((op & 0x0fc0) === 0x0e80) return HEAD_FROM_EA;
      if ((op & 0x0ff0) === 0x0e40) return 4;
      if ((op & 0x0ff8) === 0x0e50) return 2;
      if ((op & 0x0ff8) === 0x0e58) return 1;
      if ((op & 0x0ff0) === 0x0e60) return 0;
      switch (op & 0x0fff) {
        case 0x0e70: return 0;
        case 0x0e71: return 0;
        case 0x0e72: return 2;
        case 0x0e73: return 1;
        case 0x0e74: return 1;
        case 0x0e75: return 1;
        case 0x0e76: return 2;
        case 0x0e77: return 1;
        case 0x0e7a: case 0x0e7b: return 10;
        case 0x0afc: return 0;
        case 0x0808: return 0;
      }
      if ((op & 0x0fc0) === 0x01c0) return HEAD_FROM_EA;
      if ((op & 0x0f00) === 0x0100) return HEAD_FROM_EA;
      if ((op & 0x0fb8) === 0x0880) return 0;
      if ((op & 0x0f80) === 0x0880 || (op & 0x0f80) === 0x0c80) return HEAD_FROM_EA;
      if ((op & 0x0ff8) === 0x0840) return 4;
      if ((op & 0x0ff8) === 0x0848) return 0;
      if ((op & 0x0fc0) === 0x0840) return HEAD_FROM_EA;
      if ((op & 0x0fc0) === 0x0800) return mode >= 2 ? HEAD_FROM_EA : 2;
      if ((op & 0x0fc0) === 0x0ac0) return mode >= 2 ? HEAD_FROM_EA : 4;
      if ((op & 0x0f00) === 0x0a00) return HEAD_FROM_EA;
      if ((op & 0x0fc0) === 0x00c0) return mode === 0 ? 2 : HEAD_FROM_EA;
      if ((op & 0x0fc0) === 0x02c0) return mode === 0 ? 2 : HEAD_FROM_EA;
      if ((op & 0x0fc0) === 0x04c0) return mode === 0 ? 2 : HEAD_FROM_EA;
      if ((op & 0x0fc0) === 0x06c0) return mode === 0 ? 4 : HEAD_FROM_EA;
      if ((op & 0x0f00) === 0x0c00) return HEAD_FROM_EA;
      return mode >= 2 ? HEAD_FROM_EA : 0;
    }

    case 0x5: {
      if (((op >> 6) & 3) === 3) {
        if (mode === 1) return 1;
        if (mode === 7 && reg >= 2) return reg === 2 ? 2 : 0;
        return mode >= 2 ? HEAD_FROM_EA : 2;
      }
      return mode >= 2 ? HEAD_FROM_EA : 0;
    }

    case 0x6: return ((op >> 8) & 0xf) === 1 ? 3 : (op & 0xff) === 0 ? 0 : 2;

    case 0x7: return 0;

    case 0x8: case 0x9: case 0xb: case 0xc: case 0xd: {
      const opmode = (op >> 6) & 7;
      const group = op >> 12;
      if (opmode >= 4 && mode <= 1) {
        if (group === 0xb) return 1;
        const exg = op & 0x01f8;
        if (group === 0xc && (exg === 0x0140 || exg === 0x0148 || exg === 0x0188)) return 2;
        if (group === 0x8 || group === 0xc) return 2;
        return (op & 0x0008) !== 0 ? 2 : 0;
      }
      return mode >= 2 ? HEAD_FROM_EA : 0;
    }

    case 0xe: {
      if (((op >> 6) & 3) === 3) return mode >= 2 ? HEAD_FROM_EA : 0;
      return (op & 0x0020) === 0 ? 4 : 0;
    }

    default: return 0;
  }
}

let heads: Int8Array | null = null;

export function cpu32OpHeadTable(): Int8Array {
  if (!heads) {
    heads = new Int8Array(0x10000);
    for (let op = 0; op < 0x10000; op++) heads[op] = cpu32OpHead(op);
  }
  return heads;
}

export function cpu32EaHead(mode: number, reg: number): number {
  switch (mode) {
    case 0:
    case 1:
      return 0;
    case 2:
    case 3:
      return 1;
    case 4:
      return 2;
    case 5:
      return 1;
    case 6:
      return 4;
    case 7:
      return reg === 3 ? 4 : 1;
    default:
      return 0;
  }
}
