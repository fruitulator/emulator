import type { AudioSource } from '../machine/machine';

export const YM2413_CLOCK = 3_579_545;
export const YM2413_RATE = Math.round(YM2413_CLOCK / 72);

const PG_BITS = 10;
const PG_WIDTH = 1 << PG_BITS;
const DP_BITS = 19;
const DP_WIDTH = 1 << DP_BITS;
const DP_BASE_BITS = DP_BITS - PG_BITS;

const EG_BITS = 7;
const EG_MUTE = (1 << EG_BITS) - 1;
const EG_MAX = EG_MUTE - 4;
const TL_BITS = 6;
const DAMPER_RATE = 12;

const EXP_TABLE = new Uint16Array([
  0, 3, 6, 8, 11, 14, 17, 20, 22, 25, 28, 31, 34, 37, 40, 42,
  45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90,
  93, 96, 99, 102, 105, 108, 111, 114, 117, 120, 123, 126, 130, 133, 136, 139,
  142, 145, 148, 152, 155, 158, 161, 164, 168, 171, 174, 177, 181, 184, 187, 190,
  194, 197, 200, 204, 207, 210, 214, 217, 220, 224, 227, 231, 234, 237, 241, 244,
  248, 251, 255, 258, 262, 265, 268, 272, 276, 279, 283, 286, 290, 293, 297, 300,
  304, 308, 311, 315, 318, 322, 326, 329, 333, 337, 340, 344, 348, 352, 355, 359,
  363, 367, 370, 374, 378, 382, 385, 389, 393, 397, 401, 405, 409, 412, 416, 420,
  424, 428, 432, 436, 440, 444, 448, 452, 456, 460, 464, 468, 472, 476, 480, 484,
  488, 492, 496, 501, 505, 509, 513, 517, 521, 526, 530, 534, 538, 542, 547, 551,
  555, 560, 564, 568, 572, 577, 581, 585, 590, 594, 599, 603, 607, 612, 616, 621,
  625, 630, 634, 639, 643, 648, 652, 657, 661, 666, 670, 675, 680, 684, 689, 693,
  698, 703, 708, 712, 717, 722, 726, 731, 736, 741, 745, 750, 755, 760, 765, 770,
  774, 779, 784, 789, 794, 799, 804, 809, 814, 819, 824, 829, 834, 839, 844, 849,
  854, 859, 864, 869, 874, 880, 885, 890, 895, 900, 906, 911, 916, 921, 927, 932,
  937, 942, 948, 953, 959, 964, 969, 975, 980, 986, 991, 996, 1002, 1007, 1013, 1018,
]);

const SIN_QUARTER = new Uint16Array([
  2137, 1731, 1543, 1419, 1326, 1252, 1190, 1137, 1091, 1050, 1013, 979, 949, 920, 894, 869,
  846, 825, 804, 785, 767, 749, 732, 717, 701, 687, 672, 659, 646, 633, 621, 609,
  598, 587, 576, 566, 556, 546, 536, 527, 518, 509, 501, 492, 484, 476, 468, 461,
  453, 446, 439, 432, 425, 418, 411, 405, 399, 392, 386, 380, 375, 369, 363, 358,
  352, 347, 341, 336, 331, 326, 321, 316, 311, 307, 302, 297, 293, 289, 284, 280,
  276, 271, 267, 263, 259, 255, 251, 248, 244, 240, 236, 233, 229, 226, 222, 219,
  215, 212, 209, 205, 202, 199, 196, 193, 190, 187, 184, 181, 178, 175, 172, 169,
  167, 164, 161, 159, 156, 153, 151, 148, 146, 143, 141, 138, 136, 134, 131, 129,
  127, 125, 122, 120, 118, 116, 114, 112, 110, 108, 106, 104, 102, 100, 98, 96,
  94, 92, 91, 89, 87, 85, 83, 82, 80, 78, 77, 75, 74, 72, 70, 69,
  67, 66, 64, 63, 62, 60, 59, 57, 56, 55, 53, 52, 51, 49, 48, 47,
  46, 45, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30,
  29, 28, 27, 26, 25, 24, 23, 23, 22, 21, 20, 20, 19, 18, 17, 17,
  16, 15, 15, 14, 13, 13, 12, 12, 11, 10, 10, 9, 9, 8, 8, 7,
  7, 7, 6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2,
  2, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
]);

const FULL_SIN = new Uint16Array(PG_WIDTH);
const HALF_SIN = new Uint16Array(PG_WIDTH);
(() => {
  FULL_SIN.set(SIN_QUARTER, 0);
  for (let x = 0; x < PG_WIDTH / 4; x++) FULL_SIN[PG_WIDTH / 4 + x] = FULL_SIN[PG_WIDTH / 4 - x - 1];
  for (let x = 0; x < PG_WIDTH / 2; x++) FULL_SIN[PG_WIDTH / 2 + x] = 0x8000 | FULL_SIN[x];
  for (let x = 0; x < PG_WIDTH / 2; x++) HALF_SIN[x] = FULL_SIN[x];
  for (let x = PG_WIDTH / 2; x < PG_WIDTH; x++) HALF_SIN[x] = 0xfff;
})();
const WAVE = [FULL_SIN, HALF_SIN];

const PM_TABLE = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, -1, 0],
  [0, 1, 2, 1, 0, -1, -2, -1],
  [0, 1, 3, 1, 0, -1, -3, -1],
  [0, 2, 4, 2, 0, -2, -4, -2],
  [0, 2, 5, 2, 0, -2, -5, -2],
  [0, 3, 6, 3, 0, -3, -6, -3],
  [0, 3, 7, 3, 0, -3, -7, -3],
];

const AM_TABLE = new Uint8Array([
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3,
  4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5,
  6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7,
  8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9,
  10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11,
  12, 12, 12, 12, 12, 12, 12, 12,
  13, 13, 13,
  12, 12, 12, 12, 12, 12, 12, 12,
  11, 11, 11, 11, 11, 11, 11, 11, 10, 10, 10, 10, 10, 10, 10, 10,
  9, 9, 9, 9, 9, 9, 9, 9, 8, 8, 8, 8, 8, 8, 8, 8,
  7, 7, 7, 7, 7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6,
  5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4,
  3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2,
  1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
]);

const EG_STEP_TABLES = [
  [0, 1, 0, 1, 0, 1, 0, 1],
  [0, 1, 0, 1, 1, 1, 0, 1],
  [0, 1, 1, 1, 0, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 1],
];

const ML_TABLE = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];
const dB2 = (x: number): number => x * 2;
const KL_TABLE = [
  dB2(0.0), dB2(9.0), dB2(12.0), dB2(13.875), dB2(15.0), dB2(16.125),
  dB2(16.875), dB2(17.625), dB2(18.0), dB2(18.75), dB2(19.125), dB2(19.5),
  dB2(19.875), dB2(20.25), dB2(20.625), dB2(21.0),
];

const TLL_TABLE = new Uint32Array(8 * 16 * (1 << TL_BITS) * 4);
(() => {
  const EG_STEP = 0.375;
  for (let fnum = 0; fnum < 16; fnum++) {
    for (let block = 0; block < 8; block++) {
      for (let tl = 0; tl < 64; tl++) {
        for (let kl = 0; kl < 4; kl++) {
          const idx = ((((block << 4) | fnum) * 64 + tl) * 4) + kl;
          if (kl === 0) {
            TLL_TABLE[idx] = tl << 1;
          } else {
            const tmp = Math.trunc(KL_TABLE[fnum] - dB2(3.0) * (7 - block));
            TLL_TABLE[idx] = tmp <= 0 ? tl << 1 : Math.trunc((tmp >> (3 - kl)) / EG_STEP) + (tl << 1);
          }
        }
      }
    }
  }
})();

const RKS_TABLE = new Int32Array(8 * 2 * 2);
(() => {
  for (let fnum8 = 0; fnum8 < 2; fnum8++) {
    for (let block = 0; block < 8; block++) {
      const i = (block << 1) | fnum8;
      RKS_TABLE[i * 2 + 1] = (block << 1) + fnum8;
      RKS_TABLE[i * 2 + 0] = block >> 1;
    }
  }
})();

const DEFAULT_INST = new Uint8Array([
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x71, 0x61, 0x1e, 0x17, 0xd0, 0x78, 0x00, 0x17,
  0x13, 0x41, 0x1a, 0x0d, 0xd8, 0xf7, 0x23, 0x13,
  0x13, 0x01, 0x99, 0x00, 0xf2, 0xc4, 0x21, 0x23,
  0x11, 0x61, 0x0e, 0x07, 0x8d, 0x64, 0x70, 0x27,
  0x32, 0x21, 0x1e, 0x06, 0xe1, 0x76, 0x01, 0x28,
  0x31, 0x22, 0x16, 0x05, 0xe0, 0x71, 0x00, 0x18,
  0x21, 0x61, 0x1d, 0x07, 0x82, 0x81, 0x11, 0x07,
  0x33, 0x21, 0x2d, 0x13, 0xb0, 0x70, 0x00, 0x07,
  0x61, 0x61, 0x1b, 0x06, 0x64, 0x65, 0x10, 0x17,
  0x41, 0x61, 0x0b, 0x18, 0x85, 0xf0, 0x81, 0x07,
  0x33, 0x01, 0x83, 0x11, 0xea, 0xef, 0x10, 0x04,
  0x17, 0xc1, 0x24, 0x07, 0xf8, 0xf8, 0x22, 0x12,
  0x61, 0x50, 0x0c, 0x05, 0xd2, 0xf5, 0x40, 0x42,
  0x01, 0x01, 0x55, 0x03, 0xe9, 0x90, 0x03, 0x02,
  0x41, 0x41, 0x89, 0x03, 0xf1, 0xe4, 0xc0, 0x13,
  0x01, 0x01, 0x18, 0x0f, 0xdf, 0xf8, 0x6a, 0x6d,
  0x01, 0x01, 0x00, 0x00, 0xc8, 0xd8, 0xa7, 0x68,
  0x05, 0x01, 0x00, 0x00, 0xf8, 0xaa, 0x59, 0x55,
]);

interface Patch {
  AM: number; PM: number; EG: number; KR: number; ML: number;
  KL: number; TL: number; WS: number; FB: number;
  AR: number; DR: number; SL: number; RR: number;
}
const newPatch = (): Patch => ({
  AM: 0, PM: 0, EG: 0, KR: 0, ML: 0, KL: 0, TL: 0, WS: 0, FB: 0, AR: 0, DR: 0, SL: 0, RR: 0,
});

function dumpToPatch(d: Uint8Array, off: number, mod: Patch, car: Patch): void {
  mod.AM = (d[off] >> 7) & 1; mod.PM = (d[off] >> 6) & 1;
  mod.EG = (d[off] >> 5) & 1; mod.KR = (d[off] >> 4) & 1; mod.ML = d[off] & 15;
  car.AM = (d[off + 1] >> 7) & 1; car.PM = (d[off + 1] >> 6) & 1;
  car.EG = (d[off + 1] >> 5) & 1; car.KR = (d[off + 1] >> 4) & 1; car.ML = d[off + 1] & 15;
  mod.KL = (d[off + 2] >> 6) & 3; mod.TL = d[off + 2] & 63;
  car.KL = (d[off + 3] >> 6) & 3;
  car.WS = (d[off + 3] >> 4) & 1; mod.WS = (d[off + 3] >> 3) & 1; mod.FB = d[off + 3] & 7;
  mod.AR = (d[off + 4] >> 4) & 15; mod.DR = d[off + 4] & 15;
  car.AR = (d[off + 5] >> 4) & 15; car.DR = d[off + 5] & 15;
  mod.SL = (d[off + 6] >> 4) & 15; mod.RR = d[off + 6] & 15;
  car.SL = (d[off + 7] >> 4) & 15; car.RR = d[off + 7] & 15;
  car.FB = 0; car.TL = 0;
}

const ATTACK = 0, DECAY = 1, SUSTAIN = 2, RELEASE = 3, DAMP = 4;

const UPDATE_WS = 1, UPDATE_TLL = 2, UPDATE_RKS = 4, UPDATE_EG = 8, UPDATE_ALL = 255;

const SLOT_BD1 = 12, SLOT_HH = 14, SLOT_SD = 15, SLOT_TOM = 16, SLOT_CYM = 17;

class Slot {
  number = 0;
  type = 0;
  pgKeep = 0;
  waveTable = FULL_SIN;
  pgPhase = 0;
  pgOut = 0;
  output0 = 0;
  output1 = 0;
  egState = RELEASE;
  egShift = 0;
  egRateH = 0;
  egRateL = 0;
  egOut = EG_MUTE;
  rks = 0;
  tll = 0;
  keyFlag = 0;
  susFlag = 0;
  blkFnum = 0;
  blk = 0;
  fnum = 0;
  volume = 0;
  updateRequests = 0;
  patch: Patch = newPatch();
}

export class Ym2413 implements AudioSource {
  readonly rate: number;

  readonly regs = new Uint8Array(0x40);

  gain = 1;

  setGain(g: number): void {
    if (g === this.gain) return;
    this.flush();
    this.gain = g;
  }
  v20Mix = false;
  private v20Out = 0;

  private readonly slots: Slot[] = [];
  private readonly patches: Patch[] = [];
  private readonly patchNumber = new Int32Array(9);
  private readonly chOut = new Int16Array(14);

  private address = 0;
  private slotKeyStatus = 0;
  private rhythmMode = 0;
  private egCounter = 0;
  private pmPhase = 0;
  private amPhase = 0;
  private lfoAm = 0;
  private noise = 0;
  private shortNoise = 0;
  private testFlag = 0;
  private mixOut = 0;

  constructor(outRate: number = YM2413_RATE) {
    this.rate = outRate;
    const frames = 2 ** Math.ceil(Math.log2(Math.max(1 << 14, outRate * 0.25)));
    this.ring = new Float32Array(frames * 2);
    for (let i = 0; i < 18; i++) this.slots.push(new Slot());
    for (let i = 0; i < 19 * 2; i++) this.patches.push(newPatch());
    for (let i = 0; i < 19; i++) {
      dumpToPatch(DEFAULT_INST, i * 8, this.patches[i * 2], this.patches[i * 2 + 1]);
    }
    this.reset();
  }

  reset(): void {
    this.flush();
    this.address = 0;
    this.noise = 0x1;
    this.mixOut = 0;
    this.v20Out = 0;
    this.egCounter = 0;
    this.pmPhase = 0;
    this.amPhase = 0;
    this.lfoAm = 0;
    this.shortNoise = 0;
    this.testFlag = 0;
    this.slotKeyStatus = 0;
    this.rhythmMode = 0;
    this.chOut.fill(0);
    this.regs.fill(0);
    dumpToPatch(DEFAULT_INST, 0, this.patches[0], this.patches[1]);
    for (let i = 0; i < 18; i++) {
      const s = this.slots[i];
      s.number = i;
      s.type = i % 2;
      s.pgKeep = 0;
      s.waveTable = FULL_SIN;
      s.pgPhase = 0;
      s.pgOut = 0;
      s.output0 = 0;
      s.output1 = 0;
      s.egState = RELEASE;
      s.egShift = 0;
      s.egRateH = 0;
      s.egRateL = 0;
      s.egOut = EG_MUTE;
      s.rks = 0;
      s.tll = 0;
      s.keyFlag = 0;
      s.susFlag = 0;
      s.blkFnum = 0;
      s.blk = 0;
      s.fnum = 0;
      s.volume = 0;
      s.updateRequests = 0;
      s.patch = newPatch();
    }
    for (let ch = 0; ch < 9; ch++) this.setPatch(ch, 0);
    this.resamplePhase = 0;
    this.prevSample = 0;
    this.nextSample = 0;
  }

  writeAddress(v: number): void {
    this.address = v & 0x3f;
  }

  writeData(v: number): void {
    this.write(this.address, v);
  }

  write(reg: number, data: number): void {
    if (reg >= 0x40) return;
    this.flush();
    if ((reg >= 0x19 && reg <= 0x1f) || (reg >= 0x29 && reg <= 0x2f) || (reg >= 0x39 && reg <= 0x3f)) {
      reg -= 9;
    }
    data &= 0xff;
    this.regs[reg] = data;

    const p = this.patches;
    switch (reg) {
      case 0x00:
        p[0].AM = (data >> 7) & 1; p[0].PM = (data >> 6) & 1;
        p[0].EG = (data >> 5) & 1; p[0].KR = (data >> 4) & 1; p[0].ML = data & 15;
        this.requestUser(0, UPDATE_RKS | UPDATE_EG);
        break;
      case 0x01:
        p[1].AM = (data >> 7) & 1; p[1].PM = (data >> 6) & 1;
        p[1].EG = (data >> 5) & 1; p[1].KR = (data >> 4) & 1; p[1].ML = data & 15;
        this.requestUser(1, UPDATE_RKS | UPDATE_EG);
        break;
      case 0x02:
        p[0].KL = (data >> 6) & 3; p[0].TL = data & 63;
        this.requestUser(0, UPDATE_TLL);
        break;
      case 0x03:
        p[1].KL = (data >> 6) & 3;
        p[1].WS = (data >> 4) & 1; p[0].WS = (data >> 3) & 1; p[0].FB = data & 7;
        for (let i = 0; i < 9; i++) {
          if (this.patchNumber[i] === 0) {
            this.request(this.mod(i), UPDATE_WS);
            this.request(this.car(i), UPDATE_WS | UPDATE_TLL);
          }
        }
        break;
      case 0x04:
        p[0].AR = (data >> 4) & 15; p[0].DR = data & 15;
        this.requestUser(0, UPDATE_EG);
        break;
      case 0x05:
        p[1].AR = (data >> 4) & 15; p[1].DR = data & 15;
        this.requestUser(1, UPDATE_EG);
        break;
      case 0x06:
        p[0].SL = (data >> 4) & 15; p[0].RR = data & 15;
        this.requestUser(0, UPDATE_EG);
        break;
      case 0x07:
        p[1].SL = (data >> 4) & 15; p[1].RR = data & 15;
        this.requestUser(1, UPDATE_EG);
        break;
      case 0x0e:
        this.updateRhythmMode();
        this.updateKeyStatus();
        break;
      case 0x0f:
        this.testFlag = data;
        break;
      default:
        if (reg >= 0x10 && reg <= 0x18) {
          const ch = reg - 0x10;
          this.setFnumber(ch, data + ((this.regs[0x20 + ch] & 1) << 8));
        } else if (reg >= 0x20 && reg <= 0x28) {
          const ch = reg - 0x20;
          this.setFnumber(ch, ((data & 1) << 8) + this.regs[0x10 + ch]);
          this.setBlock(ch, (data >> 1) & 7);
          this.setSusFlag(ch, (data >> 5) & 1);
          this.updateKeyStatus();
        } else if (reg >= 0x30 && reg <= 0x38) {
          if ((this.regs[0x0e] & 32) && reg >= 0x36) {
            if (reg === 0x37) this.setSlotVolume(this.mod(7), ((data >> 4) & 15) << 2);
            else if (reg === 0x38) this.setSlotVolume(this.mod(8), ((data >> 4) & 15) << 2);
          } else {
            this.setPatch(reg - 0x30, (data >> 4) & 15);
          }
          this.setVolume(reg - 0x30, (data & 15) << 2);
        }
        break;
    }
  }

  private mod(ch: number): Slot { return this.slots[ch << 1]; }
  private car(ch: number): Slot { return this.slots[(ch << 1) | 1]; }
  private request(s: Slot, flag: number): void { s.updateRequests |= flag; }

  private requestUser(which: number, flag: number): void {
    for (let i = 0; i < 9; i++) {
      if (this.patchNumber[i] === 0) this.request(which === 0 ? this.mod(i) : this.car(i), flag);
    }
  }

  private setPatch(ch: number, num: number): void {
    this.patchNumber[ch] = num;
    this.mod(ch).patch = this.patches[num * 2];
    this.car(ch).patch = this.patches[num * 2 + 1];
    this.request(this.mod(ch), UPDATE_ALL);
    this.request(this.car(ch), UPDATE_ALL);
  }

  private setSusFlag(ch: number, flag: number): void {
    this.car(ch).susFlag = flag;
    this.request(this.car(ch), UPDATE_EG);
    if (this.mod(ch).type & 1) {
      this.mod(ch).susFlag = flag;
      this.request(this.mod(ch), UPDATE_EG);
    }
  }

  private setVolume(ch: number, volume: number): void {
    this.car(ch).volume = volume;
    this.request(this.car(ch), UPDATE_TLL);
  }

  private setSlotVolume(s: Slot, volume: number): void {
    s.volume = volume;
    this.request(s, UPDATE_TLL);
  }

  private setFnumber(ch: number, fnum: number): void {
    const car = this.car(ch), mod = this.mod(ch);
    car.fnum = fnum;
    car.blkFnum = (car.blkFnum & 0xe00) | (fnum & 0x1ff);
    mod.fnum = fnum;
    mod.blkFnum = (mod.blkFnum & 0xe00) | (fnum & 0x1ff);
    this.request(car, UPDATE_EG | UPDATE_RKS | UPDATE_TLL);
    this.request(mod, UPDATE_EG | UPDATE_RKS | UPDATE_TLL);
  }

  private setBlock(ch: number, blk: number): void {
    const car = this.car(ch), mod = this.mod(ch);
    car.blk = blk;
    car.blkFnum = ((blk & 7) << 9) | (car.blkFnum & 0x1ff);
    mod.blk = blk;
    mod.blkFnum = ((blk & 7) << 9) | (mod.blkFnum & 0x1ff);
    this.request(car, UPDATE_EG | UPDATE_RKS | UPDATE_TLL);
    this.request(mod, UPDATE_EG | UPDATE_RKS | UPDATE_TLL);
  }

  private updateRhythmMode(): void {
    const next = (this.regs[0x0e] >> 5) & 1;
    if (this.rhythmMode !== next) {
      if (next) {
        this.slots[SLOT_HH].type = 3; this.slots[SLOT_HH].pgKeep = 1;
        this.slots[SLOT_SD].type = 3;
        this.slots[SLOT_TOM].type = 3;
        this.slots[SLOT_CYM].type = 3; this.slots[SLOT_CYM].pgKeep = 1;
        this.setPatch(6, 16);
        this.setPatch(7, 17);
        this.setPatch(8, 18);
        this.setSlotVolume(this.slots[SLOT_HH], ((this.regs[0x37] >> 4) & 15) << 2);
        this.setSlotVolume(this.slots[SLOT_TOM], ((this.regs[0x38] >> 4) & 15) << 2);
      } else {
        this.slots[SLOT_HH].type = 0; this.slots[SLOT_HH].pgKeep = 0;
        this.slots[SLOT_SD].type = 1;
        this.slots[SLOT_TOM].type = 0;
        this.slots[SLOT_CYM].type = 1; this.slots[SLOT_CYM].pgKeep = 0;
        this.setPatch(6, this.regs[0x36] >> 4);
        this.setPatch(7, this.regs[0x37] >> 4);
        this.setPatch(8, this.regs[0x38] >> 4);
      }
    }
    this.rhythmMode = next;
  }

  private updateKeyStatus(): void {
    const r14 = this.regs[0x0e];
    const rhythm = (r14 >> 5) & 1;
    let next = 0;
    for (let ch = 0; ch < 9; ch++) if (this.regs[0x20 + ch] & 0x10) next |= 3 << (ch * 2);
    if (rhythm) {
      if (r14 & 0x10) next |= 3 << SLOT_BD1;
      if (r14 & 0x01) next |= 1 << SLOT_HH;
      if (r14 & 0x08) next |= 1 << SLOT_SD;
      if (r14 & 0x04) next |= 1 << SLOT_TOM;
      if (r14 & 0x02) next |= 1 << SLOT_CYM;
    }
    const changed = this.slotKeyStatus ^ next;
    if (changed) {
      for (let i = 0; i < 18; i++) {
        if ((changed >> i) & 1) {
          const s = this.slots[i];
          if ((next >> i) & 1) {
            s.keyFlag = 1;
            s.egState = DAMP;
            this.request(s, UPDATE_EG);
          } else {
            s.keyFlag = 0;
            if (s.type & 1) {
              s.egState = RELEASE;
              this.request(s, UPDATE_EG);
            }
          }
        }
      }
    }
    this.slotKeyStatus = next;
  }

  private parameterRate(s: Slot): number {
    if ((s.type & 1) === 0 && s.keyFlag === 0) return 0;
    switch (s.egState) {
      case ATTACK: return s.patch.AR;
      case DECAY: return s.patch.DR;
      case SUSTAIN: return s.patch.EG ? 0 : s.patch.RR;
      case RELEASE:
        if (s.susFlag) return 5;
        return s.patch.EG ? s.patch.RR : 7;
      case DAMP: return DAMPER_RATE;
      default: return 0;
    }
  }

  private commitSlotUpdate(s: Slot): void {
    if (s.updateRequests & UPDATE_WS) s.waveTable = WAVE[s.patch.WS];
    if (s.updateRequests & UPDATE_TLL) {
      const level = (s.type & 1) === 0 ? s.patch.TL : s.volume;
      s.tll = TLL_TABLE[(((s.blkFnum >> 5) * 64 + level) * 4) + s.patch.KL];
    }
    if (s.updateRequests & UPDATE_RKS) {
      s.rks = RKS_TABLE[(s.blkFnum >> 8) * 2 + s.patch.KR];
    }
    if (s.updateRequests & (UPDATE_RKS | UPDATE_EG)) {
      const rate = this.parameterRate(s);
      if (rate === 0) {
        s.egShift = 0; s.egRateH = 0; s.egRateL = 0;
        s.updateRequests = 0;
        return;
      }
      s.egRateH = Math.min(15, rate + (s.rks >> 2));
      s.egRateL = s.rks & 3;
      s.egShift = s.egState === ATTACK
        ? (s.egRateH > 0 && s.egRateH < 12 ? 13 - s.egRateH : 0)
        : (s.egRateH < 13 ? 13 - s.egRateH : 0);
    }
    s.updateRequests = 0;
  }

  private updateAmPm(): void {
    if (this.testFlag & 2) {
      this.pmPhase = 0;
      this.amPhase = 0;
    } else {
      this.pmPhase = (this.pmPhase + ((this.testFlag & 8) ? 1024 : 1)) | 0;
      this.amPhase = (this.amPhase + ((this.testFlag & 8) ? 64 : 1)) | 0;
    }
    this.lfoAm = AM_TABLE[(this.amPhase >> 6) % AM_TABLE.length];
  }

  private updateNoise(cycles: number): void {
    for (let i = 0; i < cycles; i++) {
      if (this.noise & 1) this.noise ^= 0x800200;
      this.noise >>>= 1;
    }
  }

  private updateShortNoise(): void {
    const pgHh = this.slots[SLOT_HH].pgOut;
    const pgCym = this.slots[SLOT_CYM].pgOut;
    const hBit2 = (pgHh >> (PG_BITS - 8)) & 1;
    const hBit7 = (pgHh >> (PG_BITS - 3)) & 1;
    const hBit3 = (pgHh >> (PG_BITS - 7)) & 1;
    const cBit3 = (pgCym >> (PG_BITS - 7)) & 1;
    const cBit5 = (pgCym >> (PG_BITS - 5)) & 1;
    this.shortNoise = (hBit2 ^ hBit7) | (hBit3 ^ cBit5) | (cBit3 ^ cBit5);
  }

  private calcPhase(s: Slot, pmPhase: number, reset: number): void {
    const pm = s.patch.PM ? PM_TABLE[(s.fnum >> 6) & 7][(pmPhase >> 10) & 7] : 0;
    if (reset) s.pgPhase = 0;
    s.pgPhase += ((((s.fnum & 0x1ff) * 2 + pm) * ML_TABLE[s.patch.ML]) << s.blk) >> 2;
    s.pgPhase &= DP_WIDTH - 1;
    s.pgOut = s.pgPhase >>> DP_BASE_BITS;
  }

  private lookupAttackStep(s: Slot, counter: number): number {
    switch (s.egRateH) {
      case 12: return 4 - EG_STEP_TABLES[s.egRateL][(counter & 0xc) >> 1];
      case 13: return 3 - EG_STEP_TABLES[s.egRateL][(counter & 0xc) >> 1];
      case 14: return 2 - EG_STEP_TABLES[s.egRateL][(counter & 0xc) >> 1];
      case 0:
      case 15: return 0;
      default: return EG_STEP_TABLES[s.egRateL][(counter >> s.egShift) & 7] ? 4 : 0;
    }
  }

  private lookupDecayStep(s: Slot, counter: number): number {
    switch (s.egRateH) {
      case 0: return 0;
      case 13: return EG_STEP_TABLES[s.egRateL][((counter & 0xc) >> 1) | (counter & 1)];
      case 14: return EG_STEP_TABLES[s.egRateL][(counter & 0xc) >> 1] + 1;
      case 15: return 2;
      default: return EG_STEP_TABLES[s.egRateL][(counter >> s.egShift) & 7];
    }
  }

  private startEnvelope(s: Slot): void {
    if (Math.min(15, s.patch.AR + (s.rks >> 2)) === 15) {
      s.egState = DECAY;
      s.egOut = 0;
    } else {
      s.egState = ATTACK;
    }
    this.request(s, UPDATE_EG);
  }

  private calcEnvelope(s: Slot, buddy: Slot | null, egCounter: number, test: number): void {
    const mask = (1 << s.egShift) - 1;
    if (s.egState === ATTACK) {
      if (s.egOut > 0 && s.egRateH > 0 && (egCounter & mask & ~3) === 0) {
        const step = this.lookupAttackStep(s, egCounter);
        if (step > 0) s.egOut = Math.max(0, s.egOut - (s.egOut >> step) - 1);
      }
    } else if (s.egRateH > 0 && (egCounter & mask) === 0) {
      s.egOut = Math.min(EG_MUTE, s.egOut + this.lookupDecayStep(s, egCounter));
    }

    switch (s.egState) {
      case DAMP:
        if (s.egOut >= EG_MAX && (egCounter & mask) === 0) {
          this.startEnvelope(s);
          if (s.type & 1) {
            if (!s.pgKeep) s.pgPhase = 0;
            if (buddy && !buddy.pgKeep) buddy.pgPhase = 0;
          }
        }
        break;
      case ATTACK:
        if (s.egOut === 0) {
          s.egState = DECAY;
          this.request(s, UPDATE_EG);
        }
        break;
      case DECAY:
        if ((s.egOut >> 3) === s.patch.SL) {
          s.egState = SUSTAIN;
          this.request(s, UPDATE_EG);
        }
        break;
      default:
        break;
    }
    if (test) s.egOut = 0;
  }

  private updateSlots(): void {
    this.egCounter = (this.egCounter + 1) & 0xffff;
    for (let i = 0; i < 18; i++) {
      const s = this.slots[i];
      let buddy: Slot | null = null;
      if (s.type === 0) buddy = this.slots[i + 1];
      else if (s.type === 1) buddy = this.slots[i - 1];
      if (s.updateRequests) this.commitSlotUpdate(s);
      this.calcEnvelope(s, buddy, this.egCounter, this.testFlag & 1);
      this.calcPhase(s, this.pmPhase, this.testFlag & 4);
    }
  }

  private lookupExpTable(i: number): number {
    const t = (EXP_TABLE[(i & 0xff) ^ 0xff] + 1024) | 0;
    const res = t >> ((i & 0x7f00) >> 8);
    return (((i & 0x8000) ? ~res : res) << 1) | 0;
  }

  private toLinear(h: number, s: Slot, am: number): number {
    if (s.egOut > EG_MAX) return 0;
    const att = Math.min(EG_MUTE, s.egOut + s.tll + am) << 4;
    return this.lookupExpTable((h + att) & 0xffff);
  }

  private calcSlotCar(ch: number, fm: number): number {
    const s = this.car(ch);
    const am = s.patch.AM ? this.lfoAm : 0;
    s.output1 = s.output0;
    s.output0 = this.toLinear(s.waveTable[(s.pgOut + 2 * (fm >> 1)) & (PG_WIDTH - 1)], s, am);
    return s.output0;
  }

  private calcSlotMod(ch: number): number {
    const s = this.mod(ch);
    const fm = s.patch.FB > 0 ? (s.output1 + s.output0) >> (9 - s.patch.FB) : 0;
    const am = s.patch.AM ? this.lfoAm : 0;
    s.output1 = s.output0;
    s.output0 = this.toLinear(s.waveTable[(s.pgOut + fm) & (PG_WIDTH - 1)], s, am);
    return s.output0;
  }

  private calcSlotTom(): number {
    const s = this.mod(8);
    return this.toLinear(s.waveTable[s.pgOut], s, 0);
  }

  private calcSlotSnare(): number {
    const s = this.car(7);
    const phase = ((s.pgOut >> (PG_BITS - 2)) & 1)
      ? ((this.noise & 1) ? 0x300 : 0x200)
      : ((this.noise & 1) ? 0x0 : 0x100);
    return this.toLinear(s.waveTable[phase], s, 0);
  }

  private calcSlotCym(): number {
    const s = this.car(8);
    return this.toLinear(s.waveTable[this.shortNoise ? 0x300 : 0x100], s, 0);
  }

  private calcSlotHat(): number {
    const s = this.mod(7);
    const phase = this.shortNoise
      ? ((this.noise & 1) ? 0x2d0 : 0x234)
      : ((this.noise & 1) ? 0x34 : 0xd0);
    return this.toLinear(s.waveTable[phase], s, 0);
  }

  private updateOutput(): void {
    this.updateAmPm();
    this.updateShortNoise();
    this.updateSlots();
    const out = this.chOut;

    for (let i = 0; i < 6; i++) out[i] = (-this.calcSlotCar(i, this.calcSlotMod(i)) >> 1);

    if (!this.rhythmMode) out[6] = (-this.calcSlotCar(6, this.calcSlotMod(6)) >> 1);
    else out[9] = this.calcSlotCar(6, this.calcSlotMod(6));
    this.updateNoise(14);

    if (!this.rhythmMode) {
      out[7] = (-this.calcSlotCar(7, this.calcSlotMod(7)) >> 1);
    } else {
      out[10] = this.calcSlotHat();
      out[11] = this.calcSlotSnare();
    }
    this.updateNoise(2);

    if (!this.rhythmMode) {
      out[8] = (-this.calcSlotCar(8, this.calcSlotMod(8)) >> 1);
    } else {
      out[12] = this.calcSlotTom();
      out[13] = this.calcSlotCym();
    }
    this.updateNoise(2);

    let mix = 0;
    for (let i = 0; i < 14; i++) mix += out[i];
    this.mixOut = (mix << 16) >> 16;

    if (this.v20Mix) {
      let melody = 0;
      for (let i = 0; i < 9; i++) melody += out[i];
      let rhythm = 0;
      for (let i = 9; i < 14; i++) rhythm += out[i];
      this.v20Out = Math.max(-4096, Math.min(4095.875, melody * 0.5 + rhythm));
    }
  }

  calcSample(): number {
    this.updateOutput();
    return this.mixOut;
  }

  private outputSample(): number {
    this.updateOutput();
    return this.v20Mix ? this.v20Out : this.mixOut;
  }

  private readonly ring: Float32Array;
  private ringWrite = 0;
  private ringRead = 0;
  private cycleRemainder = 0;

  private resamplePhase = 0;
  private prevSample = 0;
  private nextSample = 0;

  private pendingCycles = 0;
  private pendingClock = 1;

  tick(cycles: number, cpuClock: number): void {
    this.pendingCycles += cycles;
    this.pendingClock = cpuClock;
    if (this.pendingCycles * 1000 >= cpuClock) this.flush();
  }

  private flush(): void {
    const cycles = this.pendingCycles;
    if (cycles === 0) return;
    this.pendingCycles = 0;
    this.advance(cycles, this.pendingClock);
  }

  private advance(cycles: number, cpuClock: number): void {
    this.cycleRemainder += cycles * this.rate;
    let frames = Math.floor(this.cycleRemainder / cpuClock);
    if (frames <= 0) return;
    this.cycleRemainder -= frames * cpuClock;
    const step = YM2413_RATE / this.rate;
    while (frames-- > 0) {
      let v: number;
      if (step === 1) {
        v = this.outputSample();
      } else {
        this.resamplePhase += step;
        while (this.resamplePhase >= 1) {
          this.prevSample = this.nextSample;
          this.nextSample = this.outputSample();
          this.resamplePhase -= 1;
        }
        v = this.prevSample + (this.nextSample - this.prevSample) * this.resamplePhase;
      }
      const s = (v / 4096) * this.gain;
      this.ring[this.ringWrite] = s;
      this.ring[this.ringWrite + 1] = s;
      this.ringWrite = (this.ringWrite + 2) % this.ring.length;
    }
    const avail = (this.ringWrite - this.ringRead + this.ring.length) % this.ring.length;
    if (avail > this.ring.length - 2048) {
      this.ringRead = (this.ringWrite - 2048 + this.ring.length) % this.ring.length;
    }
  }

  buffered(): number {
    this.flush();
    return ((this.ringWrite - this.ringRead + this.ring.length) % this.ring.length) >> 1;
  }

  readAudio(out: Float32Array, frames: number): number {
    const have = Math.min(frames, this.buffered());
    for (let i = 0; i < have * 2; i++) {
      out[i] = this.ring[this.ringRead];
      this.ringRead = (this.ringRead + 1) % this.ring.length;
    }
    for (let i = have * 2; i < frames * 2; i++) out[i] = 0;
    return have;
  }
}
