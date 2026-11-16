import type { AudioSource } from '../machine/machine';

export class Mixer implements AudioSource {
  readonly rate: number;
  private readonly sources: readonly AudioSource[];
  private readonly weights: readonly number[];
  private readonly scratch: Float32Array;

  constructor(sources: readonly AudioSource[], weights: readonly number[] = []) {
    if (!sources.length) throw new Error('a mixer needs at least one source');
    if (weights.length > sources.length) throw new Error('more mixer weights than sources');
    const rate = sources[0].rate;
    for (const s of sources) {
      if (s.rate !== rate) {
        throw new Error(`mixer inputs disagree on rate: ${s.rate} vs ${rate}`);
      }
    }
    this.rate = rate;
    this.sources = sources;
    this.weights = sources.map((_, i) => weights[i] ?? 1);
    this.scratch = new Float32Array(4096 * 2);
  }

  buffered(): number {
    let n = Infinity;
    for (const s of this.sources) n = Math.min(n, s.buffered());
    return n === Infinity ? 0 : n;
  }

  readAudio(out: Float32Array, frames: number): number {
    const have = Math.min(frames, this.buffered());
    out.fill(0, 0, frames * 2);
    if (have <= 0) return 0;

    for (let k = 0; k < this.sources.length; k++) {
      const s = this.sources[k];
      const w = this.weights[k];
      let done = 0;
      while (done < have) {
        const chunk = Math.min(have - done, this.scratch.length >> 1);
        const got = s.readAudio(this.scratch, chunk);
        if (got <= 0) break;
        if (w === 1) for (let i = 0; i < got * 2; i++) out[done * 2 + i] += this.scratch[i];
        else for (let i = 0; i < got * 2; i++) out[done * 2 + i] += this.scratch[i] * w;
        done += got;
      }
    }
    return have;
  }
}
