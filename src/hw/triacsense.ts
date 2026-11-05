import { fileLevelTags } from '../layout/fmlconfig';

export interface TriacSensed {
  triacSenseLine: number;
  triacSenseMask: number;
  layoutInput(id: number, on: boolean): void;
}

export function triacSenseRelease(m: TriacSensed, rising: number): void {
  if (m.triacSenseLine >= 0 && (rising & m.triacSenseMask) !== 0) m.layoutInput(m.triacSenseLine, false);
}

export function readTriacSense(payload: Uint8Array): { line: number; mask: number } | null {
  const tags = fileLevelTags(payload);
  const sense = tags.get(0x11);
  if (!sense || sense.length < 4) return null;
  const view = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);
  const word = view(sense, 0);
  if (word === 0xffffffff) return null;
  const line = (word >> 8) & 0x7f;
  if (line >= 64) return null;
  const masks = tags.get(0x15);
  return { line, mask: masks && masks.length >= 8 ? view(masks, 4) : 0xff };
}
