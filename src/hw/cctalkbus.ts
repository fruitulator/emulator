import { CC, type CcTalkDevice } from './cctalk';

export const CCTALK_HOST = 1;

export interface CcTalkBusTiming {
  replyDelay: number;
  byteGap: number;
  frameGap: number;
}

export interface CcTalkFrame {
  dest: number;
  src: number;
  header: number;
  data: number[];
}

export class CcTalkBus {
  private readonly devices = new Map<number, CcTalkDevice>();
  private readonly home = new Map<CcTalkDevice, number>();
  private readonly spoken = new Set<CcTalkDevice>();
  private frame: number[] = [];
  private now = 0;
  private lastTxAt = 0;
  private queue: { at: number; b: number }[] = [];
  readonly log: CcTalkFrame[] = [];
  trace?: (req: CcTalkFrame, reply: number[] | null) => void;

  constructor(private readonly timing: CcTalkBusTiming) {}

  fit(address: number, dev: CcTalkDevice): void {
    for (const [a, d] of this.devices) if (d === dev) this.devices.delete(a);
    this.devices.set(address & 0xff, dev);
    this.home.set(dev, address & 0xff);
  }

  remove(address: number): void {
    const dev = this.devices.get(address & 0xff);
    this.devices.delete(address & 0xff);
    if (dev) this.home.delete(dev);
  }

  deviceAt(address: number): CcTalkDevice | undefined {
    return this.devices.get(address & 0xff);
  }

  addressOf(dev: CcTalkDevice): number {
    for (const [a, d] of this.devices) if (d === dev) return a;
    return -1;
  }

  spokenTo(dev: CcTalkDevice): boolean {
    return this.spoken.has(dev);
  }

  reset(): void {
    this.frame = [];
    this.queue = [];
    this.spoken.clear();
    this.log.length = 0;
    this.devices.clear();
    for (const [d, a] of this.home) { d.reset(); this.devices.set(a, d); }
  }

  tx(v: number): void {
    if (this.frame.length && this.now - this.lastTxAt > this.timing.frameGap) this.frame = [];
    this.lastTxAt = this.now;
    const f = this.frame;
    f.push(v & 0xff);
    if (f.length >= 5 && f.length === 5 + (f[1] ?? 0)) {
      this.dispatch(f);
      this.frame = [];
    } else if (f.length > 260) {
      f.shift();
    }
  }

  tick(cycles: number): void {
    this.now += cycles;
  }

  eventIn(): number {
    if (!this.queue.length) return Infinity;
    const d = this.queue[0].at - this.now;
    return d < 1 ? 1 : d;
  }

  pump(deliver: (b: number) => void, space: () => number = () => 1): void {
    while (this.queue.length && this.queue[0].at <= this.now && space() > 0) {
      deliver(this.queue.shift()!.b);
    }
  }

  private dispatch(f: number[]): void {
    const dest = f[0] ?? 0;
    const src = f[2] ?? CCTALK_HOST;
    const len = f[1] ?? 0;
    const req: CcTalkFrame = { dest, src, header: f[3] ?? 0, data: f.slice(4, 4 + len) };
    if (this.log.length >= 512) this.log.shift();
    this.log.push(req);

    if (dest === 0) {
      for (const d of new Set(this.devices.values())) {
        if (req.header === CC.RESET) d.reset();
        else d.reply(req.header, req.data);
      }
      if (req.header === CC.RESET) {
        this.devices.clear();
        for (const [d, a] of this.home) this.devices.set(a, d);
      }
      this.trace?.(req, null);
      return;
    }
    const dev = this.devices.get(dest);
    if (!dev) { this.trace?.(req, null); return; }
    this.spoken.add(dev);

    const msg = dev.decodeFrame ? dev.decodeFrame(f) : { header: req.header, data: req.data };
    if (!msg) { this.trace?.(req, null); return; }

    if (msg.header === CC.RESET) dev.reset();
    const rd = dev.reply(msg.header, msg.data);
    if (!rd) { this.trace?.(req, null); return; }
    if (msg.header === CC.RESET) {
      const home = this.home.get(dev);
      if (home !== undefined && home !== dest) {
        this.devices.delete(dest);
        this.devices.set(home, dev);
      }
    }

    const host = dev.decodeFrame ? CCTALK_HOST : src;
    let bytes: number[];
    if (dev.encodeFrame) {
      bytes = dev.encodeFrame(host, rd);
    } else {
      const b = [host, rd.length, dest, CC.ACK, ...rd];
      let s = 0;
      for (const x of b) s = (s + x) & 0xff;
      bytes = [...b, (0x100 - s) & 0xff];
    }
    this.send(bytes);
    this.trace?.(req, bytes);

    if (msg.header === CC.ADDRESS_CHANGE && msg.data.length >= 1 && msg.data[0] !== 0) {
      this.devices.delete(dest);
      this.devices.set(msg.data[0] & 0xff, dev);
    }
  }

  private send(bytes: number[]): void {
    let at = this.now + this.timing.replyDelay;
    for (const b of bytes) {
      this.queue.push({ at, b: b & 0xff });
      at += this.timing.byteGap;
    }
  }
}
