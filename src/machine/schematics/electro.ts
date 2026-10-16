import type { Schematic } from '../schematic';
import type { Circuit, Comp } from '../electro';
import { plot, type PlotCell, type PlotRow } from './plot';
import { TAILORED_IDS } from '../schematic';

const SWITCH = 1, MOTOR = 2, RAIL = 3, LAMP = 4, SOLENOID = 5, RELAY = 6, CAM = 7,
  METER = 8, FUSE = 9, REEL = 0x0a, WIPER = 0x0b, BELL = 0x0c, CONTACT = 0x0d,
  REELWIPER = 0x0e, HOPPER = 0x0f, STEPPER = 0x10, REELMECH = 0x11, WIPERCONTACT = 0x12,
  CREDITCOUNTER = 0x17, CAPACITOR = 0x18, RESISTOR = 0x19, DIODE = 0x1a, REELMOTOR = 0x1b;

const PER_ROW = 6;

export function nodeId(c: Comp): string {
  return `c${c.id}`;
}

export function partOf(c: Comp): Comp {
  let p = c;
  while (p.parent && nested(p)) p = p.parent;
  return p;
}

function nested(p: Comp): boolean {
  switch (p.type) {
    case CONTACT: case CAM: case WIPER: case REELWIPER: case WIPERCONTACT: case SOLENOID:
      return true;
    case MOTOR:
      return p.parent?.type === HOPPER;
    default:
      return false;
  }
}

interface Group { id: string; label: string; band: 'edge' | 'io' | 'peripheral'; types: number[] }

const GROUPS: Group[] = [
  { id: 'rails', label: 'SUPPLY RAILS', band: 'edge', types: [RAIL, FUSE] },
  { id: 'coins', label: 'COIN MECHS', band: 'edge', types: [] },
  { id: 'switches', label: 'SWITCHES', band: 'edge', types: [SWITCH] },
  { id: 'relays', label: 'RELAYS', band: 'io', types: [RELAY] },
  { id: 'motors', label: 'CAM MOTORS', band: 'peripheral', types: [MOTOR, HOPPER] },
  { id: TAILORED_IDS.reels, label: 'REEL MECH', band: 'peripheral', types: [REELMECH, REEL, REELMOTOR] },
  { id: 'solenoids', label: 'SOLENOIDS', band: 'io', types: [SOLENOID, STEPPER, CREDITCOUNTER] },
  { id: TAILORED_IDS.meters, label: 'METERS AND BELLS', band: 'edge', types: [METER, BELL] },
  { id: 'lamps', label: 'LAMPS', band: 'edge', types: [LAMP] },
  { id: 'passives', label: 'RESISTORS, CAPACITORS, DIODES', band: 'edge', types: [CAPACITOR, RESISTOR, DIODE, WIPER] },
];

export interface ElectroBox {
  comp: Comp;
  part: string;
}

export function electroBoxes(c: Circuit, describe: (p: Comp) => string, isCoin: (p: Comp) => boolean):
  { groups: { group: Group; boxes: ElectroBox[] }[]; other: ElectroBox[] } {
  const tops = c.all.filter((p) => partOf(p) === p && p.type !== REELMECH);
  const taken = new Set<Comp>();
  const groups = GROUPS.map((group) => {
    const boxes: ElectroBox[] = [];
    for (const p of tops) {
      if (taken.has(p)) continue;
      const coin = p.type === SWITCH && isCoin(p);
      const fits = group.id === 'coins' ? coin : group.types.includes(p.type) && !(group.id === 'switches' && coin);
      if (!fits) continue;
      taken.add(p);
      boxes.push({ comp: p, part: describe(p) });
    }
    return { group, boxes };
  });
  const other = tops.filter((p) => !taken.has(p)).map((p) => ({ comp: p, part: describe(p) }));
  return { groups, other };
}

export function electroSchematic(c: Circuit, describe: (p: Comp) => string, isCoin: (p: Comp) => boolean): Schematic {
  const { groups, other } = electroBoxes(c, describe, isCoin);
  const rows: PlotRow[] = [];
  const add = (id: string, label: string, band: Group['band'], boxes: ElectroBox[]): void => {
    if (!boxes.length) return;
    rows.push({ kind: 'rail', id, label: `${label} · ${boxes.length}`, rail: 'control' });
    for (let i = 0; i < boxes.length; i += PER_ROW) {
      const cells: PlotCell[] = boxes.slice(i, i + PER_ROW).map((b) => ({ id: nodeId(b.comp) }));
      const pad = i > 0 ? PER_ROW - cells.length : 0;
      for (let k = 0; k < pad; k++) cells.push({ id: `${id}-pad${k}`, label: '', state: 'unfitted' });
      rows.push({ kind: 'cells', band, cells });
    }
  };
  for (const { group, boxes } of groups) add(group.id, group.label, group.band, boxes);
  add('other', 'OTHER PARTS', 'edge', other);
  const s = plot({
    system: 'ELECTRO',
    title: 'ELECTROMECHANICAL',
    source: 'This cabinet\'s own wiring list - one box per part, no PCB',
    rows,
    edges: [],
  });
  s.nodes = s.nodes.filter((n) => !/-pad\d+$/.test(n.id));
  return s;
}

export const ELECTRO_TYPES = {
  SWITCH, MOTOR, RAIL, LAMP, SOLENOID, RELAY, CAM, METER, FUSE, REEL, WIPER, BELL, CONTACT,
  REELWIPER, HOPPER, STEPPER, REELMECH, WIPERCONTACT, CREDITCOUNTER, CAPACITOR, RESISTOR, DIODE, REELMOTOR,
} as const;
