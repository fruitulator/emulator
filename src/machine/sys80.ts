import type { Machine, MachineDisplay, CabinetSwitch, CashLedger, DigitKind } from './machine';
import { newCashLedger, ledgerOutMults, dilSwitchLabel } from './machine';
import { Reel } from '../hw/reel';
import { MeterConfirm } from '../hw/meterconfirm';
import { Tms9995, type Tms9995Bus } from '../cpu/tms9995';
import { Tms9902 } from '../hw/tms9902';
import { Ay8910, AY_RATE } from '../hw/ay8910';
import { OneBitSpeaker } from '../hw/speaker';
import { BASE_BOARD_BASS_FREQ } from '../hw/blipleak';
import { Mixer } from '../hw/mixer';
import type { ReelGeometry } from './layoutreels';
import type { LayoutSwitch } from './layoutswitches';
import { opticWindowForFlag } from '../layout/datreels';
import { PortType, type PortEntry } from '../layout/sys80ports';

export { PortType, type PortEntry } from '../layout/sys80ports';
import type { BoardPart } from './parts';
import { resetReelsInPlace } from './v20optic';
import { StrayCounter } from './strayaccess';
import { noteRomCut } from './boarddefaults';

const CLOCK = 2_500_000;
const RAM_LO = 0x3000;
const RAM_HI = 0x4000;
const INT1_PERIOD = 1042;
const INT2_PERIOD = 25000;
const REFRESH_TICK = 800;
const METER_TICK_CYCLES = 5000;
const SEG_DATA_PERSIST = 15;
const SEG_BCD_PERSIST = 30;
const BCD7 = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
const LAMP_COUNT = 320;
const REEL_COUNT = 4;

const REEL_STAND_IN_HALF_STEPS = 96;
const REEL_STAND_IN_STOPS = 12;
export const REEL_ADJUST = 7;

const SYS80_NIBBLE = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];

const V20_STEP: readonly (readonly number[])[] = [
  [0, 0, 2, 1, 0, 0, 3, 0, -2, -1, 0, 0, -3, 0, 0, 0],
  [0, -1, 1, 0, 3, 0, 2, 0, -3, -2, 0, 0, 0, 0, 0, 0],
  [0, -2, 0, -1, 2, 0, 1, 0, 0, -3, 0, 0, 3, 0, 0, 0],
  [0, -3, -1, -2, 1, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0],
  [0, 0, -2, -3, 0, 0, -1, 0, 2, 3, 0, 0, 1, 0, 0, 0],
  [0, 3, -3, 0, -1, 0, -2, 0, 1, 2, 0, 0, 0, 0, 0, 0],
  [0, 2, 0, 3, -2, 0, -3, 0, 0, 1, 0, 0, -1, 0, 0, 0],
  [0, 1, 3, 2, -3, 0, 0, 0, -1, 0, 0, 0, -2, 0, 0, 0],
];

export function defaultPortMap(): PortEntry[] {
  const map: PortEntry[] = [];
  for (let p = 0; p < 512; p++) map.push({ type: PortType.Lamp, value: 0 });
  for (let p = 0; p <= 0xf; p++) map[p] = { type: PortType.ReelPort, value: 0 };
  for (let p = 0xa8; p <= 0xaf; p++) map[p] = { type: PortType.SegDigit, value: 8 + (p - 0xa8) };
  for (let p = 0xb0; p <= 0xb7; p++) map[p] = { type: PortType.SegDigit, value: 16 + (p - 0xb0) };
  for (let p = 0xb8; p <= 0xbf; p++) map[p] = { type: PortType.Seg, value: p - 0xb8 };
  for (let p = 0x138; p <= 0x13b; p++) map[p] = { type: PortType.Bcd, value: p - 0x138 };
  map[0x13c] = { type: PortType.BcdDigit, value: 1 };
  map[0x13d] = { type: PortType.BcdDigit, value: 0 };
  return map;
}

const BITREV = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let r = 0;
  for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 0x80 >> b;
  BITREV[i] = r;
}

interface Sys80Reel {
  pos: number;
  steps: number;
  prev: number;
  present: boolean;
  optoStart: number;
  optoWidth: number;
  inverted: boolean;
}

export class Sys80 implements Machine {
  static readonly snapshotConfig: readonly string[] = ['switches'];

  readonly digitKind: DigitKind = 'words';
  readonly clockHz: number = CLOCK;
  readonly reelsByLayoutNumber = true;

  protected readonly cpu: Tms9995;
  private readonly duart = new Tms9902();
  private static readonly AY_CLOCK = 10_000_000 / 8;
  private readonly ay = new Ay8910(Sys80.AY_CLOCK);
  protected readonly speaker = new OneBitSpeaker(CLOCK, AY_RATE, { bassFreq: BASE_BOARD_BASS_FREQ });
  private readonly mixer = new Mixer([this.ay, this.speaker]);
  readonly memory = new Uint8Array(0x10000);
  portMap: PortEntry[] = defaultPortMap();
  portMapFromLayout = false;

  setPortMap(map: PortEntry[] | null): void {
    if (!map || map.length !== 512) return;
    this.portMap = map;
    this.portMapFromLayout = true;
  }

  readonly lamps = new Uint8Array(LAMP_COUNT);
  readonly digits = new Uint16Array(24);
  protected readonly digitTime = new Uint8Array(24);
  readonly meters = new Uint32Array(8);
  protected readonly meterBank = new MeterConfirm();
  readonly triacPulses = new Uint32Array(8);
  get triacLevels(): number {
    return this.triacs & 0xff;
  }

  private readonly ledger = newCashLedger();
  private meterInPence: number[] = [];
  private meterOutPence: number[] = [];
  private tokenInMeter = -1;
  private tokenOutMeter = -1;
  get cashLedger(): CashLedger | undefined {
    return this.meterInPence.length ? this.ledger : undefined;
  }

  static readonly METER_UNIT_PENCE = 10;

  setMeterMoney(inMult: readonly number[], outMult: readonly number[]): void {
    this.meterInPence = inMult.map((x) => x * Sys80.METER_UNIT_PENCE);
    this.meterOutPence = ledgerOutMults({ in: inMult, out: outMult })[0].map((x) => x * Sys80.METER_UNIT_PENCE);
    const second = (mult: readonly number[]): number => mult.flatMap((x, i) => (x ? [i] : []))[1] ?? -1;
    this.tokenInMeter = second(inMult);
    this.tokenOutMeter = second(outMult);
  }

  private bookMeter(i: number): void {
    const inP = this.meterInPence[i] ?? 0;
    const outP = this.meterOutPence[i] ?? 0;
    if (inP) {
      if (i === this.tokenInMeter) this.ledger.tokenInPence += inP;
      else this.ledger.inPence += inP;
    }
    if (outP) {
      if (i === this.tokenOutMeter) this.ledger.tokenOutPence += outP;
      else this.ledger.outPence += outP;
    }
  }

  protected readonly sreels: Sys80Reel[] = [];
  readonly reels: Reel[] = [];
  readonly display: MachineDisplay | null = null;
  get audioSource(): Mixer { return this.mixer; }

  protected readonly matrix = new Uint8Array(4);
  protected dip1 = 0;
  protected dip3 = 0;
  private rotary = 0;
  protected switches: LayoutSwitch[] = [];

  protected reelport = 0;
  protected lastReelport = -1;
  private soundport = 0;
  protected extport = 0;
  protected bcd = 0;
  protected triacs = 0;
  protected meterLines = 0;
  get meterLevels(): number { return this.meterLines & 0xff; }
  private readonly ledShift = new Uint8Array(16);
  private readonly ledData = new Uint8Array(16);
  protected lev1Int = 0;
  protected lev2Int = 0;
  protected intPending = 0;
  protected cyc1 = 0;
  protected cyc2 = 0;
  protected refresh = 0;

  constructor(roms: readonly Uint8Array[], nvram?: Uint8Array) {
    let off = 0;
    for (const r of roms) { this.memory.set(r.subarray(0, Math.max(0, RAM_LO - off)), off); off += r.length; }
    noteRomCut(this, off, RAM_LO);
    if (nvram) this.memory.set(nvram.subarray(0, RAM_HI - RAM_LO), RAM_LO);
    for (let i = 0; i < REEL_COUNT; i++) {
      this.sreels.push({
        pos: 0, steps: REEL_STAND_IN_HALF_STEPS, prev: 0, present: false,
        optoStart: 7, optoWidth: 1, inverted: false,
      });
      this.reels.push(new Reel({
        stepsPerRevolution: REEL_STAND_IN_HALF_STEPS, symbols: REEL_STAND_IN_STOPS,
      }));
    }
    const bus: Tms9995Bus = {
      read8: (a) => this.busRead(a),
      write8: (a, v) => this.busWrite(a, v),
      cruRead: (b) => this.readPort(b),
      cruWrite: (b, v) => this.writePort(b, v),
    };
    this.cpu = new Tms9995(bus, { variant: '9980a' });
  }

  setReelGeometry(geometry: readonly ReelGeometry[]): void {
    for (const g of geometry) {
      if (g.number < 0 || g.number >= REEL_COUNT) continue;
      const r = this.sreels[g.number];
      r.present = true;
      if (g.halfSteps > 0) r.steps = g.halfSteps;
      else this.noteReelStandIn(g.number);
      r.inverted = g.invertedOpto;
      const w = opticWindowForFlag(g.optoTab);
      r.optoStart = w.start;
      r.optoWidth = w.width;
      if (!(g.stops > 0)) this.noteReelStandIn(g.number);
      this.reels[g.number] = new Reel({
        stepsPerRevolution: r.steps,
        symbols: g.stops > 0 ? g.stops : REEL_STAND_IN_STOPS,
      });
    }
  }

  readonly reelStandIns: number[] = [];

  private noteReelStandIn(n: number): void {
    if (this.reelStandIns.includes(n)) return;
    this.reelStandIns.push(n);
    this.reelStandIns.sort((a, b) => a - b);
  }

  setReelPosition(i: number, pos: number): void {
    const r = this.sreels[i];
    if (!r) return;
    r.pos = ((pos % r.steps) + r.steps) % r.steps;
    this.reels[i].position = r.pos;
  }

  setDips(d1: number, d3: number): void { this.dip1 = d1 & 0xff; this.dip3 = d3 & 0xff; }

  setRotary(n: number): void { this.rotary = n & 0xf; }

  setSwitches(sw: LayoutSwitch[]): void {
    this.switches = sw;
    for (const s of sw) if (s.closed) this.layoutInput(s.number, true);
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (id < 0 || id >= Sys80.DIL_ID_BASE) return;
    this.layoutInput(id, made);
    if (this.switches.length && !this.switches.some((s) => s.number === id)) {
      this.switches = [...this.switches, { number: id, label, closed: made }];
    }
  }

  get switchPanel(): CabinetSwitch[] {
    const rows: CabinetSwitch[] = this.switches.map((s) => ({
      id: s.number, label: s.label,
      on: ((this.matrix[(s.number >> 3) & 3] >> (s.number & 7)) & 1) === 1,
    }));
    return rows.concat(this.optionRows());
  }

  protected optionRows(): CabinetSwitch[] {
    const rows: CabinetSwitch[] = [];
    for (let i = 0; i < 12; i++) {
      const eight = i < 8;
      const bank = eight ? this.dip1 : this.dip3;
      const bit = eight ? i : i - 8;
      rows.push({
        id: Sys80.DIL_ID_BASE + i,
        label: dilSwitchLabel(eight ? `8-way DIL ${bit + 1}` : `4-way DIL ${bit + 1}`,
          this.dilLabels?.[eight ? bit : 16 + bit]),
        on: (bank & (1 << bit)) !== 0,
        group: 'DIL switches',
        bootOnly: true,
        option: true,
      });
    }
    return rows;
  }

  protected dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  protected static readonly DIL_ID_BASE = 64;

  powerCycle(): void {
    this.reset();
  }

  reset(): void {
    this.refresh = 0;
    this.cyc1 = this.cyc2 = 0;
    this.lev1Int = this.lev2Int = 0;
    this.intPending = 0;
    this.reelport = this.soundport = this.extport = this.bcd = 0;
    this.lastReelport = -1;
    this.triacs = this.meterLines = 0;
    this.meterBank.reset();
    this.ledShift.fill(0);
    this.ledData.fill(0);
    this.duart.reset();
    this.ay.reset();
    this.speaker.reset();
    for (const r of this.sreels) r.prev = 0;
    resetReelsInPlace(this.reels);
    this.lamps.fill(0);
    this.digits.fill(0);
    this.digitTime.fill(0);
    this.cpu.reset();
  }

  protected busRead(a: number): number {
    a &= 0xffff;
    if (a < RAM_LO || (a >= 0x3400 && a < RAM_HI)) return this.memory[a];
    this.strays.hit(a);
    return 0;
  }

  readonly strays = new StrayCounter();

  protected busWrite(a: number, v: number): void {
    a &= 0xffff;
    if (a >= RAM_LO && a < RAM_HI) this.memory[a] = v & 0xff;
    else if (a >= RAM_HI) this.strays.hit(a);
  }

  protected optos(): number {
    let o = 0;
    for (let i = 0; i < REEL_COUNT; i++) {
      const r = this.sreels[i];
      const inTab = ((r.pos - r.optoStart + r.steps) % r.steps) < r.optoWidth;
      if (inTab !== r.inverted) o |= 1 << i;
    }
    return o;
  }

  protected readPort(addr: number): number {
    switch (addr & 0x1e0) {
      case 0x000: {
        this.matrix[0] = (this.matrix[0] & 0xf0) | (this.optos() ^ 0xf);
        return (this.matrix[(addr >> 3) & 3] >> (addr & 7)) & 1;
      }
      case 0x020: {
        let v = 0xff;
        if (addr < 0x28) v = (this.rotary << 4) | (this.dip3 & 0xf);
        else if (addr < 0x30) v = this.dip1;
        return (v >> (addr & 7)) & 1;
      }
      case 0x140:
        return 1;
      case 0x1e0:
        return this.duart.cruRead(addr & 0x1f);
      default:
        return 1;
    }
  }

  protected writePort(addr: number, value: number): void {
    value &= 1;
    switch (addr & 0x1f0) {
      case 0x050:
        switch (addr) {
          case 0x50:
            if (this.lev1Int !== value && !this.lev1Int) { this.cpu.setLevel(1, false); this.intPending &= ~1; }
            this.lev1Int = value;
            return;
          case 0x51:
            if (this.lev2Int !== value && !this.lev2Int) { this.cpu.setLevel(2, false); this.intPending &= ~2; }
            this.lev2Int = value;
            return;
          default:
            return;
        }
      case 0x140:
      case 0x150:
        if (addr < 0x148) {
          const mask = 1 << (addr - 0x140);
          this.soundport = (this.soundport & ~mask) | (value ? mask : 0);
        } else if (addr === 0x149 && value) {
          this.ay.write(this.soundport);
        } else if (addr === 0x14a && value) {
          this.ay.selectAddress(this.soundport);
        }
        return;
      case 0x1e0:
      case 0x1f0:
        this.duart.cruWrite(addr & 0x1f, value);
        return;
      default:
        this.writeMapped(addr & 0x1ff, value);
    }
  }

  readonly portWrites = new Uint32Array(512);

  protected writeMapped(port: number, value: number): void {
    this.portWrites[port]++;
    const e = this.portMap[port];
    switch (e.type) {
      case PortType.Lamp:
      case PortType.Debug: {
        const n = e.value || port;
        if (n < LAMP_COUNT) this.lamps[n] = value ? 0xff : 0;
        return;
      }
      case PortType.Meter: {
        if (e.value < 1 || e.value > 16) return;
        const mask = 1 << (e.value - 1);
        const next = (this.meterLines & ~mask) | (value ? mask : 0);
        if (next !== this.meterLines) this.meterBank.write(next);
        this.meterLines = next;
        return;
      }
      case PortType.Triac:
      case PortType.TriacLamp: {
        if (e.value >= 1 && e.value <= 8) {
          const mask = 1 << (e.value - 1);
          if (value && !(this.triacs & mask)) this.triacPulses[e.value - 1]++;
          this.triacs = (this.triacs & ~mask) | (value ? mask : 0);
        }
        if (e.type === PortType.TriacLamp && port < LAMP_COUNT) this.lamps[port] = value ? 0xff : 0;
        return;
      }
      case PortType.Seg: {
        const mask = 1 << (e.value & 7);
        if (e.value & 8) value ^= 1;
        this.extport = (this.extport & ~mask) | (value ? mask : 0);
        return;
      }
      case PortType.Bcd: {
        const mask = 1 << (e.value & 7);
        if (e.value & 8) value ^= 1;
        this.bcd = (this.bcd & ~mask) | (value ? mask : 0);
        return;
      }
      case PortType.ReelPort: {
        const mask = 1 << (port & 0xf);
        this.reelport = (this.reelport & ~mask) | (value ? mask : 0);
        if ((port & 3) === 3 && this.reelport !== this.lastReelport) {
          this.driveReels(this.reelport);
          this.lastReelport = this.reelport;
        }
        return;
      }
      case PortType.LedData:
        this.ledData[e.value & 0xf] = value ? 0 : 0x80;
        return;
      case PortType.LedShift: {
        if (!value) return;
        const u = (e.value & 7) * 2;
        this.ledShift[u] = (this.ledShift[u] >> 1) | this.ledData[u];
        this.ledShift[u + 1] = (this.ledShift[u + 1] >> 1) | this.ledData[u + 1];
        return;
      }
      case PortType.LedLatch: {
        if (!value) return;
        const u = (e.value & 7) * 2;
        const seg = BITREV[this.ledShift[u]];
        const sel = this.ledShift[u + 1];
        for (let i = 0; i < 8; i++) if (sel & (1 << i)) this.digits[7 - i] = seg;
        return;
      }
      case PortType.SegDigit: {
        if (!value) return;
        const pos = (e.value >> 3) * 8 + (e.value & 7);
        const d = ~this.extport & 0xff;
        if (d && pos < this.digits.length) { this.digitTime[pos] = SEG_DATA_PERSIST; this.digits[pos] = d; }
        return;
      }
      case PortType.BcdDigit: {
        if (!value) return;
        const d = this.bcd < 10 ? BCD7[this.bcd] : 0;
        if (d && e.value < this.digits.length) { this.digitTime[e.value] = SEG_BCD_PERSIST; this.digits[e.value] = d; }
        return;
      }
      case PortType.Sound:
        if (e.value <= 1) this.speaker.write(e.value, value);
        return;
      default:
        return;
    }
  }

  protected driveReels(word: number): void {
    for (let i = 0; i < REEL_COUNT; i++) {
      const r = this.sreels[i];
      if (!r.present) continue;
      const x = SYS80_NIBBLE[(word >> (i * 4)) & 0xf];
      if (x === 0 || (((r.prev ^ x) + 1) & 0xf) <= 1) continue;
      const d = V20_STEP[r.pos & 7][x];
      r.prev = x;
      if (d === 0) continue;
      r.pos = (r.pos + d + r.steps) % r.steps;
      this.reels[i].position = r.pos;
      this.reels[i].travel += d;
    }
  }

  step(): number {
    const c = this.cpu.step();
    this.tickMeters(c);
    if (++this.refresh >= 100000) this.refresh = 0;
    if (this.refresh % REFRESH_TICK === 0) this.ageSeg();
    this.cyc1 += c;
    this.cyc2 += c;
    this.duart.tick(c);
    this.ay.tick(c, CLOCK);
    this.speaker.tick(c);
    if (this.duart.int) {
      this.intPending |= 4;
    } else {
      this.intPending &= ~4;
      this.cpu.setLevel(3, false);
    }
    if (this.cyc1 > INT1_PERIOD) { this.cyc1 -= INT1_PERIOD; this.intPending |= 1; }
    if (this.cyc2 > INT2_PERIOD) { this.cyc2 -= INT2_PERIOD; this.intPending |= 2; }
    if (this.intPending & 1) this.cpu.setLevel(1, true);
    else if (this.intPending & 2) this.cpu.setLevel(2, true);
    else if (this.intPending & 4) this.cpu.setLevel(3, true);
    if (this.coinTimer > 0) {
      const was = this.coinTimer;
      this.coinTimer -= c;
      if (was > COIN_GAP && this.coinTimer <= COIN_GAP && this.coinInput >= 0) {
        this.layoutInput(this.coinInput, false);
        this.coinInput = -1;
      }
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  protected tickMeters(c: number): void {
    const confirmed = this.meterBank.advance(c, METER_TICK_CYCLES);
    if (!confirmed) return;
    for (let i = 0; i < 16; i++) {
      if (!(confirmed & (1 << i))) continue;
      if (i < 8) this.meters[i]++;
      this.bookMeter(i);
    }
  }

  protected ageSeg(): void {
    for (let i = 0; i < this.digitTime.length; i++) {
      if (this.digitTime[i] > 0 && --this.digitTime[i] === 0) this.digits[i] = 0;
    }
  }

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: '320 LAMPS', part: 'direct drive, CRU ports', device: this.lamps },
      { id: 'switches', label: 'SWITCH MATRIX', part: '4 rows x 8 + DIP 1/3', device: this.matrix },
      { id: 'sevenseg', label: '7-SEG', part: '2 BCD + 16 segment digits', device: this.digits },
      { id: 'meters', label: 'METERS', part: 'pulse counts', device: this.meters },
      { id: 'coins', label: 'COIN INPUTS', part: '10p 20p 20p 50p - lines 19-22', modelled: true,
        note: 'Modelled as timed matrix pulses (insertCoin), not as a mech.' },
      { id: 'ports', label: 'CRU OUTPUT PORTS', part: '512 lines - meaning per set (layout tag $9C)', device: this.portWrites },
      { id: 'iocard', label: 'I/O CARD', part: 'CRU $00-$1F - matrix + reel optos', device: this.matrix },
      { id: 'ram', label: 'BATTERY RAM', part: '4K at $3000', device: this.memory },
      { id: 'rom', label: 'PROGRAM ROM', part: 'up to 12K from $0000', device: this.memory },
      { id: 'ay', label: 'SOUND', part: 'AY-3-8910 - CRU $140', device: this.ay },
      { id: 'speaker', label: 'SPEAKER', part: '1-bit - "Sound" port type', device: this.speaker },
      { id: 'cpu', label: 'CPU', part: 'TMS9980A - 2.5 MHz', device: this.cpu, cpu: true },
      { id: 'uart', label: 'RS232', part: 'TMS9902 - CRU $1E0', device: this.duart },
      { id: 'reels', label: '4 REELS', part: 'stepper, CRU $00-$0F', device: this.sreels },
      { id: 'hopper', label: 'HOPPER', part: 'not modelled' },
    ];
  }

  layoutLamp(n: number): boolean {
    return n >= 0 && n < this.lamps.length && this.lamps[n] !== 0;
  }

  layoutDigit(n: number): number {
    return n >= 0 && n < this.digits.length ? this.digits[n] : 0;
  }

  layoutInput(id: number, on: boolean): void {
    if (id >= Sys80.DIL_ID_BASE && id < Sys80.DIL_ID_BASE + 12) {
      const n = id - Sys80.DIL_ID_BASE;
      if (n < 8) {
        const mask = 1 << n;
        this.dip1 = on ? this.dip1 | mask : this.dip1 & ~mask & 0xff;
      } else {
        const mask = 1 << (n - 8);
        this.dip3 = on ? this.dip3 | mask : this.dip3 & ~mask & 0xff;
      }
      return;
    }
    if (id < 0 || id > 31) return;
    const row = (id >> 3) & 3;
    const b = id & 7;
    if (on) this.matrix[row] |= 1 << b;
    else this.matrix[row] &= ~(1 << b);
  }

  insertCoin(bit: number): void {
    if (this.coinTimer > 0 || bit < 0 || bit > 31) return;
    this.coinInput = bit;
    this.layoutInput(bit, true);
    this.coinTimer = COIN_HOLD + COIN_GAP;
  }
  protected coinTimer = 0;
  protected coinInput = -1;
  get coinBusy(): boolean { return this.coinTimer > 0; }
}

const COIN_HOLD = Math.round(0.15 * CLOCK);
const COIN_GAP = Math.round(0.15 * CLOCK);
