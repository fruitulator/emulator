import { Z80_DAISY_IEO, Z80_DAISY_INT, type Z80DaisyDevice } from './z80daisy';

const MODE_OUTPUT = 0;
const MODE_INPUT = 1;
const MODE_BIDIRECTIONAL = 2;
const MODE_BIT_CONTROL = 3;

const NEXT_ANY = 0;
const NEXT_IOR = 1;
const NEXT_MASK = 2;

const ICW_ENABLE_INT = 0x80;
const ICW_MASK_FOLLOWS = 0x10;

export const PIO_PORT_A = 0;
export const PIO_PORT_B = 1;

export interface Z80PioHooks {
  int?(asserted: boolean): void;
  inA?(): number;
  inB?(): number;
  outA?(v: number): void;
  outB?(v: number): void;
  ardy?(state: boolean): void;
  brdy?(state: boolean): void;
}

class PioPort {
  mode = MODE_INPUT;
  nextControlWord = NEXT_ANY;
  input = 0;
  output = 0;
  ior = 0;
  rdy = false;
  stb = false;
  ie = false;
  ip = false;
  ius = false;
  icw = 0;
  vector = 0;
  mask = 0;
  match = false;

  constructor(private readonly pio: Z80Pio, readonly index: number) {}

  private get isA(): boolean { return this.index === PIO_PORT_A; }

  private portIn(): number {
    const h = this.pio.hooks;
    return ((this.isA ? h.inA?.() : h.inB?.()) ?? 0) & 0xff;
  }

  private portOut(v: number): void {
    const h = this.pio.hooks;
    if (this.isA) h.outA?.(v & 0xff);
    else h.outB?.(v & 0xff);
  }

  reset(): void {
    this.setMode(MODE_INPUT);
    this.icw &= ~ICW_ENABLE_INT;
    this.ie = false;
    this.ip = false;
    this.ius = false;
    this.match = false;
    this.ior = 0;
    this.mask = 0xff;
    this.output = 0;
    this.setRdy(false);
  }

  private triggerInterrupt(): void {
    this.ip = true;
    this.pio.checkInterrupts();
  }

  setRdy(state: boolean): void {
    if (this.rdy === state) return;
    this.rdy = state;
    if (this.isA) this.pio.hooks.ardy?.(state);
    else this.pio.hooks.brdy?.(state);
  }

  private setMode(mode: number): void {
    switch (mode) {
      case MODE_OUTPUT:
        this.portOut(this.output);
        this.setRdy(true);
        this.mode = mode;
        break;
      case MODE_INPUT:
        this.mode = mode;
        break;
      case MODE_BIDIRECTIONAL:
        if (this.isA) this.mode = mode;
        break;
      default:
        if (this.isA || this.pio.ports[PIO_PORT_A].mode !== MODE_BIDIRECTIONAL) this.setRdy(false);
        this.ie = false;
        this.pio.checkInterrupts();
        this.match = false;
        this.nextControlWord = NEXT_IOR;
        this.mode = mode;
        break;
    }
  }

  strobe(state: boolean): void {
    if (this.pio.ports[PIO_PORT_A].mode === MODE_BIDIRECTIONAL) {
      if (this.rdy) {
        if (this.stb && !state) {
          if (this.isA) this.portOut(this.output);
          else this.pio.ports[PIO_PORT_A].input = (this.pio.hooks.inA?.() ?? 0) & 0xff;
        } else if (!this.stb && state) {
          this.triggerInterrupt();
          this.setRdy(false);
        }
      }
    } else if (this.mode === MODE_OUTPUT) {
      if (this.rdy && !this.stb && state) {
        this.triggerInterrupt();
        this.setRdy(false);
      }
    } else if (this.mode === MODE_INPUT) {
      if (!state) {
        this.input = this.portIn();
      } else if (!this.stb && state) {
        this.triggerInterrupt();
        this.setRdy(false);
      }
    }
    this.stb = state;
  }

  read(): number {
    switch (this.mode) {
      case MODE_OUTPUT: return this.output;
      case MODE_BIDIRECTIONAL: return this.isA ? this.output : 0xff;
      case MODE_BIT_CONTROL: return (this.ior | (this.output & (this.ior ^ 0xff))) & 0xff;
      default: return 0xff;
    }
  }

  write(data: number): void {
    if (this.mode !== MODE_BIT_CONTROL) return;
    this.input = data & 0xff;
    const mask = ~this.mask & 0xff;
    const d = ((this.input & this.ior) | (this.output & ~this.ior)) & mask;
    let match = false;
    switch (this.icw & 0x60) {
      case 0x00: match = d !== mask; break;
      case 0x20: match = d !== 0; break;
      case 0x40: match = d === 0; break;
      default: match = d === mask; break;
    }
    if (!this.match && match && !this.ius) this.ip = true;
    this.match = match;
    this.pio.checkInterrupts();
  }

  controlWrite(data: number): void {
    data &= 0xff;
    switch (this.nextControlWord) {
      case NEXT_ANY:
        if (!(data & 1)) {
          this.vector = data;
        } else {
          switch (data & 0x0f) {
            case 0x0f:
              this.setMode(data >> 6);
              break;
            case 0x07:
              this.icw = data;
              if (this.icw & ICW_MASK_FOLLOWS) {
                this.ie = false;
                this.ip = false;
                this.pio.checkInterrupts();
                this.match = false;
                this.nextControlWord = NEXT_MASK;
              } else {
                this.ie = (this.icw & 0x80) !== 0;
                this.pio.checkInterrupts();
              }
              break;
            case 0x03:
              this.icw = (data & 0x80) | (this.icw & 0x7f);
              this.ie = (this.icw & 0x80) !== 0;
              this.pio.checkInterrupts();
              break;
            default:
              break;
          }
        }
        break;
      case NEXT_IOR:
        this.ior = data;
        this.ie = (this.icw & 0x80) !== 0;
        this.pio.checkInterrupts();
        this.nextControlWord = NEXT_ANY;
        break;
      default:
        this.mask = data;
        this.ie = (this.icw & 0x80) !== 0;
        this.pio.checkInterrupts();
        this.nextControlWord = NEXT_ANY;
        break;
    }
  }

  dataRead(): number {
    switch (this.mode) {
      case MODE_OUTPUT:
        return this.output;
      case MODE_INPUT:
        if (!this.stb) this.input = this.portIn();
        this.setRdy(false);
        this.setRdy(true);
        return this.input;
      case MODE_BIDIRECTIONAL: {
        const b = this.pio.ports[PIO_PORT_B];
        b.setRdy(false);
        b.setRdy(true);
        return this.input;
      }
      default:
        this.input = this.portIn();
        return ((this.input & this.ior) | (this.output & (this.ior ^ 0xff))) & 0xff;
    }
  }

  dataWrite(data: number): void {
    data &= 0xff;
    switch (this.mode) {
      case MODE_OUTPUT:
        this.setRdy(false);
        this.output = data;
        this.portOut(this.output);
        this.setRdy(true);
        break;
      case MODE_INPUT:
        this.output = data;
        break;
      case MODE_BIDIRECTIONAL:
        this.setRdy(false);
        this.output = data;
        if (!this.stb) this.portOut(data);
        this.setRdy(true);
        break;
      default:
        this.output = data;
        this.portOut(this.ior | (this.output & (this.ior ^ 0xff)));
        break;
    }
  }
}

export class Z80Pio implements Z80DaisyDevice {
  readonly ports: [PioPort, PioPort];

  constructor(readonly hooks: Z80PioHooks = {}) {
    this.ports = [new PioPort(this, PIO_PORT_A), new PioPort(this, PIO_PORT_B)];
  }

  reset(): void {
    this.ports[0].reset();
    this.ports[1].reset();
  }

  read(offset: number): number {
    return offset & 2 ? this.controlRead() : this.dataRead(offset & 1);
  }

  write(offset: number, data: number): void {
    if (offset & 2) this.controlWrite(offset & 1, data);
    else this.dataWrite(offset & 1, data);
  }

  controlRead(): number {
    return ((this.ports[0].icw & 0xc0) | (this.ports[1].icw >> 4)) & 0xff;
  }

  controlWrite(port: number, data: number): void {
    this.ports[port & 1].controlWrite(data);
  }

  dataRead(port: number): number {
    return this.ports[port & 1].dataRead();
  }

  dataWrite(port: number, data: number): void {
    this.ports[port & 1].dataWrite(data);
  }

  portRead(port: number): number {
    return this.ports[port & 1].read();
  }

  portWrite(port: number, data: number): void {
    this.ports[port & 1].write(data);
  }

  strobe(port: number, state: boolean): void {
    this.ports[port & 1].strobe(state);
  }

  checkInterrupts(): void {
    const ius = this.ports[0].ius || this.ports[1].ius;
    let asserted = false;
    for (const p of this.ports) if (!ius && p.ie && p.ip) asserted = true;
    this.hooks.int?.(asserted);
  }

  daisyIrqState(): number {
    let state = 0;
    for (const p of this.ports) {
      if (p.ius) return Z80_DAISY_IEO;
      if (p.ie && p.ip) state = Z80_DAISY_INT;
    }
    return state;
  }

  daisyIrqAck(): number {
    for (const p of this.ports) {
      if (p.ip) {
        p.ip = false;
        p.ius = true;
        this.checkInterrupts();
        return p.vector;
      }
    }
    return 0;
  }

  daisyIrqReti(): void {
    for (const p of this.ports) {
      if (p.ius) {
        p.ius = false;
        this.checkInterrupts();
        return;
      }
    }
  }
}
