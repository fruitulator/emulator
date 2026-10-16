import { Reel } from '../hw/reel';
import { MeterConfirm } from '../hw/meterconfirm';
import type { CabinetSwitch, CashLedger, CoinChute, Machine, NamedCoin } from './machine';
import { newCashLedger } from './machine';
import { CoinBook, SlotCoins, coinName, coinOfNote, type BookedCoin } from './coinbook';
import { COIN_RAW, coinMatrixSteps } from './coinraw';
import type { SlideEffect } from '../layout/fmlconfig';
import type { BoardPart } from './parts';
import type { Schematic } from './schematic';
import { electroBoxes, electroSchematic, nodeId, partOf } from './schematics/electro';
import type { LayoutSwitch } from './layoutswitches';
import type { ReelGeometry } from './layoutreels';

export const enum T {
  NONE = 0, SWITCH = 1, MOTOR = 2, RAIL = 3, LAMP = 4, SOLENOID = 5, RELAY = 6, CAM = 7,
  METER = 8, FUSE = 9, REEL = 0x0a, WIPER = 0x0b, BELL = 0x0c, CONTACT = 0x0d,
  REELWIPER = 0x0e, HOPPER = 0x0f, STEPPER = 0x10, REELMECH = 0x11, WIPERCONTACT = 0x12,
  CONNECTIONS = 0x13, NODE = 0x14, SOUNDON = 0x15, SOUNDOFF = 0x16, CREDITCOUNTER = 0x17,
  CAPACITOR = 0x18, RESISTOR = 0x19, DIODE = 0x1a, REELMOTOR = 0x1b,
}

const KEYWORDS: ReadonlyMap<string, number> = new Map([
  ['None', T.NONE], ['Switch', T.SWITCH], ['Motor', T.MOTOR], ['Rail', T.RAIL],
  ['Lamp', T.LAMP], ['Solenoid', T.SOLENOID], ['Relay', T.RELAY], ['Cam', T.CAM],
  ['Meter', T.METER], ['Fuse', T.FUSE], ['Reel', T.REEL], ['Wiper', T.WIPER],
  ['Bell', T.BELL], ['Contact', T.CONTACT], ['ReelWiper', T.REELWIPER], ['Hopper', T.HOPPER],
  ['Stepper', T.STEPPER], ['ReelMech', T.REELMECH], ['WiperContact', T.WIPERCONTACT],
  ['Connections', T.CONNECTIONS], ['Node', T.NODE], ['SoundOn', T.SOUNDON],
  ['SoundOff', T.SOUNDOFF], ['CreditCounter', T.CREDITCOUNTER], ['Capacitor', T.CAPACITOR],
  ['Resistor', T.RESISTOR], ['Diode', T.DIODE], ['ReelMotor', T.REELMOTOR], ['Counter', T.METER],
]);

export const ELECTRO_CLOCK = 1_000_000;
export const TICK_CYCLES = 20;
const INPUT_TICKS = 1000;
const MOTOR_TICKS = 50;
const COIN_HOLD = 70_000;
const COIN_GAP = 50_000;

const LAMP_COUNT = 0x200;
const LAMP_SOLENOID = 0x20;
const LAMP_PARENTED_SOLENOID = 0x30;
const LAMP_RELAY = 0x40;
const LAMP_BELL = 0x78;
const LAMP_MOTOR = 0x80;

export class Term {
  net: Net | null = null;
  constructor(readonly owner: Comp, readonly name: string) {}
}

export class Net {
  readonly terms: Term[] = [];
  constructor(readonly id: number, readonly colour: number) {}
  add(t: Term): void {
    if (t.owner.type === T.RAIL) this.terms.unshift(t);
    else this.terms.push(t);
  }
}

export class Comp {
  id = 0;
  index = 0;
  parent: Comp | null = null;
  readonly terms: Term[] = [];
  res = 0;
  rated = 0;
  live = 0;
  flag = false;
  soundOn = -1;
  soundOff = -1;

  readonly contacts: Comp[] = [];
  readonly cams: Comp[] = [];
  readonly wipers: Comp[] = [];
  readonly motors: Comp[] = [];
  readonly reels: Comp[] = [];
  readonly solenoids: Comp[] = [];

  rpm = 0;
  period = 0;
  start = 0;
  dirInit = 1;

  stops = 0;
  step = 0;

  studs = 0;
  width = 0;
  table: Int16Array | null = null;
  readonly byStud: (Comp | null)[] = [];
  stud = 0;

  map: Uint8Array | null = null;

  count = 0;
  limit = false;

  constructor(readonly type: number, readonly name: string) {}

  term(name: string): Term {
    const t = new Term(this, name);
    this.terms.push(t);
    return t;
  }

  path(t: Term): string {
    let s = t.name;
    for (let c: Comp | null = this; c; c = c.parent) s = `${c.name}.${s}`;
    return s;
  }
}

export class Circuit {
  readonly all: Comp[] = [];
  readonly motors: Comp[] = [];
  readonly mechMotors: Comp[] = [];
  readonly switches: Comp[] = [];
  readonly relays: Comp[] = [];
  readonly meters: Comp[] = [];
  readonly lamps: Comp[] = [];
  readonly rails: Comp[] = [];
  readonly solenoids: Comp[] = [];
  readonly fuses: Comp[] = [];
  readonly bells: Comp[] = [];
  readonly contactList: Comp[] = [];
  readonly reelList: Comp[] = [];
  readonly mechs: Comp[] = [];
  readonly creditCounters: Comp[] = [];
  readonly hoppers: Comp[] = [];
  readonly steppers: Comp[] = [];
  readonly passives: Comp[] = [];
  readonly nets: Net[] = [];
  readonly problems: string[] = [];

  add(c: Comp): Comp {
    c.id = this.all.length;
    this.all.push(c);
    return c;
  }
}

class Scanner {
  pos = 0;
  constructor(readonly s: string) {}

  private ws(): void {
    while (this.pos < this.s.length && /\s/.test(this.s[this.pos])) this.pos++;
  }

  get eof(): boolean {
    this.ws();
    return this.pos >= this.s.length;
  }

  word(): string | null {
    this.ws();
    const a = this.pos;
    while (this.pos < this.s.length && !/\s/.test(this.s[this.pos])) this.pos++;
    return this.pos > a ? this.s.slice(a, this.pos) : null;
  }

  quoted(): string | null {
    this.ws();
    if (this.s[this.pos] !== '"') return null;
    const a = this.pos + 1;
    let p = a;
    while (p < this.s.length && this.s[p] !== '"' && this.s[p] !== '\n') p++;
    if (p === a) { this.pos = a; return null; }
    this.pos = p;
    if (this.s[p] !== '"') return null;
    this.pos = p + 1;
    return this.s.slice(a, p);
  }

  int(): number | null {
    this.ws();
    const m = /^[+-]?\d+/.exec(this.s.slice(this.pos, this.pos + 24));
    if (!m) return null;
    this.pos += m[0].length;
    return parseInt(m[0], 10);
  }
}

export function camMap(spec: string): Uint8Array {
  const map = new Uint8Array(360);
  let i = 0;
  let a = -1;
  let n = 0;
  let dash = false;
  for (;;) {
    const ch = spec[i];
    if (ch === ' ') { i++; continue; }
    if (ch === '-') { dash = true; a = n; n = 0; i++; continue; }
    if (ch !== undefined && ch >= '0' && ch <= '9') {
      while (spec[i] !== undefined && spec[i] >= '0' && spec[i] <= '9') n = n * 10 + (spec.charCodeAt(i++) - 48);
      continue;
    }
    if (ch !== ',' && ch !== undefined) { i++; continue; }
    let b: number;
    if (dash) { dash = false; b = n; } else { a = n; b = n + 1; }
    n = 0;
    if (a >= 0 && a < 360 && a < b && b <= 360) map.fill(1, a, b);
    a = -1;
    if (ch === undefined) break;
    i++;
  }
  return map;
}

function studTable(studs: number, width: number): Int16Array {
  const t = new Int16Array(720).fill(-1);
  const spacing = studs > 0 ? Math.trunc(360 / studs) : 0;
  for (let a = 0; a < 360; a++) {
    let lo = -width;
    let hi = width;
    let found = false;
    for (let i = 0; i <= studs; i++) {
      if (lo <= a && a <= hi) {
        const s = i % studs;
        if (!found) { t[a * 2] = s; found = true; }
        t[a * 2 + 1] = s;
      }
      lo += spacing;
      hi += spacing;
    }
  }
  return t;
}

export function parseNetlist(bytes: Uint8Array): Circuit {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  const sc = new Scanner(text);
  const c = new Circuit();
  const v: Record<string, number> = {};
  const num = (slot: string): number => {
    const n = sc.int();
    if (n !== null) v[slot] = n;
    return v[slot] ?? 0;
  };
  let name = '';
  const stack: number[] = [];
  const open: Partial<Record<number, Comp>> = {};
  let net: Net | null = null;
  let last: Comp | null = null;

  const attach = (comp: Comp, parent: Comp, list: Comp[]): void => {
    comp.parent = parent;
    list.push(comp);
  };

  while (!sc.eof) {
    const kw = sc.word();
    if (kw === null) break;
    const q = sc.quoted();
    if (q !== null) name = q;
    const type = KEYWORDS.get(kw) ?? T.NONE;
    if (type === T.NONE) {
      if (kw === 'End') {
        const what = sc.word() ?? '';
        const t = KEYWORDS.get(what) ?? T.NONE;
        if (!stack.length) c.problems.push(`End ${what} without start!!`);
        else if (stack[stack.length - 1] === t) {
          stack.pop();
          if (t === T.CONNECTIONS) net = null;
          else delete open[t];
        } else c.problems.push(`End ${what} for start ${stack[stack.length - 1]} !!`);
      } else c.problems.push(`Invalid Type ${kw}`);
      continue;
    }
    if (type !== T.NODE && type !== T.SOUNDON && type !== T.SOUNDOFF) stack.push(type);
    let made: Comp | null = null;
    switch (type) {
      case T.RAIL: {
        const t1 = sc.quoted() ?? '';
        const volts = num('218');
        made = c.add(new Comp(T.RAIL, name));
        made.term(t1);
        made.live = volts;
        made.rated = volts;
        c.rails.push(made);
        break;
      }
      case T.SWITCH: {
        const n = num('23c');
        made = c.add(new Comp(T.SWITCH, name));
        made.flag = n !== 0;
        c.switches.push(made);
        open[T.SWITCH] = made;
        break;
      }
      case T.RELAY: case T.LAMP: case T.METER: case T.BELL: {
        const t1 = sc.quoted() ?? '';
        const t2 = sc.quoted() ?? '';
        const volts = num('218');
        const res = num('21c');
        made = c.add(new Comp(type, name));
        made.term(t1);
        made.term(t2);
        made.rated = volts;
        made.res = res;
        const list = type === T.RELAY ? c.relays : type === T.LAMP ? c.lamps
          : type === T.METER ? c.meters : c.bells;
        made.index = list.length;
        list.push(made);
        if (type === T.RELAY) open[T.RELAY] = made;
        break;
      }
      case T.SOLENOID: {
        const t1 = sc.quoted() ?? '';
        const t2 = sc.quoted() ?? '';
        const mech = open[T.REELMECH];
        const reel = open[T.REEL];
        const cc = open[T.CREDITCOUNTER];
        const st = open[T.STEPPER];
        made = new Comp(T.SOLENOID, name);
        if (mech && reel) {
          made.rated = num('218');
          made.res = num('21c');
          made.index = c.reelList.length - 1;
          attach(made, reel, reel.solenoids);
        } else if (cc || st) {
          made.rated = num('218');
          made.res = num('21c');
          made.flag = num('23c') !== 0;
          const owner = (cc ?? st)!;
          made.index = owner.solenoids.length;
          attach(made, owner, owner.solenoids);
        } else {
          made.rated = num('218');
          made.res = num('21c');
          made.index = c.solenoids.length;
          c.solenoids.push(made);
        }
        made.term(t1);
        made.term(t2);
        c.add(made);
        break;
      }
      case T.FUSE: {
        const t1 = sc.quoted() ?? '';
        const t2 = sc.quoted() ?? '';
        const amps = num('22c');
        made = c.add(new Comp(T.FUSE, name));
        made.term(t1);
        made.term(t2);
        made.rated = amps;
        made.index = c.fuses.length;
        c.fuses.push(made);
        break;
      }
      case T.MOTOR: {
        const t1 = sc.quoted() ?? '';
        const t2 = sc.quoted() ?? '';
        const mech = open[T.REELMECH];
        const hopper = open[T.HOPPER];
        made = new Comp(T.MOTOR, name);
        made.index = c.motors.length;
        if (mech) {
          made.rated = num('218'); made.res = num('21c'); made.rpm = num('224');
          made.dirInit = num('240') < 0 ? -1 : 1;
          made.start = 0;
          attach(made, mech, mech.motors);
          c.mechMotors.push(made);
        } else if (hopper) {
          made.rated = num('218'); made.res = num('21c'); made.rpm = num('224');
          made.start = 0;
          attach(made, hopper, hopper.motors);
          c.motors.push(made);
        } else {
          made.rated = num('218'); made.res = num('21c'); made.rpm = num('224');
          const s = num('244');
          made.start = s < -1 || s > 359 ? 0 : s;
          c.motors.push(made);
        }
        made.period = motorPeriod(made.rpm);
        made.term(t1);
        made.term(t2);
        c.add(made);
        open[T.MOTOR] = made;
        break;
      }
      case T.REELMOTOR: {
        const t1 = sc.quoted() ?? '';
        const t2 = sc.quoted() ?? '';
        const t3 = sc.quoted() ?? '';
        const mech = open[T.REELMECH];
        if (!mech) break;
        made = new Comp(T.REELMOTOR, name);
        made.index = c.motors.length;
        made.rated = num('218'); made.res = num('21c'); made.rpm = num('224');
        made.period = motorPeriod(made.rpm);
        made.term(t1);
        made.term(t2);
        made.term(t3);
        attach(made, mech, mech.motors);
        c.mechMotors.push(made);
        c.add(made);
        open[T.REELMOTOR] = made;
        break;
      }
      case T.CAM: {
        const spec = sc.quoted() ?? '';
        const map = camMap(spec);
        const motor = open[T.MOTOR];
        if (!motor) break;
        made = c.add(new Comp(T.CAM, name));
        made.map = map;
        attach(made, motor, motor.cams);
        open[T.CAM] = made;
        break;
      }
      case T.CONTACT: {
        const t1 = sc.quoted() ?? '';
        const t2 = sc.quoted() ?? '';
        const t3 = sc.quoted() ?? '';
        const parent = open[T.RELAY] ?? open[T.SWITCH] ?? open[T.CAM]
          ?? open[T.CREDITCOUNTER] ?? open[T.HOPPER] ?? open[T.STEPPER];
        if (!parent) break;
        made = new Comp(T.CONTACT, name);
        made.term(t1);
        made.term(t2);
        made.term(t3);
        attach(made, parent, parent.contacts);
        c.add(made);
        c.contactList.push(made);
        break;
      }
      case T.REELMECH: {
        made = c.add(new Comp(T.REELMECH, name));
        c.mechs.push(made);
        open[T.REELMECH] = made;
        break;
      }
      case T.REEL: {
        const stops = num('228');
        const mech = open[T.REELMECH];
        if (!mech) break;
        made = c.add(new Comp(T.REEL, name));
        made.stops = stops;
        made.step = stops > 0 ? Math.trunc(360 / stops) : 0;
        made.index = c.reelList.length;
        attach(made, mech, mech.reels);
        c.reelList.push(made);
        open[T.REEL] = made;
        break;
      }
      case T.REELWIPER: {
        const w = num('234');
        const reel = open[T.REEL];
        if (!open[T.REELMECH] || !reel) break;
        made = c.add(new Comp(T.REELWIPER, name));
        made.studs = reel.stops;
        made.width = w;
        made.table = studTable(made.studs, w);
        for (let i = 0; i < made.studs; i++) made.byStud.push(null);
        attach(made, reel, reel.wipers);
        open[T.REELWIPER] = made;
        break;
      }
      case T.WIPERCONTACT: {
        const rw = open[T.REELWIPER];
        if (!rw || !open[T.REELMECH] || !open[T.REEL]) break;
        made = new Comp(T.WIPERCONTACT, name);
        for (const n of ['C1', 'O1', 'C2', 'O2', 'C3', 'O3', 'C4', 'O4']) made.term(n);
        made.stud = rw.contacts.length;
        if (made.stud < rw.byStud.length) rw.byStud[made.stud] = made;
        attach(made, rw, rw.contacts);
        c.add(made);
        break;
      }
      case T.WIPER: {
        const reel = open[T.REEL];
        const motor = open[T.MOTOR];
        const st = open[T.STEPPER];
        let owner: Comp | null = null;
        let studs: number;
        let width: number;
        if (open[T.REELMECH] && reel) {
          studs = num('230'); width = num('234'); owner = reel;
        } else if (motor) {
          studs = num('230'); width = num('234'); owner = motor;
        } else if (st) {
          studs = v['230'] ?? 0; width = 0; owner = st;
        } else break;
        made = new Comp(T.WIPER, name);
        made.studs = studs;
        made.width = width;
        made.table = studTable(studs, width);
        made.term('C');
        for (let i = 1; i <= studs; i++) made.term(String(i));
        attach(made, owner, owner.wipers);
        c.add(made);
        break;
      }
      case T.CREDITCOUNTER: case T.STEPPER: {
        const a = num('230');
        const f = num('238');
        made = c.add(new Comp(type, name));
        made.count = a;
        made.limit = f !== 0;
        const list = type === T.STEPPER ? c.steppers : c.creditCounters;
        made.index = list.length;
        list.push(made);
        open[type] = made;
        break;
      }
      case T.HOPPER: {
        made = c.add(new Comp(T.HOPPER, name));
        made.index = c.hoppers.length;
        c.hoppers.push(made);
        open[T.HOPPER] = made;
        break;
      }
      case T.CAPACITOR: case T.RESISTOR: case T.DIODE: {
        const t1 = sc.quoted() ?? '';
        const t2 = sc.quoted() ?? '';
        if (type === T.CAPACITOR) num('220');
        else if (type === T.RESISTOR) num('21c');
        made = c.add(new Comp(type, name));
        made.term(t1);
        made.term(t2);
        if (type === T.RESISTOR) made.res = v['21c'] ?? 0;
        made.index = c.passives.length;
        c.passives.push(made);
        break;
      }
      case T.CONNECTIONS: {
        const colour = num('28c');
        net = new Net(c.nets.length, colour);
        c.nets.push(net);
        break;
      }
      case T.NODE: {
        sc.word();
        const t = findTerm(c, name);
        if (!t) c.problems.push(`Cannot find node ${name}!`);
        else if (net) {
          t.net = net;
          net.add(t);
        } else c.problems.push(`Bad connection list for ${name}!`);
        break;
      }
      case T.SOUNDON: case T.SOUNDOFF: {
        const n = num('290');
        if (last) {
          if (type === T.SOUNDON) last.soundOn = n;
          else last.soundOff = n;
        }
        break;
      }
      default:
        break;
    }
    if (made) last = made;
  }
  return c;
}

function motorPeriod(rpm: number): number {
  if (rpm <= 0) return 0;
  return Math.trunc(((60 / rpm) * 1000) / 360);
}

const pathIndex = new WeakMap<Circuit, { parts: number; map: Map<string, Term> }>();
function findTerm(c: Circuit, path: string): Term | null {
  let ix = pathIndex.get(c);
  if (!ix || ix.parts !== c.all.length) {
    const map = new Map<string, Term>();
    for (const comp of c.all) {
      for (const t of comp.terms) {
        const k = comp.path(t);
        if (!map.has(k)) map.set(k, t);
      }
    }
    ix = { parts: c.all.length, map };
    pathIndex.set(c, ix);
  }
  return ix.map.get(path) ?? null;
}

export type PayoutCoin = number | 'token' | 'unpriced' | { token: number };

export function payoutCoin(type: number, name: string): PayoutCoin | null {
  const isPayout = type === T.HOPPER || (type === T.SOLENOID && /pay\s*-?\s*out|slide/i.test(name));
  if (!isPayout) return null;
  const values = new Set<number>();
  for (const m of name.matchAll(/£\s*(\d+)(?:\.(\d{1,2}))?|(\d+)\s*p\b/gi)) {
    if (m[3] !== undefined) values.add(Number(m[3]));
    else values.add(Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0));
  }
  const token = /token/i.test(name);
  const pence = values.size === 1 ? [...values][0] : null;
  if (pence !== null && pence > 0) return token ? { token: pence } : pence;
  return token ? 'token' : 'unpriced';
}

export function switchCoin(name: string): number | { token: number } | null {
  const values = new Set<number>();
  for (const m of name.matchAll(/£\s*(\d+)(?:\.(\d{1,2}))?|(\d+)\s*p\b/gi)) {
    if (m[3] !== undefined) values.add(Number(m[3]));
    else values.add(Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0));
  }
  if (values.size !== 1) return null;
  const pence = [...values][0];
  if (pence <= 0) return null;
  return /token/i.test(name) ? { token: pence } : pence;
}

export function isCoinSwitch(name: string): boolean {
  return /coin|token/i.test(name) && !/tube|refill|reload|lockout|isolat/i.test(name);
}

export class ElectroState {
  readonly state: Int8Array;
  readonly energised: Int32Array;
  readonly guard: Int32Array;
  readonly dirty: Uint8Array;
  readonly target: Int8Array;
  readonly pos: Int32Array;
  readonly countdown: Int32Array;
  readonly dir: Int8Array;
  readonly c10: Int16Array;
  readonly c14: Int16Array;
  readonly visit: Int32Array;

  constructor(parts: number, nets: number) {
    this.state = new Int8Array(parts);
    this.energised = new Int32Array(parts);
    this.guard = new Int32Array(parts);
    this.dirty = new Uint8Array(parts);
    this.target = new Int8Array(parts);
    this.pos = new Int32Array(parts);
    this.countdown = new Int32Array(parts);
    this.dir = new Int8Array(parts);
    this.c10 = new Int16Array(parts).fill(-1);
    this.c14 = new Int16Array(parts).fill(-1);
    this.visit = new Int32Array(nets);
  }
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s >>> 8;
  };
}

export class Electro implements Machine {
  static readonly snapshotConfig: readonly string[] = ['circuit', 'payouts', 'soundOwners', 'soundIndex', 'boxOf'];

  readonly clockHz = ELECTRO_CLOCK;
  readonly quietIsWaiting = true;
  readonly display = null;
  readonly audioSource = null;

  readonly circuit: Circuit;
  readonly s: ElectroState;

  readonly lamps = new Uint8Array(LAMP_COUNT);
  readonly matrix = new Uint8Array(8);
  private switches: LayoutSwitch[] = [];

  meterWord = 0;
  readonly meters = new MeterConfirm();
  readonly meterCounts = new Uint32Array(16);

  private reelBank: Reel[] = [];
  get reels(): readonly Reel[] { return this.reelBank; }

  private inputTicks = 0;
  private motorTicks = 0;
  private lastInput = 0;
  solves = 0;
  private seed = 1;

  readonly cashLedger: CashLedger = newCashLedger();
  private readonly book = new CoinBook(this.cashLedger, ELECTRO_CLOCK);
  private readonly slots = new SlotCoins();
  private coinSteps: number[] = [];
  private coinLine = -1;
  private coinTimer = 0;

  readonly payouts = new Map<number, PayoutCoin>();

  constructor(netlist: Uint8Array) {
    this.circuit = parseNetlist(netlist);
    this.s = new ElectroState(this.circuit.all.length, this.circuit.nets.length);
    this.circuit.switches.forEach((sw, i) => { if (i < 32 && isCoinSwitch(sw.name)) this.coinSwitch.add(i); });
    for (const p of this.circuit.all) {
      if (p.type === T.SWITCH || p.type === T.CONTACT) continue;
      if (p.soundOn < 0 && p.soundOff < 0) continue;
      this.soundIndex.set(p.id, this.soundOwners.length);
      this.soundOwners.push(p);
    }
    this.soundRises = new Uint32Array(this.soundOwners.length);
    this.boxOf = new Int32Array(this.circuit.all.length);
    for (const p of this.circuit.all) {
      const box = partOf(p);
      this.boxOf[p.id] = box.id;
      if (box === p) this.ioLog.set(p.id, { reads: 0, writes: 0 });
    }
    this.soundLevels = new Uint8Array(this.soundOwners.length);
    for (const p of [...this.circuit.solenoids.filter((x) => !x.parent), ...this.circuit.hoppers]) {
      const coin = payoutCoin(p.type, p.name);
      if (coin !== null) this.payouts.set(p.id, coin);
    }
    for (const m of [...this.circuit.motors, ...this.circuit.mechMotors]) {
      this.s.countdown[m.id] = m.period;
      this.s.dir[m.id] = m.dirInit;
    }
    for (const r of this.circuit.reelList) {
      this.reelBank[r.index] = new Reel({ stepsPerRevolution: 360, symbols: r.stops || 20 });
    }
  }

  setReelGeometry(geoms: readonly ReelGeometry[]): void {
    const n = Math.max(this.circuit.reelList.length, ...geoms.map((g) => g.number + 1), 0);
    const bank: Reel[] = [];
    for (let i = 0; i < n; i++) {
      const g = geoms.find((x) => x.number === i);
      const own = this.circuit.reelList[i];
      bank.push(new Reel({
        stepsPerRevolution: g && g.halfSteps > 0 ? g.halfSteps : 360,
        symbols: g && g.stops > 0 ? g.stops : own?.stops || 20,
      }));
    }
    this.reelBank = bank;
  }

  batteryRam(): Uint8Array | null { return null; }

  setReelPosition(i: number, pos: number): void {
    const r = this.reelBank[i];
    if (r) r.position = ((pos % r.stepsPerRevolution) + r.stepsPerRevolution) % r.stepsPerRevolution;
  }

  setSwitches(sw: readonly LayoutSwitch[]): void {
    this.switches = [...sw];
    for (const s of sw) if (s.closed) this.layoutInput(s.number, true);
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    this.layoutInput(id, made);
    const drawn = this.switches.find((s) => s.number === id);
    if (!drawn) this.switches = [...this.switches, { number: id, label, closed: made }]
      .sort((a, b) => a.number - b.number);
    else if (drawn.label === '' || drawn.label === String(id)) drawn.label = label;
  }

  get switchPanel(): CabinetSwitch[] {
    return this.switches.map((s) => ({
      id: s.number, label: s.label,
      on: s.number >> 3 < this.matrix.length && ((this.matrix[s.number >> 3] >> (s.number & 7)) & 1) === 1,
    }));
  }

  layoutInput(id: number, on: boolean): void {
    if (on && !this.isClosed(id) && id < 32 && this.coinSwitch.has(id)) {
      this.book.coin(this.slots.coinOn(0x100 | id), COIN_HOLD);
    }
    this.input(id, on);
  }

  private isClosed(id: number): boolean {
    return id >= 0 && id < this.matrix.length * 8 && ((this.matrix[id >> 3] >> (id & 7)) & 1) === 1;
  }

  private readonly coinSwitch = new Set<number>();

  get coinSwitchLines(): number[] {
    return [...this.coinSwitch].sort((a, b) => a - b).map((n) => 0x100 | n);
  }

  private input(id: number, on: boolean): void {
    if (id < 0 || id >= this.matrix.length * 8) return;
    if (on) this.matrix[id >> 3] |= 1 << (id & 7);
    else this.matrix[id >> 3] &= ~(1 << (id & 7));
  }

  layoutLamp(n: number): boolean { return n >= 0 && n < LAMP_COUNT && this.lamps[n] !== 0; }
  layoutLampLevel(n: number): number { return n >= 0 && n < LAMP_COUNT ? this.lamps[n] : 0; }

  reset(): void {
    this.inputTicks = 0;
    this.meters.reset();
    this.meterWord = 0;
    this.coinTimer = 0;
    this.coinSteps = [];
    this.book.reset();
    this.soundLevels.fill(0);
    this.resetCircuit();
    this.solve();
  }

  private resetCircuit(): void {
    const c = this.circuit;
    const s = this.s;
    const rnd = lcg(this.seed);
    for (const p of c.all) s.state[p.id] = p.type === T.FUSE ? 2 : 0;
    for (const m of c.motors) {
      s.pos[m.id] = m.start === -1 ? rnd() % 360 : m.start;
      for (const cam of m.cams) s.state[cam.id] = cam.map![s.pos[m.id]] === 0 ? 2 : 0;
      for (const w of m.wipers) if (w.type === T.WIPER) { s.pos[w.id] = s.pos[m.id]; this.wiperUpdate(w); }
    }
    for (const m of c.mechMotors) {
      s.pos[m.id] = m.start === -1 ? rnd() % 360 : m.start;
      const mech = m.parent;
      if (mech && mech.type === T.REELMECH) {
        for (const reel of mech.reels) {
          for (const w of reel.wipers) {
            if (w.type === T.REELWIPER) { s.pos[w.id] = s.pos[reel.id]; this.wiperUpdate(w); }
          }
        }
      }
      for (const w of m.wipers) if (w.type === T.WIPER) { s.pos[w.id] = s.pos[m.id]; this.wiperUpdate(w); }
    }
    for (const st of c.steppers) {
      s.pos[st.id] = 0;
      for (const w of st.wipers) { s.c10[w.id] = 0; s.c14[w.id] = 0; }
      for (const k of st.contacts) s.state[k.id] = 2;
    }
    for (const cc of c.creditCounters) {
      s.pos[cc.id] = 0;
      for (const k of cc.contacts) s.state[k.id] = 2;
    }
  }

  step(): number {
    if (++this.inputTicks >= INPUT_TICKS) {
      this.inputTicks -= INPUT_TICKS;
      if (this.pollInputs()) this.solve();
    }
    if (++this.motorTicks >= MOTOR_TICKS) {
      if (this.meters.pending) this.confirmMeters(this.meters.tick());
      this.motorTicks -= MOTOR_TICKS;
      if (this.motorTick()) this.solve();
    }
    this.book.elapse(TICK_CYCLES);
    if (this.coinTimer > 0) this.coinElapse(TICK_CYCLES);
    return TICK_CYCLES;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  private pollInputs(): boolean {
    const word = (this.matrix[0] | (this.matrix[1] << 8) | (this.matrix[2] << 16) | (this.matrix[3] << 24)) >>> 0;
    let changed = (word ^ this.lastInput) >>> 0;
    if (!changed) return false;
    this.lastInput = word;
    let w = word;
    let any = false;
    for (const sw of this.circuit.switches) {
      if (!changed) break;
      if (changed & 1) {
        this.s.state[sw.id] = w & 1 ? 2 : 0;
        this.touch(sw.id);
        any = true;
      }
      changed >>>= 1;
      w >>>= 1;
    }
    return any;
  }

  private motorTick(): boolean {
    const s = this.s;
    let changed = false;
    for (const m of this.circuit.motors) {
      if (s.state[m.id] !== 2) continue;
      if (--s.countdown[m.id] >= 1) continue;
      s.countdown[m.id] += m.period;
      const angle = (s.pos[m.id] = (s.pos[m.id] + s.dir[m.id] + 360) % 360);
      const p = m.parent;
      if (p && p.type === T.HOPPER) {
        const was = s.state[p.id];
        s.state[p.id] = angle % 36 < 8 ? 2 : 0;
        if (was !== s.state[p.id]) {
          changed = true;
          if (s.state[p.id] === 2) this.payOut(p);
        }
      }
      for (const cam of m.cams) {
        const was = s.state[cam.id];
        s.state[cam.id] = cam.map![angle] === 0 ? 2 : 0;
        if (was !== s.state[cam.id]) { changed = true; this.touch(cam.id); }
      }
      for (const w of m.wipers) {
        if (w.type !== T.WIPER) continue;
        s.pos[w.id] = angle;
        if (this.wiperUpdate(w)) changed = true;
      }
    }
    let moved = 0;
    for (const m of this.circuit.mechMotors) {
      if (s.state[m.id] !== 2) continue;
      if (--s.countdown[m.id] >= 1) continue;
      s.countdown[m.id] += m.period;
      s.pos[m.id] = (s.pos[m.id] + s.dir[m.id] + 360) % 360;
      const mech = m.parent!;
      if (mech.motors.length > 1) for (const o of mech.motors) s.pos[o.id] = s.pos[m.id];
      for (const reel of mech.reels) {
        const step = reel.step || 1;
        if (s.state[reel.id] !== 2 && s.pos[reel.id] % step === 0) continue;
        s.pos[reel.id] = (s.pos[reel.id] - s.dir[m.id] + 360) % 360;
        this.drawReel(reel);
        this.touch(reel.id);
        moved++;
        for (const w of reel.wipers) {
          s.pos[w.id] = s.pos[reel.id];
          if (this.wiperUpdate(w)) changed = true;
        }
      }
      if (moved) changed = true;
    }
    return changed;
  }

  private wiperUpdate(w: Comp): boolean {
    const s = this.s;
    const a = ((s.pos[w.id] % 360) + 360) % 360;
    const lo = w.table![a * 2];
    const hi = w.table![a * 2 + 1];
    if (lo === s.c10[w.id] && hi === s.c14[w.id]) return false;
    s.c10[w.id] = lo;
    s.c14[w.id] = hi;
    return true;
  }

  private drawReel(reel: Comp): void {
    const r = this.reelBank[reel.index];
    if (!r) return;
    const steps = r.stepsPerRevolution;
    const pos = ((steps - this.s.pos[reel.id]) >>> 0) % steps;
    let d = pos - r.position;
    if (d > steps / 2) d -= steps;
    else if (d < -steps / 2) d += steps;
    r.travel += d;
    r.position = pos;
  }

  private lamp(n: number, on: boolean): void {
    if (n < 0 || n >= LAMP_COUNT) return;
    this.lamps[n] = on ? 0xff : 0;
  }

  solve(): void {
    const c = this.circuit;
    const s = this.s;
    this.solves++;
    let again: boolean;
    do {
      again = false;
      let dirty: boolean;
      do {
        this.propagateAll();
        dirty = false;
        for (const k of c.contactList) {
          if (s.dirty[k.id]) { s.dirty[k.id] = 0; dirty = true; }
        }
        if (dirty) {
          for (const r of c.relays) {
            const nu = s.energised[r.id] !== 0 ? 2 : 0;
            if (nu !== s.state[r.id]) {
              s.state[r.id] = nu;
              this.touch(r.id);
              this.lamp(LAMP_RELAY + r.index, nu === 2);
              for (const k of r.contacts) {
                s.dirty[k.id] = 1;
                s.state[k.id] = 1;
                s.target[k.id] = nu;
              }
            }
            s.energised[r.id] = 0;
          }
          for (const k of c.contactList) if (s.state[k.id] === 1) s.state[k.id] = s.target[k.id];
        }
      } while (dirty);
      for (const p of c.all) {
        if (p.type === T.CONTACT || p.terms.length === 0) continue;
        const nu = s.energised[p.id] !== 0 ? 2 : 0;
        if (nu !== s.state[p.id]) {
          if (this.changeState(p, nu)) again = true;
          this.sound(p, nu === 2);
          this.touch(p.id);
          s.state[p.id] = nu;
        }
        s.energised[p.id] = 0;
      }
    } while (again);
  }

  private changeState(p: Comp, nu: number): boolean {
    const s = this.s;
    const on = nu === 2;
    switch (p.type) {
      case T.LAMP:
        this.lamp(p.index, on);
        return false;
      case T.METER: {
        const bit = p.index < 16 ? 1 << p.index : 0;
        this.meterWord = on ? this.meterWord | bit : this.meterWord & ~bit;
        this.meters.write(this.meterWord);
        return false;
      }
      case T.SOLENOID: {
        const owner = p.parent;
        if (!owner) {
          this.lamp(LAMP_SOLENOID + p.index, on);
          if (on) this.payOut(p);
          return false;
        }
        let again = false;
        if (owner.type === T.REEL) {
          const mech = owner.parent;
          let turn = 0;
          if (mech) for (const m of mech.motors) if (on && s.state[m.id] === 2) turn = 2;
          if (s.state[owner.id] !== turn) this.sound(owner, turn === 2);
          s.state[owner.id] = turn;
        } else if (owner.type === T.STEPPER || owner.type === T.CREDITCOUNTER) {
          if (on !== p.flag) again = this.stepCounter(owner, p.index);
        }
        this.lamp(LAMP_PARENTED_SOLENOID + p.index, on);
        return again;
      }
      case T.BELL:
        this.lamp(LAMP_BELL + p.index, on);
        return false;
      case T.RELAY:
        for (const k of p.contacts) {
          s.dirty[k.id] = 1;
          s.state[k.id] = 1;
          s.target[k.id] = nu;
        }
        this.lamp(LAMP_RELAY + p.index, on);
        return true;
      case T.MOTOR:
      case T.REELMOTOR: {
        const mech = p.parent;
        if (mech && mech.type === T.REELMECH) {
          for (const reel of mech.reels) {
            let turn = 0;
            for (const sol of reel.solenoids) if (on && s.state[sol.id] === 2) turn = 2;
            if (s.state[reel.id] !== turn) this.sound(reel, turn === 2);
            s.state[reel.id] = turn;
          }
        }
        this.lamp(LAMP_MOTOR + p.index, on);
        return false;
      }
      default:
        return false;
    }
  }

  private stepCounter(owner: Comp, which: number): boolean {
    const s = this.s;
    const at = s.pos[owner.id];
    let moved = false;
    if (owner.type === T.CREDITCOUNTER) {
      if (which === 0 && at < owner.count) { s.pos[owner.id] = at + 1; moved = true; }
      else if (which === 1 && at !== 0) { s.pos[owner.id] = at - 1; moved = true; }
      return moved;
    }
    const n = owner.count || 1;
    if (which === 0) {
      if (!owner.limit || at < n - 1) { s.pos[owner.id] = (at + 1) % n; moved = true; }
    } else if (which === 1) {
      if (!owner.limit || at !== 0) { s.pos[owner.id] = (n + at - 1) % n; moved = true; }
    } else if (which === 2) {
      if (owner.limit && at !== 0) { s.pos[owner.id] = 0; moved = true; }
    }
    for (const w of owner.wipers) s.c10[w.id] = s.pos[owner.id];
    return moved;
  }

  private outV = 0;
  private outR = 0;
  private outF = 0;

  private propagateAll(): void {
    for (const p of this.circuit.all) {
      if (p.live !== 0) this.prop(p, null, 0, 0);
    }
  }

  private prop(p: Comp, entry: Term | null, V: number, R: number): void {
    switch (p.type) {
      case T.RAIL: this.propRail(p, V, R); return;
      case T.CONTACT: this.propContact(p, entry, V, R); return;
      case T.FUSE: this.propFuse(p, entry, V, R); return;
      case T.WIPER: this.propWiper(p, entry, V, R); return;
      case T.WIPERCONTACT: this.propWiperContact(p, entry, V, R); return;
      case T.REELMOTOR: this.propReelMotor(p, entry, V, R); return;
      default: this.propBase(p, entry, V, R);
    }
  }

  private propBase(p: Comp, entry: Term | null, V: number, R: number): void {
    const s = this.s;
    if (s.guard[p.id] !== 0) { this.outV = V; this.outR = R; this.outF = 0; return; }
    if (V === 0) { this.outV = 0; this.outR = R; this.outF = 0; return; }
    const own = p.res + R;
    let pathR = own;
    let lowest = V;
    let flag = 0;
    const exit = p.terms[0] === entry ? p.terms[1] : p.terms[0];
    const net = exit?.net;
    if (net && s.visit[net.id] === 0) {
      s.visit[net.id]++;
      s.guard[p.id]++;
      for (const t of net.terms) {
        const o = t.owner;
        if (o === p || (p.type === T.RELAY && o.type === T.RELAY)) continue;
        this.prop(o, t, lowest, own);
        pathR += this.outR - own;
        flag = this.outF;
        if (this.outV < lowest) {
          lowest = this.outV;
          if (lowest === 0) { flag = 0; break; }
        }
      }
      s.guard[p.id]--;
      s.visit[net.id]--;
    }
    if (V - lowest > 0) s.energised[p.id]++;
    this.outV = lowest;
    this.outR = pathR;
    this.outF = flag;
  }

  private propRail(p: Comp, _V: number, R: number): void {
    const s = this.s;
    let lowest = p.live;
    let pathR = R + p.res;
    if (lowest === 0) { this.outV = 0; this.outR = pathR; this.outF = 1; return; }
    const net = p.terms[0]?.net;
    if (net && s.visit[net.id] === 0) {
      s.visit[net.id]++;
      for (const t of net.terms) {
        if (t.owner === p) continue;
        this.prop(t.owner, t, p.live, p.res);
        if (this.outV < lowest) lowest = this.outV;
        pathR += this.outR;
      }
      s.visit[net.id]--;
    }
    this.outV = lowest;
    this.outR = pathR;
    this.outF = 0;
  }

  private contactState(k: Comp): number {
    const s = this.s;
    const p = k.parent!;
    const own = s.state[k.id];
    switch (p.type) {
      case T.SWITCH: {
        const st = s.state[p.id];
        if (!p.flag) return st;
        return st === 0 ? 2 : st === 2 ? 0 : st;
      }
      case T.RELAY: {
        const r = s.state[p.id];
        if (own === 0) {
          if (r === 2) { s.state[k.id] = 1; s.target[k.id] = 2; s.dirty[k.id] = 1; return 1; }
          return 0;
        }
        if (own === 1) {
          if (r === 2) { if (s.target[k.id] === 0) { s.target[k.id] = 2; s.dirty[k.id] = 1; } }
          else if (s.target[k.id] === 2) { s.target[k.id] = 0; s.dirty[k.id] = 1; }
          return 1;
        }
        if (own === 2 && r === 0) { s.state[k.id] = 1; s.target[k.id] = 0; s.dirty[k.id] = 1; return 1; }
        return own;
      }
      case T.CAM:
      case T.HOPPER:
        return s.state[p.id];
      case T.STEPPER:
      case T.CREDITCOUNTER:
        return s.pos[p.id] === 0 ? 2 : 0;
      default:
        return own;
    }
  }

  private propContact(p: Comp, entry: Term | null, V: number, R: number): void {
    const s = this.s;
    if (s.guard[p.id] !== 0) { this.outV = V; this.outR = R; this.outF = 0; return; }
    if (V === 0) { this.outV = 0; this.outR = R; this.outF = 0; return; }
    let pathR = R + p.res;
    let lowest = V;
    let flag = 0;
    const st = this.contactState(p);
    let net: Net | null = null;
    let fromCommon = false;
    if (entry === p.terms[0]) {
      net = st === 2 ? p.terms[1].net : st === 0 ? p.terms[2].net : null;
      fromCommon = true;
    } else if ((entry === p.terms[1] && st === 2) || (entry === p.terms[2] && st === 0)) {
      net = p.terms[0].net;
    }
    if (net && s.visit[net.id] === 0) {
      s.visit[net.id]++;
      s.guard[p.id]++;
      for (const t of net.terms) {
        if (t.owner === p) continue;
        this.prop(t.owner, t, V, R);
        flag = this.outF;
        pathR += fromCommon ? this.outR : this.outR - (p.res + R);
        if (this.outV < lowest) lowest = this.outV;
        if (flag) break;
      }
      s.guard[p.id]--;
      s.visit[net.id]--;
    }
    this.outV = lowest;
    this.outR = pathR;
    this.outF = flag;
  }

  private propFuse(p: Comp, entry: Term | null, V: number, R: number): void {
    const s = this.s;
    if (s.guard[p.id] !== 0) { this.outV = V; this.outR = R; this.outF = 0; return; }
    if (V === 0) { this.outV = 0; this.outR = R; this.outF = 0; return; }
    const exit = entry === p.terms[0] ? p.terms[1] : p.terms[0];
    let pathR = R + p.res;
    let lowest = V;
    let flag = 0;
    if (s.state[p.id] === 2) {
      const net = exit?.net;
      if (net && s.visit[net.id] === 0) {
        s.visit[net.id]++;
        s.guard[p.id]++;
        for (const t of net.terms) {
          if (t.owner === p) continue;
          this.prop(t.owner, t, V, p.res + R);
          flag = this.outF;
          pathR += this.outR;
          if (this.outV < lowest) lowest = this.outV;
        }
        s.guard[p.id]--;
        s.visit[net.id]--;
      }
      if (V <= lowest) s.energised[p.id]++;
      else if (pathR === 0) s.state[p.id] = 0;
      else s.energised[p.id]++;
    }
    this.outV = lowest;
    this.outR = pathR;
    this.outF = flag;
  }

  private propWiper(p: Comp, entry: Term | null, V: number, R: number): void {
    const s = this.s;
    if (s.guard[p.id] !== 0) { this.outV = V; this.outR = R; this.outF = 0; return; }
    if (V === 0) { this.outV = 0; this.outR = R; this.outF = 0; return; }
    let pathR = R + p.res;
    let lowest = V;
    let flag = 0;
    const into = (net: Net | null | undefined): void => {
      if (!net || s.visit[net.id] !== 0) return;
      s.visit[net.id]++;
      s.guard[p.id]++;
      for (const t of net.terms) {
        if (t.owner === p) continue;
        this.prop(t.owner, t, V, p.res + R);
        flag = this.outF;
        pathR += this.outR;
        if (this.outV < lowest) lowest = this.outV;
      }
      s.guard[p.id]--;
      s.visit[net.id]--;
    };
    const c10 = s.c10[p.id];
    if (entry === p.terms[0]) {
      let prev = -1;
      for (const k of [c10, s.c14[p.id]]) {
        if (k === -1 || k === prev) continue;
        prev = k;
        into(p.terms[k + 1]?.net);
      }
    } else if (c10 >= 0 && entry === p.terms[c10 + 1]) {
      into(p.terms[0].net);
    }
    this.outV = lowest;
    this.outR = pathR;
    this.outF = flag;
  }

  private propWiperContact(p: Comp, entry: Term | null, V: number, R: number): void {
    const s = this.s;
    if (s.guard[p.id] !== 0) { this.outV = V; this.outR = R; this.outF = 0; return; }
    if (V === 0) { this.outV = 0; this.outR = R; this.outF = 0; return; }
    let pathR = R + p.res;
    const rw = p.parent!;
    const at = s.c10[rw.id];
    let exit: Term | null = null;
    if (at !== -1) {
      const here = rw.byStud[at];
      if (here && here.stud === p.stud && entry) {
        const i = here.terms.indexOf(entry);
        if (i >= 0) exit = here.terms[i ^ 1];
      }
    }
    if (!exit) { this.outV = V; this.outR = pathR; this.outF = 0; return; }
    let lowest = V;
    let flag = 0;
    s.guard[p.id]++;
    const net = exit.net;
    if (net && s.visit[net.id] === 0) {
      s.visit[net.id]++;
      for (const t of net.terms) {
        if (t.owner === p) continue;
        this.prop(t.owner, t, V, p.res + R);
        pathR += this.outR;
        flag = this.outF;
        if (this.outV < lowest) lowest = this.outV;
      }
      s.visit[net.id]--;
    }
    s.guard[p.id]--;
    this.outV = lowest;
    this.outR = pathR;
    this.outF = flag;
  }

  private propReelMotor(p: Comp, entry: Term | null, V: number, R: number): void {
    const s = this.s;
    if (s.guard[p.id] !== 0) { this.outV = V; this.outR = R; this.outF = 0; return; }
    if (V === 0) { this.outV = 0; this.outR = R; this.outF = 0; return; }
    const own = p.res + R;
    let pathR = own;
    if (entry === p.terms[2]) { this.outV = V; this.outR = pathR; this.outF = 0; return; }
    let lowest = V;
    let flag = 0;
    const net = p.terms[2]?.net;
    if (net && s.visit[net.id] === 0) {
      s.visit[net.id]++;
      s.guard[p.id]++;
      for (const t of net.terms) {
        if (t.owner === p) continue;
        this.prop(t.owner, t, lowest, own);
        pathR += this.outR - own;
        flag = this.outF;
        if (this.outV < lowest) {
          lowest = this.outV;
          if (lowest === 0) { flag = 0; break; }
        }
      }
      s.guard[p.id]--;
      s.visit[net.id]--;
    }
    if (V - lowest > 0) {
      s.dir[p.id] = entry === p.terms[0] ? 1 : -1;
      s.energised[p.id]++;
    }
    this.outV = lowest;
    this.outR = pathR;
    this.outF = flag;
  }

  readonly ioLog = new Map<number, { reads: number; writes: number }>();
  private boxOf: Int32Array = new Int32Array(0);

  private touch(id: number): void {
    const e = this.ioLog.get(this.boxOf[id]);
    if (e) e.writes++;
  }

  private sound(p: Comp, on: boolean): void {
    const i = this.soundIndex.get(p.id);
    if (i === undefined) return;
    if (on && !this.soundLevels[i]) this.soundRises[i]++;
    this.soundLevels[i] = on ? 1 : 0;
  }

  private readonly soundOwners: Comp[] = [];
  private readonly soundIndex = new Map<number, number>();
  soundRises = new Uint32Array(0);
  soundLevels = new Uint8Array(0);

  get partSounds(): { on: readonly number[]; off: readonly number[]; rises: Uint32Array; levels: Uint8Array } {
    return {
      on: this.soundOwners.map((p) => p.soundOn),
      off: this.soundOwners.map((p) => p.soundOff),
      rises: this.soundRises,
      levels: this.soundLevels,
    };
  }

  private payOut(p: Comp): void {
    const coin = this.payouts.get(p.id);
    if (coin !== undefined) this.book.pay(coin);
  }

  get payoutParts(): { name: string; coin: PayoutCoin }[] {
    return [...this.payouts].map(([id, coin]) => ({ name: this.circuit.all[id].name, coin }));
  }

  private confirmMeters(confirmed: number): void {
    for (let i = 0; i < 16; i++) if (confirmed & (1 << i)) this.meterCounts[i]++;
  }

  insertCoin(id: number): void {
    if (this.coinTimer > 0) return;
    const raw = id >= 0x100 && id < 0x180 ? id : COIN_RAW[id];
    if (raw === undefined) return;
    const steps = coinMatrixSteps(raw);
    if (!steps) return;
    this.coinSteps = steps.map((st) => st.strobe * 8 + st.bit);
    this.book.coin(id >= 0x100 ? this.slots.coinOn(id) : coinOfNote(id), COIN_HOLD);
    this.nextCoinStep();
  }

  private nextCoinStep(): void {
    const line = this.coinSteps.shift();
    if (line === undefined) return;
    this.coinLine = line;
    this.input(line, true);
    this.coinTimer = COIN_HOLD + COIN_GAP;
  }

  private coinElapse(c: number): void {
    const was = this.coinTimer;
    this.coinTimer -= c;
    if (was > COIN_GAP && this.coinTimer <= COIN_GAP && this.coinLine >= 0) {
      this.input(this.coinLine, false);
    }
    if (this.coinTimer <= 0) {
      this.coinTimer = 0;
      if (this.coinSteps.length) this.nextCoinStep();
    }
  }

  get coinBusy(): boolean { return this.coinTimer > 0; }

  setSlides(slides: readonly SlideEffect[] | null): void { this.book.setSlides(slides); }

  setCoinSlots(lines: Iterable<readonly [number, BookedCoin]>): void {
    const stated: [number, BookedCoin][] = [];
    for (const [line, coin] of lines) {
      const sw = line >= 0x100 ? this.circuit.switches[line & 0x7f] : undefined;
      let named = (coin === null || coin === 'token') && sw ? switchCoin(sw.name) : null;
      if (named === null && coin === null && sw && isCoinSwitch(sw.name) && /token/i.test(sw.name)) {
        stated.push([line, 'token']);
        continue;
      }
      const c: BookedCoin = named === null ? coin
        : coin === 'token' ? { token: typeof named === 'number' ? named : named.token } : named;
      stated.push([line, c]);
    }
    this.slots.setLines(stated);
    this.chuteCache = null;
  }

  get unnamedCoinLines(): readonly number[] { return this.slots.unnamed; }

  nameCoin(line: number, coin: NamedCoin): void {
    this.slots.name(line, coin);
    this.chuteCache = null;
  }

  private chuteCache: CoinChute[] | null = null;
  get coinChutes(): readonly CoinChute[] | undefined {
    this.chuteCache ??= this.slots.chutes((line) => `Coin ${line & 0x7f}`);
    return this.chuteCache.length ? this.chuteCache : undefined;
  }

  get parts(): BoardPart[] {
    const { groups, other } = electroBoxes(this.circuit, (p) => this.describe(p), (p) => this.isCoinPart(p));
    return [...groups.flatMap((g) => g.boxes), ...other]
      .map((b) => ({ id: nodeId(b.comp), label: b.comp.name || '(unnamed)', part: b.part, device: this.s, io: [[b.comp.id, b.comp.id + 1]] as [number, number][] }));
  }

  schematic(): Schematic {
    return electroSchematic(this.circuit, (p) => this.describe(p), (p) => this.isCoinPart(p));
  }

  private isCoinPart(p: Comp): boolean {
    const i = this.circuit.switches.indexOf(p);
    return i >= 0 && this.coinSwitch.has(i);
  }

  private describe(p: Comp): string {
    const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
    switch (p.type) {
      case T.RAIL: return p.live ? `${p.live} V` : '0 V return';
      case T.FUSE: return 'fuse';
      case T.SWITCH: {
        const i = this.circuit.switches.indexOf(p);
        if (this.isCoinPart(p)) {
          const c = this.slots.coinOn(0x100 | i);
          return typeof c === 'number' ? `coin ${coinName(c)}` : c && c !== 'token' ? `token ${coinName(c.token)}` : 'coin, value not stated';
        }
        return i >= 32 ? 'not read' : count(p.contacts.length, 'contact');
      }
      case T.RELAY: return count(p.contacts.length, 'contact');
      case T.MOTOR: case T.REELMOTOR:
        return p.parent?.type === T.REELMECH ? `${p.rpm} rpm, drives reels`
          : `${p.rpm} rpm, ${count(p.cams.length, 'cam')}${p.wipers.length ? `, ${count(p.wipers.length, 'wiper')}` : ''}`;
      case T.HOPPER: return `hopper, ${count(p.motors.length, 'motor')}`;
      case T.REEL: {
        const studs = p.wipers.reduce((n, w) => n + w.byStud.filter(Boolean).length, 0);
        return `${p.stops} stops, ${count(studs, 'stud')}`;
      }
      case T.SOLENOID: {
        const coin = this.payouts.get(p.id);
        if (coin === undefined) return 'solenoid';
        return typeof coin === 'number' ? `payout ${coinName(coin)}` : coin === 'token' ? 'payout, token'
          : coin === 'unpriced' ? 'payout, value not stated' : `payout, token ${coinName(coin.token)}`;
      }
      case T.STEPPER: return `stepper, ${count(p.count, 'position')}`;
      case T.CREDITCOUNTER: return `credits, up to ${p.count}`;
      case T.METER: return p.index < 16 ? `counter ${p.index + 1}` : 'counter, not read';
      case T.BELL: return 'bell';
      case T.LAMP: return `lamp ${p.index}`;
      case T.CAPACITOR: return 'capacitor';
      case T.RESISTOR: return 'resistor';
      case T.DIODE: return 'diode';
      case T.WIPER: return `wiper, ${count(p.studs, 'stud')}`;
      default: return 'part';
    }
  }
}
