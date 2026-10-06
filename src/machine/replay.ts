import type { Machine, NoteResult } from './machine';

export const RECORDING_VERSION = 1;

export type InputEvent =
  | { cycle: number; kind: 'press'; id: number }
  | { cycle: number; kind: 'release'; id: number }
  | { cycle: number; kind: 'sw'; id: number; on: boolean }
  | { cycle: number; kind: 'coin'; bit: number }
  | { cycle: number; kind: 'note'; billType: number; parallel?: true };

export type ClockPolicy =
  | { mode: 'pinned'; at: number }
  | { mode: 'unpinned' };

export interface Recording {
  format: 'fruitulator-recording';
  version: number;
  set: string;
  setHash: string;
  cold: boolean;
  clock: ClockPolicy;
  endCycle: number;
  events: InputEvent[];
}

export function applyClock(m: Machine, clock: ClockPolicy): void {
  m.pinHostClock?.(clock.mode === 'pinned' ? new Date(clock.at) : null);
}

export interface Recorder {
  readonly cycles: number;
  readonly events: readonly InputEvent[];
  finish(): Recording;
  detach(): void;
}

export interface RecordOptions {
  set: string;
  setHash?: string;
  cold: boolean;
  clock: ClockPolicy;
  maxEvents?: number;
  onEvent?: (e: InputEvent) => void;
}

type Wrappable = Machine & {
  setSwitch?(id: number, on: boolean): void;
};

export function recordInto(m: Machine, opts: RecordOptions): Recorder {
  applyClock(m, opts.clock);

  const target = m as Wrappable;
  const max = opts.maxEvents ?? 200_000;
  const events: InputEvent[] = [];
  let cycles = 0;
  let depth = 0;
  let detached = false;

  const origStep = target.step.bind(target);
  const origRun = target.run.bind(target);
  const origInput = target.layoutInput.bind(target);
  const origCoin = target.insertCoin.bind(target);
  const origNote = target.insertNote?.bind(target);
  const origParallelNote = target.insertParallelNote?.bind(target);
  const origSwitch = target.setSwitch?.bind(target);

  const add = (e: InputEvent) => {
    if (depth !== 0) return;
    opts.onEvent?.(e);
    if (events.length < max) events.push(e);
  };
  const inside = <T>(fn: () => T): T => {
    depth++;
    try { return fn(); } finally { depth--; }
  };

  target.step = (): number => {
    const outer = depth === 0;
    const ran = inside(origStep);
    if (outer) cycles += ran;
    return ran;
  };
  target.run = (n: number): number => {
    const outer = depth === 0;
    const ran = inside(() => origRun(n));
    if (outer) cycles += ran;
    return ran;
  };
  target.layoutInput = (id: number, on: boolean): void => {
    add({ cycle: cycles, kind: on ? 'press' : 'release', id });
    inside(() => origInput(id, on));
  };
  target.insertCoin = (bit: number): void => {
    add({ cycle: cycles, kind: 'coin', bit });
    inside(() => origCoin(bit));
  };
  if (origNote) {
    target.insertNote = (billType: number): NoteResult => {
      add({ cycle: cycles, kind: 'note', billType });
      return inside(() => origNote(billType));
    };
  }
  if (origParallelNote) {
    target.insertParallelNote = (channel: number): NoteResult => {
      add({ cycle: cycles, kind: 'note', billType: channel, parallel: true });
      return inside(() => origParallelNote(channel));
    };
  }
  if (origSwitch) {
    target.setSwitch = (id: number, on: boolean): void => {
      add({ cycle: cycles, kind: 'sw', id, on });
      inside(() => origSwitch(id, on));
    };
  }

  return {
    get cycles() { return cycles; },
    get events() { return events; },
    finish: (): Recording => ({
      format: 'fruitulator-recording',
      version: RECORDING_VERSION,
      set: opts.set,
      setHash: opts.setHash ?? '',
      cold: opts.cold,
      clock: opts.clock,
      endCycle: cycles,
      events: events.map((e) => ({ ...e })),
    }),
    detach: () => {
      if (detached) return;
      detached = true;
      delete (target as Partial<Wrappable>).step;
      delete (target as Partial<Wrappable>).run;
      delete (target as Partial<Wrappable>).layoutInput;
      delete (target as Partial<Wrappable>).insertCoin;
      if (origNote) delete (target as Partial<Wrappable>).insertNote;
      if (origParallelNote) delete (target as Partial<Wrappable>).insertParallelNote;
      if (origSwitch) delete (target as Partial<Wrappable>).setSwitch;
    },
  };
}

export interface ReplayOptions {
  setHash?: string;
  onSample?: (m: Machine, cycle: number) => void;
  sampleEvery?: number;
}

export function replayRecording(m: Machine, rec: Recording, opts: ReplayOptions = {}): void {
  if (rec.format !== 'fruitulator-recording') throw new Error('not a recording');
  if (rec.version !== RECORDING_VERSION) {
    throw new Error(`recording version ${rec.version} is from an incompatible build (expected ${RECORDING_VERSION})`);
  }
  if (opts.setHash && rec.setHash && opts.setHash !== rec.setHash) {
    throw new Error(`recording is for set ${rec.setHash.slice(0, 12)}, this machine is ${opts.setHash.slice(0, 12)}`);
  }
  applyClock(m, rec.clock);

  const sw = (m as Wrappable).setSwitch?.bind(m);
  const every = opts.sampleEvery ?? m.clockHz;
  let cycles = 0;
  let nextSample = every;

  const to = (target: number): void => {
    while (cycles < target) {
      const stop = opts.onSample ? Math.min(target, nextSample) : target;
      while (cycles < stop) cycles += m.run(stop - cycles);
      if (opts.onSample && cycles >= nextSample) {
        opts.onSample(m, cycles);
        nextSample += every;
      }
    }
  };

  for (const e of rec.events) {
    to(e.cycle);
    switch (e.kind) {
      case 'press': m.layoutInput(e.id, true); break;
      case 'release': m.layoutInput(e.id, false); break;
      case 'coin': m.insertCoin(e.bit); break;
      case 'note':
        if (e.parallel) {
          if (!m.insertParallelNote) throw new Error('recording offers a note, which this board has no note reader for');
          m.insertParallelNote(e.billType);
        } else {
          if (!m.insertNote) throw new Error('recording offers a note, which this board has no note reader for');
          m.insertNote(e.billType);
        }
        break;
      case 'sw':
        if (!sw) throw new Error(`recording drives firmware switch ${e.id}, which this board has no setSwitch for`);
        sw(e.id, e.on);
        break;
    }
  }
  to(rec.endCycle);
}

export function parseRecording(json: string): Recording {
  const r = JSON.parse(json) as Partial<Recording>;
  if (r.format !== 'fruitulator-recording') throw new Error('not a recording');
  if (r.version !== RECORDING_VERSION) {
    throw new Error(`recording version ${r.version} is from an incompatible build (expected ${RECORDING_VERSION})`);
  }
  if (!Array.isArray(r.events)) throw new Error('recording has no events');
  if (typeof r.endCycle !== 'number') throw new Error('recording has no endCycle');
  if (typeof r.cold !== 'boolean') throw new Error('recording does not say whether it started cold');
  if (!r.clock || (r.clock.mode !== 'pinned' && r.clock.mode !== 'unpinned')) {
    throw new Error('recording has no clock policy');
  }
  let last = -1;
  for (const e of r.events) {
    if (typeof e.cycle !== 'number' || e.cycle < last) throw new Error('recording events are not in cycle order');
    last = e.cycle;
  }
  if (last > r.endCycle) throw new Error('recording has an event past its end');
  return r as Recording;
}
