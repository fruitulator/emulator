export class Tms9902 {
  onTx: ((b: number) => void) | null = null;
  onInt: ((active: boolean) => void) | null = null;

  private rbr = 0;
  private xbr = 0;
  private rbrl = false;
  private xbre = true;
  private xsre = true;
  private rienb = false;
  private xbienb = false;
  private timenb = false;
  private dscenb = false;
  private timelp = false;
  private timerr = false;
  private dsch = false;
  private rtson = false;
  private rts = false;
  private rover = false;
  private brkon = false;
  private brkout = false;
  private xsr = 0;

  private ldctrl = false;
  private ldir = false;
  private lrdr = false;
  private lxdr = false;

  private ctrl = 0;
  private tmr = 0;
  private rdr = 0;
  private xdr = 0;
  private rdv8 = false;
  private clk4m = false;

  private rxQueue: number[] = [];
  private rxDelay = 0;
  private txShift = 0;
  private timerCount = 0;
  private lastInt = false;

  constructor(private readonly byteTime = 1500) {}

  private charTime(): number {
    if (this.rdr === 0) return this.byteTime;
    return 10 * 2 * (this.rdv8 ? 8 : 1) * this.rdr * (this.clk4m ? 4 : 3);
  }

  reset(): void {
    this.rbrl = false;
    this.rover = false;
    this.xbre = true;
    this.xsre = true;
    this.rienb = false;
    this.xbienb = false;
    this.timenb = false;
    this.dscenb = false;
    this.timelp = false;
    this.timerr = false;
    this.dsch = false;
    this.rtson = false;
    this.rts = false;
    this.brkon = false;
    this.brkout = false;
    this.ldctrl = true;
    this.ldir = true;
    this.lrdr = true;
    this.lxdr = true;
    this.ctrl = 0;
    this.rdr = 0;
    this.xdr = 0;
    this.xbr = 0;
    this.xsr = 0;
    this.rbr = 0;
    this.rxQueue = [];
    this.tmr = 0;
    this.timerCount = 0;
    this.txShift = 0;
    this.updateInt();
  }

  private readonly cts = true;

  private initiateTransmit(): void {
    if (this.brkon && this.cts) { this.brkout = true; return; }
    if (!this.rtson && (!this.cts || (this.xbre && !this.brkout))) { this.rts = false; return; }
    this.xsr = this.xbr;
    this.xsre = false;
    this.xbre = true;
    this.txShift = this.charTime();
  }

  load(b: number): void {
    this.rover = this.rbrl;
    this.rbr = b & 0xff;
    this.rbrl = true;
    this.updateInt();
  }

  get int(): boolean {
    return (this.dsch && this.dscenb) || (this.rbrl && this.rienb)
      || (this.xbre && this.xbienb) || (this.timelp && this.timenb);
  }

  private updateInt(): void {
    const now = this.int;
    if (now !== this.lastInt) {
      this.lastInt = now;
      this.onInt?.(now);
    }
  }

  receive(b: number): void {
    this.rxQueue.push(b & 0xff);
    const floor = this.txShift + this.charTime();
    if (this.rxDelay < floor) this.rxDelay = floor;
  }

  tick(cycles: number): void {
    if (this.tmr > 0) {
      this.timerCount += cycles;
      const period = this.tmr * 64 * (this.clk4m ? 4 : 3);
      while (this.timerCount >= period) {
        this.timerCount -= period;
        this.timerr = this.timelp;
        this.timelp = true;
      }
    }
    if (this.txShift > 0) {
      this.txShift -= cycles;
      if (this.txShift <= 0) {
        this.txShift = 0;
        this.onTx?.(this.xsr & (0xff >> (3 - (this.ctrl & 3))));
        this.xsre = true;
        if (!this.xbre && this.cts) this.initiateTransmit();
        else if (this.xbre && !this.rtson && !this.brkout) this.rts = false;
      }
    }
    if (this.rxDelay > 0) this.rxDelay -= cycles;
    if (!this.rbrl && this.rxQueue.length > 0 && this.rxDelay <= 0) {
      this.load(this.rxQueue.shift()!);
      this.rxDelay = this.charTime();
    }
    this.updateInt();
  }

  cruRead(bit: number): number {
    switch (bit & 31) {
      case 31: return this.int ? 1 : 0;
      case 30: return this.ldctrl || this.ldir || this.lrdr || this.lxdr || this.brkon ? 1 : 0;
      case 29: return this.dsch ? 1 : 0;
      case 28: return 1;
      case 27: return 1;
      case 26: return this.rts ? 1 : 0;
      case 25: return this.timelp ? 1 : 0;
      case 24: return this.timerr ? 1 : 0;
      case 23: return this.xsre ? 1 : 0;
      case 22: return this.xbre ? 1 : 0;
      case 21: return this.rbrl ? 1 : 0;
      case 20: return this.dsch && this.dscenb ? 1 : 0;
      case 19: return this.timelp && this.timenb ? 1 : 0;
      case 18: return 0;
      case 17: return this.xbre && this.xbienb ? 1 : 0;
      case 16: return this.rbrl && this.rienb ? 1 : 0;
      case 15: return 1;
      case 14: return 0;
      case 13: return 0;
      case 12: return 0;
      case 11: return this.rover ? 1 : 0;
      case 10: return 0;
      case 9: return this.rover ? 1 : 0;
      default:
        return (this.rbr >> (bit & 7)) & 1;
    }
  }

  cruWrite(bit: number, v: number): void {
    bit &= 31;
    v &= 1;
    if (bit <= 10) {
      const mask = 1 << bit;
      if (this.ldctrl) {
        if (v) this.ctrl |= mask;
        else this.ctrl &= ~mask;
        if (bit === 3) this.clk4m = v !== 0;
        if (bit === 7) this.ldctrl = false;
      } else if (this.ldir) {
        if (bit <= 7) {
          if (v) this.tmr |= mask;
          else this.tmr &= ~mask;
          if (bit === 7) {
            this.ldir = false;
            this.timerCount = 0;
          }
        }
      } else if (this.lrdr || this.lxdr) {
        if (this.lrdr) {
          if (bit < 10) {
            if (v) this.rdr |= mask;
            else this.rdr &= ~mask;
          } else {
            this.rdv8 = v !== 0;
            this.lrdr = false;
          }
        }
        if (this.lxdr) {
          if (bit < 10) {
            if (v) this.xdr |= mask;
            else this.xdr &= ~mask;
          }
        }
      } else if (bit <= 7) {
        if (v) this.xbr |= mask;
        else this.xbr &= ~mask;
        if (bit === 7) {
          this.xbre = false;
          if (this.xsre && this.rts && this.cts && !this.brkout) this.initiateTransmit();
        }
      }
      this.updateInt();
      return;
    }
    switch (bit) {
      case 11: this.lxdr = v !== 0; break;
      case 12: this.lrdr = v !== 0; break;
      case 13:
        this.ldir = v !== 0;
        if (v === 0) this.timerCount = 0;
        break;
      case 14: this.ldctrl = v !== 0; break;
      case 15: break;
      case 16:
        if (v) {
          this.rtson = true;
          this.rts = true;
          if (this.cts) {
            if (this.xsre && !this.xbre && !this.brkout) this.initiateTransmit();
            else if (this.brkon) this.brkout = true;
          }
        } else {
          this.rtson = false;
          if (this.xbre && this.xsre && !this.brkout) this.rts = false;
          this.xbienb = false;
        }
        break;
      case 17:
        this.brkon = v !== 0;
        if (this.brkout && !v) {
          this.brkout = false;
          if (!this.xbre && this.cts) this.initiateTransmit();
          else if (!this.rtson) this.rts = false;
        } else if (this.xbre && this.xsre && this.rts && this.cts) {
          this.brkout = v !== 0;
        }
        break;
      case 18:
        this.rienb = v !== 0;
        this.rbrl = false;
        break;
      case 19: this.xbienb = v !== 0; break;
      case 20:
        this.timenb = v !== 0;
        this.timelp = false;
        this.timerr = false;
        break;
      case 21:
        this.dscenb = v !== 0;
        this.dsch = false;
        break;
      case 31:
        this.reset();
        break;
    }
    this.updateInt();
  }
}
