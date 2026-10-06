
const DEFAULT_SOURCE_RATE = 88_200;

export const KERNEL_TAPS = 32;
export const KERNEL_PHASES = 128;

export const BACKLOG_TARGET_S = 0.05;
export const BACKLOG_PULL = 0.005;
export const BACKLOG_GAIN = 0.01;
export const BACKLOG_TAU_S = 1;
export const BACKLOG_DEADBAND = 0.2;

export const PROCESSOR = `
const KERNEL_TAPS = ${KERNEL_TAPS};
const KERNEL_PHASES = ${KERNEL_PHASES};
const BACKLOG_TARGET_S = ${BACKLOG_TARGET_S};
const BACKLOG_PULL = ${BACKLOG_PULL};
const BACKLOG_GAIN = ${BACKLOG_GAIN};
const BACKLOG_TAU_S = ${BACKLOG_TAU_S};
const BACKLOG_DEADBAND = ${BACKLOG_DEADBAND};

class ChipProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // Interleaved stereo, about a second at the source rate.
    this.ring = new Float32Array(1 << 18);
    this.write = 0;
    this.read = 0;
    this.frac = 0;
    this.lastL = 0;
    this.lastR = 0;
    // Sliding window of consumed source frames, for the kernel to sit on.
    this.histLen = KERNEL_TAPS * 2;
    this.histL = new Float32Array(this.histLen);
    this.histR = new Float32Array(this.histLen);
    this.histW = 0;
    // Crossfade state for a latency trim (see push): the cursor the trim
    // jumped away from, and how many source frames of blend are left.
    this.fadeRead = 0;
    this.fadeLeft = 0;
    // Source frames of a protected one-shot still to be consumed.
    this.protect = 0;
    // Diagnostic counters, read back by Audio.stats(). They are what tells a
    // starved buffer from a trimmed-to-death one: the two sound the same and
    // read opposite, so one sign alone cannot say which is happening.
    this.nPush = 0;
    this.framesIn = 0;
    this.framesOut = 0;
    this.starvedOut = 0;
    this.nTrim = 0;
    this.trimmedFrames = 0;
    // Summed magnitude in and out (left channel), so a probe can tell a
    // path carrying silence from one carrying sound: frame counts alone
    // read the same for both.
    this.absIn = 0;
    this.absOut = 0;
    // Output samples that came out not-a-number and were cut to silence, and
    // how many times the path was restarted because of it (see process).
    this.nFault = 0;
    // The line back to the emulation loop, once it has bridged in: reports go
    // to its Diagnostics Log (see report). Null until then.
    this.reportPort = null;
    // Break-up watch (see watchBreakup): output and held samples in the
    // current window, and whether a break-up is being reported.
    this.winOut = 0;
    this.winHeld = 0;
    this.winPush = 0;
    this.breaking = false;
    this.breakFrom = 0;
    // The machine is paused on purpose (Audio.machinePaused): the starve that
    // follows is meant, so the break-up watch sits it out.
    this.paused = false;
    this.sourceRate = options.processorOptions.sourceRate;
    // Smoothed backlog, started AT the target so a fresh graph does not spend
    // its first second correcting a level it has not measured yet.
    this.availAvg = this.sourceRate * BACKLOG_TARGET_S;
    // The context rate, taken once: \`sampleRate\` is a global of the audio
    // worklet scope and does not change under a live processor.
    this.ctxRate = sampleRate;
    this.setFade(this.sourceRate);
    this.setRatio(this.sourceRate / sampleRate);
    this.port.onmessage = (ev) => this.onPortMessage(ev);
  }

  /** Chunks and rate changes arrive on the node port, or -- when the
   *  emulation loop lives in a worker -- on a bridged MessagePort handed
   *  over via {bridge}. Both ends speak the same messages. */
  onPortMessage(ev) {
    const d = ev.data;
    if (d && d.bridge) {
      d.bridge.onmessage = (e) => this.onPortMessage(e);
      this.reportPort = d.bridge;
      return;
    }
    if (d && d.chunk) {
      // The emulation loop's chunk, carrying the rate its source renders at
      // NOW. A board can re-clock its chip after the graph was told a rate
      // (a sound card whose game programs its own sample clock), and a stale
      // rate plays every sample off-pitch and the backlog off its set point.
      if (d.rate > 0 && d.rate !== this.sourceRate) this.retime(d.rate);
      this.push(d.chunk);
      return;
    }
    if (d && d.tone) {
      // A diagnostic one-shot (Audio.testTone). It is deliberately a far
      // bigger backlog than the latency trim allows, so it says so rather
      // than being guessed at by size -- a stall's catch-up push is just as
      // big and must still be trimmed.
      this.push(d.tone, true);
      return;
    }
    if (d && d.stats) {
      this.port.postMessage({ stats: {
        available: this.available(), sourceRate: this.sourceRate, ratio: this.ratio,
        nPush: this.nPush, framesIn: this.framesIn, framesOut: this.framesOut,
        starvedOut: this.starvedOut, nTrim: this.nTrim, trimmedFrames: this.trimmedFrames,
        absIn: this.absIn, absOut: this.absOut, nFault: this.nFault,
      } });
      return;
    }
    if (d && d.silence) {
      // The machine that was feeding this is gone (Audio.silence).
      this.flush();
      this.setPaused(false);
      return;
    }
    if (d && (d.pause || d.unpause)) {
      this.setPaused(!!d.pause);
      return;
    }
    if (d && d.rate) {
      // A new source with a different rate attached; drop the backlog,
      // which was rendered at the old rate -- and the held sample with it,
      // since it belongs to a source that is no longer playing.
      this.sourceRate = d.rate;
      this.setFade(this.sourceRate);
      this.setRatio(this.sourceRate / sampleRate);
      this.flush();
      this.setPaused(false);
    } else {
      this.push(d);
    }
  }

  /**
   * Follow a source whose rate changed under a running game. Unlike a new
   * source (the \`rate\` message) nothing is dropped: the backlog was
   * rendered by the same chip moments ago and plays on at the new rate, which
   * is at most a trim's worth of audio slightly off-pitch, where flushing it
   * would be a gap.
   */
  retime(rate) {
    const was = this.sourceRate;
    this.sourceRate = rate;
    this.setFade(rate);
    this.setRatio(rate / this.ctxRate);
    this.availAvg *= rate / was;
  }

  /** Tell the emulation loop something it should put in the Diagnostics Log. */
  report(text) {
    const port = this.reportPort || this.port;
    try { port.postMessage({ audioReport: text }); } catch (e) { /* the loop has gone */ }
  }

  /**
   * Enter or leave a deliberate pause. Either way the window in progress is
   * dropped: it straddles the edge, so its share of held output measures the
   * pause, not the machine. A break-up that was being reported ends here
   * without a line, because what follows is a fresh start, not a recovery.
   */
  setPaused(on) {
    this.paused = on;
    this.winOut = 0;
    this.winHeld = 0;
    this.winPush = 0;
    this.breaking = false;
  }

  /**
   * Say when the sound is breaking up, and when it stops, rather than leaving
   * a listener to guess. A window is about a second of output; a window in
   * which the machine delivered sound but more than a quarter of the output
   * was a held level is a break-up, and the first window back under 2%
   * ends it. A window with nothing delivered at all is a paused machine,
   * which is meant, and says nothing.
   */
  watchBreakup(blockFrames, heldInBlock) {
    if (this.paused) return;
    this.winOut += blockFrames;
    this.winHeld += heldInBlock;
    if (this.winOut < this.ctxRate) return;
    const share = this.winHeld / this.winOut;
    const delivered = this.winPush > 0;
    this.winOut = 0;
    this.winHeld = 0;
    this.winPush = 0;
    if (!delivered) return;
    if (!this.breaking && share > 0.25) {
      this.breaking = true;
      this.breakFrom = this.framesOut;
      this.report('breaking up: the machine is running behind real time, and '
        + Math.round(share * 100) + '% of the last second was silence while it caught up');
    } else if (this.breaking && share < 0.02) {
      this.breaking = false;
      const secs = (this.framesOut - this.breakFrom) / this.ctxRate;
      this.report('steady again after ' + secs.toFixed(1) + ' s of breaking up');
    }
  }

  /**
   * Forget everything held: the backlog, the blend it was in the middle of,
   * and the history the kernel sits on.
   *
   * The history is the part that matters. An underrun does not output zero --
   * it stops the window advancing and holds the last level, which is what
   * keeps a stalled frame from clicking. With nothing ever arriving again
   * that hold is permanent, so the last sample of a machine that has stopped
   * stays on the output as a DC offset for as long as the page is open.
   * Zeroing the ring alone does not help: the kernel would go on convolving
   * the old history. (Measured after leaving a game, see web/audio.ts's
   * header.)
   */
  flush() {
    this.read = this.write;
    this.fadeLeft = 0; // the frames it would have blended are gone too
    this.protect = 0;
    this.lastL = 0;
    this.lastR = 0;
    this.histL.fill(0);
    this.histR.fill(0);
    // The backlog this was tracking belonged to what has just been dropped.
    this.availAvg = this.sourceRate * BACKLOG_TARGET_S;
    this.ratio = this.baseRatio;
  }

  /**
   * Build the windowed-sinc kernel for a given rate ratio.
   *
   * Downsampling is the case that matters: every chip here renders above
   * 48 kHz or well below it, and the YMZ280B's 88.2 kHz carries real energy
   * past the output Nyquist. Linear interpolation does not remove it, it
   * folds it -- measured, a 40 kHz tone came back as 8 kHz at nearly half
   * full scale. So the cutoff tracks the *lower* of the two Nyquists, and the
   * kernel does the interpolation and the band-limiting in one pass.
   *
   * Each phase is normalised to unity DC gain, so the passband level does not
   * ripple as the fractional cursor moves.
   */
  setRatio(ratio) {
    // baseRatio is the true rate ratio and what the kernel is cut for; ratio
    // is it plus the backlog correction (see trackBacklog), which is small
    // enough that the kernel does not need rebuilding for it.
    this.baseRatio = ratio;
    this.ratio = ratio;
    // Cutoff as a fraction of the source rate. Backed off slightly so the
    // finite kernel's transition band sits below Nyquist rather than across
    // it, which is what would let the top of the band alias.
    const cutoff = 0.5 * Math.min(1, 1 / ratio) * 0.94;
    const table = new Float32Array((KERNEL_PHASES + 1) * KERNEL_TAPS * 2);
    for (let p = 0; p <= KERNEL_PHASES; p++) {
      const f = p / KERNEL_PHASES;
      const base = p * KERNEL_TAPS * 2;
      let sum = 0;
      for (let k = -KERNEL_TAPS + 1; k <= KERNEL_TAPS; k++) {
        const x = k - f;
        const t = 2 * cutoff * x;
        const sinc = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
        // Blackman over the whole window: a deep stopband matters more here
        // than a narrow transition, because what leaks through is not noise
        // but a tone in the wrong place.
        const u = (x + KERNEL_TAPS - 1) / (2 * KERNEL_TAPS - 1);
        const w = u < 0 || u > 1 ? 0
          : 0.42 - 0.5 * Math.cos(2 * Math.PI * u) + 0.08 * Math.cos(4 * Math.PI * u);
        const h = sinc * w;
        table[base + k + KERNEL_TAPS - 1] = h;
        sum += h;
      }
      if (sum !== 0) {
        for (let k = 0; k < KERNEL_TAPS * 2; k++) table[base + k] /= sum;
      }
    }
    this.kernel = table;
  }

  push(chunk, oneShot) {
    const len = this.ring.length;
    this.nPush++;
    this.winPush++;
    this.framesIn += chunk.length >> 1;
    for (let i = 0; i < chunk.length; i++) {
      if ((i & 1) === 0) this.absIn += Math.abs(chunk[i]);
      this.ring[this.write] = chunk[i];
      this.write = (this.write + 1) % len;
    }
    // Clock drift between the machine and the audio device is inevitable, so
    // the backlog has to be capped -- but the cap is also the latency, since
    // a steady overrun parks the buffer at it. Keep it short.
    //
    // A one-shot is protected until it has been CONSUMED, not merely until the
    // next push: sizing the reprieve to the arriving chunk protects it for one
    // push only, and the next chunk then evicts the rest of it.
    if (oneShot) this.protect = chunk.length >> 1;
    const maxFrames = this.sourceRate * 0.12;
    // The same target trackBacklog holds, so the backstop and the tracker
    // cannot drift apart into two different ideas of where the buffer sits.
    const lowFrames = this.sourceRate * BACKLOG_TARGET_S;
    if (this.protect <= 0 && this.available() > maxFrames) {
      // WHOLE frames: the ring is indexed by an integer, and a rate whose
      // twentieth is not whole (17841 Hz, a sound card's own clock) used to
      // put the read cursor between two samples here -- after which every
      // read was undefined, every output sample was NaN, and the sound was
      // gone for good on the first trim (B-260928-113159).
      const keep = Math.round(Math.min(lowFrames, (len >> 1) - 1));
      // The trim splices two unrelated points of the waveform together, and a
      // bare jump of read is a step discontinuity, which is heard as a click.
      // Fade across it instead: the frames being dropped are still in the ring,
      // so process() can blend the old continuation into the new one.
      this.fadeRead = this.read;
      this.fadeLeft = this.fadeFrames;
      const was = this.available();
      this.read = (this.write - keep * 2 + len) % len;
      this.nTrim++;
      this.trimmedFrames += was - this.available();
    }
  }

  /** Crossfade length for a trim: ~4 ms, long enough that the splice is a
   *  slope rather than an edge and short enough to stay inaudible. */
  setFade(rate) {
    this.fadeFrames = Math.max(8, Math.round(rate * 0.004));
  }

  /**
   * Hold the backlog at the target by resampling a shade fast when there is
   * too much of it and a shade slow when there is too little, once per block.
   *
   * The machine's clock and the audio device's clock are independent, and
   * every interruption -- a stall, a slow frame, a tab coming back -- leaves
   * the backlog at a new level. Without this nothing ever moves it again: it
   * stays wherever it landed for the rest of the session, which is either a
   * permanent extra delay or a seat right next to the trim, where ordinary
   * jitter makes it fire over and over.
   *
   * The correction is proportional to a SMOOTHED occupancy, not the
   * instantaneous one: the backlog sawtooths by a whole producer tick, and
   * chasing that would be a wobble in the pitch rather than a correction to
   * it. It is bounded at 0.5%, under nine cents, and it is proportional so it
   * falls to nothing as the backlog reaches the target -- a converged stream
   * plays at exactly the right rate.
   *
   * This is the gentle half of the pair. The trim below it stays as the
   * backstop for a burst too big to resample away.
   */
  trackBacklog(blockFrames) {
    const target = this.sourceRate * BACKLOG_TARGET_S;
    const k = Math.min(1, blockFrames / (this.ctxRate * BACKLOG_TAU_S));
    this.availAvg += (this.available() - this.availAvg) * k;
    // Both directions. The producer replaces what was consumed and never
    // adds, so neither a surplus nor a deficit goes away on its own: a stall
    // parks the buffer high, a pause parks it low, and low is the one that
    // starves. Consuming a shade slow is what refills it.
    const err = (this.availAvg - target) / target;
    // Measured from the edge of the deadband, so nothing happens inside it and
    // the correction has no step at the boundary.
    const out = err > BACKLOG_DEADBAND ? err - BACKLOG_DEADBAND
      : err < -BACKLOG_DEADBAND ? err + BACKLOG_DEADBAND : 0;
    const adj = Math.max(-BACKLOG_PULL, Math.min(BACKLOG_PULL, out * BACKLOG_GAIN));
    this.ratio = this.baseRatio * (1 + adj);
  }

  available() {
    const len = this.ring.length;
    return ((this.write - this.read + len) % len) >> 1;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0], right = out[1];
    const len = this.ring.length;
    const H = this.histLen, T = KERNEL_TAPS;
    const hL = this.histL, hR = this.histR, kern = this.kernel;
    this.framesOut += left.length;
    const heldBefore = this.starvedOut;
    // Once per block, before any of it is consumed.
    this.trackBacklog(left.length);
    for (let i = 0; i < left.length; i++) {
      // Consume whole source frames until the fractional cursor is in range.
      // An underrun simply stops the window advancing: the kernel then sits on
      // unchanged history and holds a steady level instead of clicking.
      while (this.frac >= 1) {
        if (this.available() < 2) {
          // Underrun: with nothing to consume the cursor would run away and
          // index past the end of the kernel table. Park it at the last phase
          // so the output holds steady and picks up cleanly when data lands.
          this.frac = 1;
          this.starvedOut++; // this output sample is a held level, not audio
          break;
        }
        let sL = this.ring[this.read];
        let sR = this.ring[(this.read + 1) % len];
        if (this.fadeLeft > 0) {
          // t runs 0 -> 1 across the fade, so the first blended frame is
          // exactly the old stream and the last is exactly the new one.
          const t = 1 - this.fadeLeft / this.fadeFrames;
          const oL = this.ring[this.fadeRead];
          const oR = this.ring[(this.fadeRead + 1) % len];
          sL = oL + (sL - oL) * t;
          sR = oR + (sR - oR) * t;
          this.fadeRead = (this.fadeRead + 2) % len;
          this.fadeLeft--;
        }
        this.lastL = sL;
        this.lastR = sR;
        hL[this.histW] = this.lastL;
        hR[this.histW] = this.lastR;
        this.histW = (this.histW + 1) % H;
        this.read = (this.read + 2) % len;
        if (this.protect > 0) this.protect--;
        this.frac -= 1;
      }
      // The kernel is centred T+1 frames behind the newest sample, which is
      // what buys it its future taps; the cost is a fixed T-frame delay.
      const c = (this.histW - T - 1 + H) % H;
      const base = Math.round(this.frac * KERNEL_PHASES) * T * 2;
      let l = 0, r = 0;
      for (let k = 0; k < T * 2; k++) {
        const h = kern[base + k];
        const idx = (c + k - T + 1 + H) % H;
        l += h * hL[idx];
        r += h * hR[idx];
      }
      if (l !== l || r !== r) {
        // Not a number. Whatever put it here, it would otherwise stay: the
        // kernel sits on the history, and a cursor that is no longer whole
        // reads nothing but NaN from then on. Silence this sample, clear the
        // history, put the cursor back on a whole frame, and say so.
        l = 0;
        r = 0;
        this.recover();
      }
      left[i] = l;
      right[i] = r;
      this.absOut += Math.abs(l);
      this.frac += this.ratio;
    }
    this.watchBreakup(left.length, this.starvedOut - heldBefore);
    return true;
  }

  /** Put the path back after a NaN (see process): the backlog is kept. */
  recover() {
    const len = this.ring.length;
    this.read = (Math.round(this.read / 2) * 2) % len;
    this.fadeRead = (Math.round(this.fadeRead / 2) * 2) % len;
    if (this.frac !== this.frac) this.frac = 1;
    this.lastL = 0;
    this.lastR = 0;
    this.histL.fill(0);
    this.histR.fill(0);
    if (this.nFault++ === 0 || this.nFault % 1000 === 0) {
      this.report('the sound output went invalid and was restarted (' + this.nFault + ' samples so far)');
    }
  }
}
registerProcessor('chip', ChipProcessor);
`;

export function toneChunk(freq: number, seconds: number, rate = DEFAULT_SOURCE_RATE): Float32Array {
  const frames = Math.floor(rate * seconds);
  const chunk = new Float32Array(frames * 2);
  const fade = Math.max(1, Math.floor(frames * 0.05));
  for (let i = 0; i < frames; i++) {
    let a = 0.3;
    if (i < fade) a *= i / fade;
    else if (i > frames - fade) a *= (frames - i) / fade;
    const v = Math.sin((2 * Math.PI * freq * i) / rate) * a;
    chunk[i * 2] = v;
    chunk[i * 2 + 1] = v;
  }
  return chunk;
}

export interface AudioStats {
  available: number;
  sourceRate: number;
  ratio: number;
  nPush: number;
  framesIn: number;
  framesOut: number;
  starvedOut: number;
  nTrim: number;
  trimmedFrames: number;
  absIn: number;
  absOut: number;
  nFault: number;
}

export function autoplayPolicy(): string | null {
  const nav = navigator as Navigator & { getAutoplayPolicy?: (type: string) => string };
  try {
    return nav.getAutoplayPolicy?.('audiocontext') ?? null;
  } catch {
    return null;
  }
}

export class Audio {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private fx: GainNode | null = null;

  context(): AudioContext | null {
    return this.ctx;
  }

  effectsOutput(): AudioNode | null {
    if (!this.ctx || !this.gain) return null;
    if (!this.fx) {
      this.fx = this.ctx.createGain();
      this.fx.connect(this.gain);
    }
    return this.fx;
  }
  private sourceRate = DEFAULT_SOURCE_RATE;
  private volume = 0.8;
  private wanted = false;
  private nudgeCountdown = 0;

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  get isWanted(): boolean {
    return this.wanted;
  }

  onStateChange: ((state: string) => void) | null = null;

  attach(rate: number | null): void {
    this.sourceRate = rate ?? DEFAULT_SOURCE_RATE;
    this.node?.port.postMessage({ rate: this.sourceRate });
  }

  bridge(): MessagePort | null {
    if (!this.node) return null;
    const ch = new MessageChannel();
    this.node.port.postMessage({ bridge: ch.port1 }, [ch.port1]);
    return ch.port2;
  }

  async resume(): Promise<void> {
    if (!this.ctx) {
      const ctx = new AudioContext();
      const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } catch (err) {
        void ctx.close().catch(() => {});
        throw err;
      } finally {
        URL.revokeObjectURL(url);
      }
      this.gain = ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(ctx.destination);
      this.node = new AudioWorkletNode(ctx, 'chip', {
        numberOfInputs: 0,
        outputChannelCount: [2],
        processorOptions: { sourceRate: this.sourceRate },
      });
      this.node.port.onmessage = (ev: MessageEvent) => {
        const s = (ev.data as { stats?: AudioStats } | null)?.stats;
        if (s) { const w = this.statWaiters; this.statWaiters = []; for (const r of w) r(s); }
      };
      this.node.connect(this.gain);
      ctx.onstatechange = () => this.onStateChange?.(ctx.state);
      this.ctx = ctx;
    }
    await this.ctx.resume();
    this.wanted = true;
  }

  suspend(): void {
    this.wanted = false;
    void this.ctx?.suspend();
  }

  silence(): void {
    this.node?.port.postMessage({ silence: true });
  }

  machinePaused(): void {
    this.node?.port.postMessage({ pause: true });
  }

  machineResumed(): void {
    this.node?.port.postMessage({ unpause: true });
  }

  nudge(): void {
    if (!this.wanted || !this.ctx || this.ctx.state === 'running') return;
    if (this.nudgeCountdown-- > 0) return;
    this.nudgeCountdown = 30;
    void this.ctx.resume().catch(() => {});
  }

  async testTone(): Promise<void> {
    await this.resume();
    if (!this.node) throw new Error('audio graph did not start');
    const chunk = toneChunk(440, 0.4, this.sourceRate);
    this.node.port.postMessage({ tone: chunk }, [chunk.buffer]);
  }

  private statWaiters: ((s: AudioStats) => void)[] = [];

  stats(timeoutMs = 500): Promise<AudioStats | null> {
    if (!this.node) return Promise.resolve(null);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.statWaiters = this.statWaiters.filter((w) => w !== done);
        resolve(null);
      }, timeoutMs);
      const done = (s: AudioStats): void => { clearTimeout(t); resolve(s); };
      this.statWaiters.push(done);
      this.node!.port.postMessage({ stats: true });
    });
  }

  describe(): string {
    const policy = autoplayPolicy();
    const tail = policy ? ` autoplay=${policy}` : '';
    if (!this.ctx) return `audio: not started${tail}`;
    const parts = [
      `state=${this.ctx.state}`,
      `wanted=${this.wanted ? 'yes' : 'no'}`,
      `rate=${this.ctx.sampleRate}`,
      `worklet=${this.node ? 'yes' : 'no'}`,
      `sourceRate=${this.sourceRate}`,
      `gain=${this.gain?.gain.value.toFixed(2) ?? '-'}`,
    ];
    return 'audio: ' + parts.join(' ') + tail;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }
}
