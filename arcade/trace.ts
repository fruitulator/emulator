import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { FRAME_FORMAT, type FrameLayout } from '../src/machine/framestate';

export const TRACE_VERSION = 1;
export const TRACE_FPS = 25;
const MAGIC = [0x46, 0x52, 0x54, 0x52];

export interface TraceHeader {
  version: number;
  contentHash: string;
  contentRule: number;
  configKey: string;
  board: string;
  layoutDigest: string;
  fps: number;
  frames: number;
  frameBytes: number;
  byteLength: number;
  codec: 'xor-deflate' | 'deflate';
  payloadBytes: number;
  stillBytes: number;
}

export interface DecodedTrace {
  header: TraceHeader;
  frames: Uint8Array;
  still: Uint8Array | null;
}

export function digest(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c ^ (a >>> 7), 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

const DIGESTED: { [K in keyof FrameLayout]-?: true | { absent: FrameLayout[K] } } = {
  system: true, reelCount: true, reelsByLayoutNumber: true, lampsDriven: true,
  stepsPerRevolution: true, symbols: true, lampKind: true, lampBytes: true,
  digitKind: true, digitBytes: true, displayKind: true, hasSegs: true,
  diagBytes: true, diagRamBase: true, dutyBytes: true, dotBytes: true,
  lcdBytes: true, muxLedBytes: true, muxLedFirst: true, ledBytes: true,
  udfBytes: true, videoWidth: true, videoHeight: true, videoBytes: true,
  effectBytes: true, reelStripOffsets: true, unserved: true, byteLength: true,
  cellDots: { absent: false },
  ledKind: { absent: 'bfm' },
  ledCount: { absent: undefined },
  partSoundBytes: { absent: 0 },
  levelBytes: { absent: undefined },
  format: { absent: FRAME_FORMAT },
};

export function layoutDigest(fl: FrameLayout): string {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fl)) {
    const how = (DIGESTED as Record<string, true | { absent: unknown }>)[k];
    if (how !== undefined && how !== true && v === how.absent) continue;
    o[k] = v;
  }
  return digest(JSON.stringify(o));
}

function effectRange(fl: FrameLayout): [number, number] {
  const hi = fl.byteLength - fl.udfBytes - fl.videoBytes - (fl.partSoundBytes ?? 0);
  return [hi - fl.effectBytes, hi];
}

const META_BYTES = 20;

export interface TraceInput {
  contentHash: string;
  contentRule: number;
  configKey: string;
  layout: FrameLayout;
  frames: Uint8Array[];
  still?: Uint8Array;
}

export function encodeTrace(t: TraceInput): Uint8Array {
  const fl = t.layout;
  const frameBytes = fl.byteLength - fl.videoBytes;
  const [e0, e1] = effectRange(fl);
  const plain = new Uint8Array(t.frames.length * frameBytes);
  t.frames.forEach((f, i) => {
    const row = plain.subarray(i * frameBytes, (i + 1) * frameBytes);
    row.set(f.subarray(0, frameBytes));
    row.fill(0, 0, META_BYTES);
    row.fill(0, e0, e1);
  });
  const delta = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i++) {
    delta[i] = plain[i] ^ (i >= frameBytes ? plain[i - frameBytes] : 0);
  }
  const zPlain = deflateSync(plain, { level: 9 });
  const zDelta = deflateSync(delta, { level: 9 });
  const useDelta = zDelta.length <= zPlain.length;
  const payload = useDelta ? zDelta : zPlain;
  const still = fl.videoBytes && t.still ? deflateSync(t.still, { level: 9 }) : new Uint8Array(0);
  const header: TraceHeader = {
    version: TRACE_VERSION,
    contentHash: t.contentHash,
    contentRule: t.contentRule,
    configKey: t.configKey,
    board: fl.system,
    layoutDigest: layoutDigest(fl),
    fps: TRACE_FPS,
    frames: t.frames.length,
    frameBytes,
    byteLength: fl.byteLength,
    codec: useDelta ? 'xor-deflate' : 'deflate',
    payloadBytes: payload.length,
    stillBytes: still.length,
  };
  const h = strToU8(JSON.stringify(header));
  const out = new Uint8Array(8 + h.length + payload.length + still.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, h.length, true);
  out.set(h, 8);
  out.set(payload, 8 + h.length);
  out.set(still, 8 + h.length + payload.length);
  return out;
}

export function decodeTrace(bytes: Uint8Array): DecodedTrace {
  if (bytes.length < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('not a trace');
  const hl = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const header = JSON.parse(strFromU8(bytes.subarray(8, 8 + hl))) as TraceHeader;
  const p0 = 8 + hl;
  const payload = inflateSync(bytes.subarray(p0, p0 + header.payloadBytes));
  if (payload.length !== header.frames * header.frameBytes) throw new Error('trace payload size');
  if (header.codec === 'xor-deflate') {
    for (let i = header.frameBytes; i < payload.length; i++) payload[i] ^= payload[i - header.frameBytes];
  }
  const still = header.stillBytes
    ? inflateSync(bytes.subarray(p0 + header.payloadBytes, p0 + header.payloadBytes + header.stillBytes))
    : null;
  return { header, frames: payload, still };
}

export function traceMismatch(h: TraceHeader, contentHash: string, fl: FrameLayout): string | null {
  if (h.version !== TRACE_VERSION) return `trace version ${h.version}, this build reads ${TRACE_VERSION}`;
  if (h.contentHash !== contentHash) return 'trace is of another set';
  if (h.layoutDigest !== layoutDigest(fl)) return 'trace was captured with another frame shape';
  return null;
}

export class TracePlayer {
  readonly buf: ArrayBuffer;
  private readonly bytes: Uint8Array;
  private shown = -1;

  constructor(readonly trace: DecodedTrace) {
    const h = trace.header;
    this.buf = new ArrayBuffer(h.byteLength);
    this.bytes = new Uint8Array(this.buf);
    if (trace.still) {
      this.bytes.set(trace.still.subarray(0, h.byteLength - h.frameBytes), h.frameBytes);
    }
  }

  get frames(): number { return this.trace.header.frames; }

  indexAt(t: number): number {
    const h = this.trace.header;
    const n = Math.floor(t * h.fps);
    return ((n % h.frames) + h.frames) % h.frames;
  }

  show(i: number): boolean {
    if (i === this.shown) return false;
    const h = this.trace.header;
    this.bytes.set(this.trace.frames.subarray(i * h.frameBytes, (i + 1) * h.frameBytes), 0);
    this.shown = i;
    return true;
  }
}
