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

export interface CcTalkWire {
  now: number;
  lastTxAt: number;
  frame: number[];
  queue: { at: number; b: number }[];
  addresses: Record<number, number>;
  spoken: number[];
}

export class CcTalkBus {
  private readonly devices = new Map<number, CcTalkDevice>();
  private readonly home = new Map<CcTalkDevice, number>();
  readonly wire: CcTalkWire = { now: 0, lastTxAt: 0, frame: [], queue: [], addresses: {}, spoken: [] };
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
    const home = this.home.get(dev);
    return home !== undefined && this.wire.spoken.includes(home);
  }

  resync(): void {
    this.devices.clear();
    for (const [d, a] of this.home) this.devices.set(this.wire.addresses[a] ?? a, d);
  }

  reset(): void {
    this.wire.frame = [];
    this.wire.queue = [];
    this.wire.addresses = {};
    this.wire.spoken = [];
    this.log.length = 0;
    this.devices.clear();
    for (const [d, a] of this.home) { d.reset(); this.devices.set(a, d); }
  }

  tx(v: number): void {
    const w = this.wire;
    if (w.frame.length && w.now - w.lastTxAt > this.timing.frameGap) w.frame = [];
    w.lastTxAt = w.now;
    const f = w.frame;
    f.push(v & 0xff);
    if (f.length >= 5 && f.length === 5 + (f[1] ?? 0)) {
      this.dispatch(f);
      w.frame = [];
    } else if (f.length > 260) {
      f.shift();
    }
  }

  tick(cycles: number): void {
    this.wire.now += cycles;
  }

  eventIn(): number {
    const w = this.wire;
    if (!w.queue.length) return Infinity;
    const d = w.queue[0].at - w.now;
    return d < 1 ? 1 : d;
  }

  pump(deliver: (b: number) => void, space: () => number = () => 1): void {
    const w = this.wire;
    while (w.queue.length && w.queue[0].at <= w.now && space() > 0) {
      deliver(w.queue.shift()!.b);
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
        this.wire.addresses = {};
        this.resync();
      }
      this.trace?.(req, null);
      return;
    }
    const dev = this.devices.get(dest);
    if (!dev) { this.trace?.(req, null); return; }
    const devHome = this.home.get(dev);
    if (devHome !== undefined && !this.wire.spoken.includes(devHome)) this.wire.spoken.push(devHome);

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
        delete this.wire.addresses[home];
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
      if (devHome !== undefined) this.wire.addresses[devHome] = msg.data[0] & 0xff;
    }
  }

  private send(bytes: number[]): void {
    let at = this.wire.now + this.timing.replyDelay;
    for (const b of bytes) {
      this.wire.queue.push({ at, b: b & 0xff });
      at += this.timing.byteGap;
    }
  }
}
