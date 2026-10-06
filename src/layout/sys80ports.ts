import { decodedLayout, fileLevelTags } from './fmlconfig';

export enum PortType {
  Lamp = 0,
  Unused = 1,
  Meter = 2,
  Triac = 3,
  Seg = 4,
  Bcd = 5,
  SegDigit = 6,
  BcdDigit = 7,
  Sound = 8,
  HopperEnable = 9,
  ExtenderClock = 10,
  ExtenderData = 11,
  ExtenderAddress = 12,
  ExtenderReset = 13,
  ReelPort = 0xe,
  LedShift = 0xf,
  LedData = 0x10,
  LedLatch = 0x11,
  Debug = 0x12,
  TriacLamp = 0x13,
  RomPage = 0x14,
}

export interface PortEntry { type: PortType; value: number }

export const SYS80_PORT_TAG = 0x9c;
export const SYS80_PORT_COUNT = 512;

export function sys80PortMap(layout: Uint8Array | undefined): PortEntry[] | null {
  const payload = decodedLayout(layout);
  if (!payload) return null;
  return sys80PortMapFromPayload(payload);
}

export function sys80PortMapFromPayload(payload: Uint8Array): PortEntry[] | null {
  let tags: Map<number, Uint8Array>;
  try {
    tags = fileLevelTags(payload);
  } catch {
    return null;
  }
  const t = tags.get(SYS80_PORT_TAG);
  if (!t || t.length !== SYS80_PORT_COUNT * 2) return null;
  const map: PortEntry[] = [];
  for (let p = 0; p < SYS80_PORT_COUNT; p++) {
    map.push({ type: t[p * 2] as PortType, value: t[p * 2 + 1] });
  }
  return map;
}
