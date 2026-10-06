import { placeRomFlat } from '../machine/pairplacer';
import { Mcs51 } from '../cpu/mcs51';

export const DOT_MACHINE_HZ = 1_000_000;

export const FRAME_BYTES = 0xf8;

export class MaygayDot {
  readonly cpu: Mcs51;
  private readonly rom = new Uint8Array(0x10000);
  private readonly xram = new Uint8Array(0x2000);

  readonly frame = new Uint8Array(FRAME_BYTES);
  frames = 0;

  private data = 0;
  private lastP3 = 0;
  private command = 0;
  private index = 0;
  private ptr = 0;
  private changed = false;

  onTransmit?: (v: number) => void;

  constructor() {
    this.cpu = new Mcs51({
      readCode: (a) => this.rom[a & 0xffff],
      readXdata: (a) => (a < 0x2000 ? this.xram[a] : 0xff),
      writeXdata: (a, v) => { if (a < 0x2000) this.xram[a] = v & 0xff; },
      readPort: () => 0xff,
      writePort: (p, v) => this.writePort(p, v),
      serialTx: (v) => this.onTransmit?.(v),
    });
  }

  loadRom(roms: Uint8Array | readonly Uint8Array[]): void {
    const list = roms instanceof Uint8Array ? [roms] : roms;
    this.rom.set(placeRomFlat(list, { max: this.rom.length, reverse: true }).image);
  }

  reset(): void {
    this.cpu.reset();
    this.data = 0;
    this.lastP3 = 0;
    this.command = 0;
    this.index = 0;
    this.ptr = 0;
    this.changed = false;
    this.cycleDebt = 0;
  }

  receive(v: number): void {
    this.cpu.serialRx(v & 0xff);
  }

  private writePort(port: number, v: number): void {
    if (port === 1) { this.data = v & 0xff; return; }
    if (port !== 3) return;
    const rise = (this.lastP3 ^ v) & v;
    if (rise & 0x04) {
      this.command = this.data >> 5;
      if (v & 0x10) {
        this.index = 0;
        if (this.command === 6) {
          if (this.changed) { this.frames++; this.changed = false; }
          this.ptr = 0;
        }
      }
    }
    if (rise & 0x20) {
      if (this.index !== 0 && this.ptr < FRAME_BYTES) {
        if (this.frame[this.ptr] !== this.data) { this.frame[this.ptr] = this.data; this.changed = true; }
        this.ptr++;
      }
      this.index = (this.index + 1) & 0xff;
    }
    this.lastP3 = v & 0xff;
  }

  private cycleDebt = 0;

  run(mainCycles: number, hostHz: number): void {
    this.cycleDebt += (mainCycles * DOT_MACHINE_HZ) / hostHz;
    while (this.cycleDebt > 0) this.cycleDebt -= this.cpu.step();
  }
}
