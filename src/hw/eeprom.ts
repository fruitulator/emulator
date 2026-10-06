export class Eeprom24c {
  readonly data: Uint8Array;

  private readonly device: number;

  private phase: 'device' | 'address' | 'data' = 'device';
  private reading = false;
  private addr = 0;
  private selected = false;
  private pageBits = 0;

  constructor(sizeBytes = 512, device = 0xa0) {
    this.data = new Uint8Array(sizeBytes).fill(0xff);
    this.device = device;
  }

  start(): void {
    this.phase = 'device';
  }

  stop(): void {
    this.phase = 'device';
    this.selected = false;
  }

  write(v: number): void {
    switch (this.phase) {
      case 'device': {
        this.selected = (v & 0xf0) === (this.device & 0xf0);
        this.reading = (v & 1) !== 0;
        this.pageBits = ((v & 0xfe) << 7) % this.data.length;
        this.phase = this.reading ? 'data' : 'address';
        break;
      }
      case 'address':
        this.addr = (this.pageBits + (v & 0xff)) % this.data.length;
        this.phase = 'data';
        break;
      case 'data':
        if (this.selected && !this.reading) {
          this.data[this.addr] = v & 0xff;
          this.addr = (this.addr + 1) % this.data.length;
        }
        break;
    }
  }

  read(): number {
    if (!this.selected) return 0xff;
    const v = this.data[this.addr];
    this.addr = (this.addr + 1) % this.data.length;
    return v;
  }
}

export class I2cBitBang {
  private scl = false;
  private sda = true;
  private bits = 0;
  private cur = 0;
  private talking = false;
  private firstByte = false;
  private txByte = 0;
  private out = true;
  private phase: 'rx' | 'ackDrive' | 'ackHold' | 'tx' | 'txAckWait' = 'rx';

  constructor(private readonly dev: Eeprom24c) {}

  reset(): void {
    this.scl = false;
    this.sda = true;
    this.bits = 0;
    this.cur = 0;
    this.talking = false;
    this.firstByte = false;
    this.txByte = 0;
    this.out = true;
    this.phase = 'rx';
  }

  data(): boolean {
    return this.out;
  }

  private driveBit(n: number): void {
    this.out = (this.txByte & (0x80 >> n)) !== 0;
  }

  set(scl: boolean, sda: boolean): void {
    if (this.scl && scl && sda !== this.sda) {
      if (!sda) {
        this.dev.start();
        this.firstByte = true;
      } else {
        this.dev.stop();
      }
      this.bits = 0;
      this.cur = 0;
      this.talking = false;
      this.out = true;
      this.phase = 'rx';
      this.sda = sda;
      return;
    }

    if (scl && !this.scl) this.risingEdge(sda);
    else if (!scl && this.scl) this.fallingEdge();

    this.scl = scl;
    this.sda = sda;
  }

  private risingEdge(sda: boolean): void {
    switch (this.phase) {
      case 'rx':
        this.cur = ((this.cur << 1) | (sda ? 1 : 0)) & 0xff;
        if (++this.bits === 8) {
          if (this.firstByte) {
            this.firstByte = false;
            this.talking = (this.cur & 1) !== 0;
          }
          this.dev.write(this.cur);
          this.bits = 0;
          this.cur = 0;
          this.phase = 'ackDrive';
        }
        break;
      case 'txAckWait':
        if (sda) {
          this.talking = false;
          this.phase = 'rx';
        } else {
          this.phase = 'ackHold';
        }
        break;
      default:
        break;
    }
  }

  private fallingEdge(): void {
    switch (this.phase) {
      case 'ackDrive':
        this.out = false;
        this.phase = 'ackHold';
        break;
      case 'ackHold':
        if (this.talking) {
          this.txByte = this.dev.read();
          this.bits = 1;
          this.driveBit(0);
          this.phase = 'tx';
        } else {
          this.out = true;
          this.phase = 'rx';
        }
        break;
      case 'tx':
        if (this.bits < 8) {
          this.driveBit(this.bits++);
        } else {
          this.out = true;
          this.phase = 'txAckWait';
        }
        break;
      default:
        break;
    }
  }
}
