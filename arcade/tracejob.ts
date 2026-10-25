import type { FrameLayout } from '../src/machine/framestate';
import type { Game } from '../src/machine/registry';
import { decodeTrace, encodeTrace, layoutDigest, type TraceInput } from './trace';

export function brightestStill(frames: Uint8Array[], fl: FrameLayout): Uint8Array | undefined {
  let still: Uint8Array | undefined;
  let best = -1;
  for (const fr of frames) {
    if (fr.length < fl.byteLength) continue;
    const v = fr.subarray(fl.byteLength - fl.videoBytes);
    let lit = 0;
    for (let i = 4; i < v.length; i += 4) if (v[i] | v[i + 1] | v[i + 2]) lit++;
    if (lit > best) { best = lit; still = v.slice(); }
  }
  return still;
}

export type EncodeJob = Omit<TraceInput, 'still'>;

export function encodeJob(j: EncodeJob): { bytes: Uint8Array; frames: number } {
  const still = j.layout.videoBytes ? brightestStill(j.frames, j.layout) : undefined;
  const bytes = encodeTrace({ ...j, still });
  const back = decodeTrace(bytes);
  if (back.header.frames !== j.frames.length) throw new Error('the recording did not read back');
  return { bytes, frames: j.frames.length };
}

export async function roomShapeDigest(game: Game): Promise<string> {
  const [{ machineFor }, { frameLayoutFor }] = await Promise.all([
    import('../src/machine/registry'), import('../src/machine/framestate'),
  ]);
  return layoutDigest(frameLayoutFor(game.system, machineFor(game), game.layout));
}

export type TraceJobRequest =
  | { id: number; kind: 'encode'; job: EncodeJob }
  | { id: number; kind: 'shape'; game: Game };

export type TraceJobResponse =
  | { id: number; ok: true; kind: 'encode'; bytes: Uint8Array; frames: number }
  | { id: number; ok: true; kind: 'shape'; digest: string }
  | { id: number; ok: false; message: string };

export async function runTraceJob(req: TraceJobRequest): Promise<TraceJobResponse> {
  try {
    if (req.kind === 'encode') {
      const r = encodeJob(req.job);
      return { id: req.id, ok: true, kind: 'encode', bytes: r.bytes, frames: r.frames };
    }
    return { id: req.id, ok: true, kind: 'shape', digest: await roomShapeDigest(req.game) };
  } catch (e) {
    return { id: req.id, ok: false, message: (e as Error).message };
  }
}
