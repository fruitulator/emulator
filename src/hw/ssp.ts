
const OK = 0xf0;
const UNKNOWN = 0xf2;

const SETUP = [
  0x00, 0x30, 0x31, 0x31, 0x30, 0x47, 0x42, 0x50, 0x00, 0x00, 0x01, 0x03, 0x05, 0x0a, 0x14, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x02, 0x02, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02,
];

export const SSP_CHANNEL_PENCE: readonly number[] = [500, 1000, 2000];

export const SSP_NOTE_CODE: readonly number[] = [0x80, 0x40, 0x20];

const CRC_TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let b = 0; b < 8; b++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
    t[i] = c;
  }
  return t;
})();

export function sspCrc(bytes: readonly number[]): number {
  let crc = 0xffff;
  for (const b of bytes) crc = ((crc << 8) & 0xffff) ^ CRC_TABLE[((crc >> 8) ^ b) & 0xff];
  return crc;
}

const enum Note {
  Idle = 0,
  Read = 1,
  Credited = 2,
  Rejecting = 4,
  Rejected = 5,
}

export class SspValidator {
  onReply: (bytes: number[]) => void = () => {};
  onCredit: (channel: number) => void = () => {};

  private static readonly ADDRESS = 0;

  private rxState = 0;
  private rxStuff = false;
  private rxSeq = 0;
  private rxAddr = 0;
  private rxLeft = 0;
  private rxBody: number[] = [];
  private rxCrcBytes: number[] = [];

  private lastSeq = 1;
  private lastReply: number[] = [];
  private resetPending = true;
  enabled = false;
  displayOn = false;
  inhibits = 0;
  lampsDirty = true;
  private lastReject = 0x10;
  private note = Note.Idle;
  private notePending = false;
  private noteChannel = 0;

  answered = 0;

  reset(): void {
    this.rxState = 0;
    this.rxStuff = false;
    this.rxBody = [];
    this.rxCrcBytes = [];
    this.lastSeq = 1;
    this.resetPending = true;
    this.enabled = false;
    this.displayOn = false;
    this.inhibits = 0;
    this.lampsDirty = true;
    this.lastReject = 0x10;
    this.note = Note.Idle;
    this.notePending = false;
    this.noteChannel = 0;
    this.answered = 0;
  }

  get lampByte(): number {
    return (this.inhibits | (this.displayOn ? 0x80 : 0)) & 0xff;
  }

  insertNote(channel: number): 'escrow' | 'busy' | 'inhibited' | 'unprogrammed' {
    if (channel < 1 || channel > 3) return 'unprogrammed';
    if (this.note !== Note.Idle || this.notePending) return 'busy';
    if (!this.enabled) return 'inhibited';
    this.notePending = true;
    this.noteChannel = channel;
    return this.inhibits & (1 << (channel - 1)) ? 'escrow' : 'inhibited';
  }

  receive(b: number): void {
    b &= 0xff;
    if (this.rxStuff) {
      this.rxStuff = false;
      if (b === 0x7f) {
        this.rxByte(0x7f);
        return;
      }
      this.startPacket();
      this.rxByte(b);
      return;
    }
    if (b === 0x7f) {
      if (this.rxState === 0) this.startPacket();
      else this.rxStuff = true;
      return;
    }
    if (this.rxState !== 0) this.rxByte(b);
  }

  private startPacket(): void {
    this.rxState = 1;
    this.rxBody = [];
    this.rxCrcBytes = [];
  }

  private rxByte(b: number): void {
    switch (this.rxState) {
      case 1:
        this.rxSeq = b >> 7;
        this.rxAddr = b & 0x7f;
        this.rxBody.push(b);
        this.rxState = 2;
        return;
      case 2:
        this.rxBody.push(b);
        this.rxLeft = b + 2;
        this.rxState = 3;
        return;
      default:
        if (this.rxLeft > 2) this.rxBody.push(b);
        else this.rxCrcBytes.push(b);
        if (--this.rxLeft > 0) return;
        this.rxState = 0;
        {
          const crc = sspCrc(this.rxBody);
          const ok = this.rxCrcBytes[0] === (crc & 0xff) && this.rxCrcBytes[1] === crc >> 8;
          if (ok && this.rxAddr === SspValidator.ADDRESS && this.rxBody.length > 2) {
            this.handle(this.rxBody.slice(2));
          }
        }
    }
  }

  private handle(data: number[]): void {
    const cmd = data[0];
    if (this.rxSeq === this.lastSeq && cmd !== 0x11) {
      if (this.lastReply.length) this.onReply(this.lastReply.slice());
      return;
    }
    this.lastSeq = this.rxSeq;
    switch (cmd) {
      case 0x01:
        this.resetPending = true;
        this.reply(OK);
        return;
      case 0x02:
        this.inhibits = ((data[1] ?? 0) | ((data[2] ?? 0) << 8)) & 0xffff;
        this.lampsDirty = true;
        this.reply(OK);
        return;
      case 0x03:
        this.displayOn = true;
        this.lampsDirty = true;
        this.reply(OK);
        return;
      case 0x04:
        this.displayOn = false;
        this.lampsDirty = true;
        this.reply(OK);
        return;
      case 0x05:
        this.reply(OK, SETUP);
        return;
      case 0x06:
        this.reply(OK);
        return;
      case 0x07:
        this.reply(OK, this.pollEvents());
        return;
      case 0x08:
        if (this.note === Note.Read) this.note = Note.Rejecting;
        this.reply(OK);
        return;
      case 0x09:
        this.enabled = false;
        this.reply(OK);
        return;
      case 0x0a:
        this.enabled = true;
        this.reply(OK);
        return;
      case 0x0c:
        this.reply(OK, [0x12, 0x34, 0x56, 0x78]);
        return;
      case 0x11:
        this.lastSeq = 1;
        this.reply(OK);
        return;
      case 0x17:
        this.reply(OK, [this.lastReject]);
        return;
      default:
        this.reply(UNKNOWN);
    }
  }

  private pollEvents(): number[] {
    const ev: number[] = [];
    if (this.resetPending) {
      ev.push(0xf1);
      this.resetPending = false;
    }
    if (!this.enabled) ev.push(0xe8);
    switch (this.note) {
      case Note.Read:
        ev.push(0xee, this.noteChannel, 0xcc);
        this.lastReject = 0;
        this.note = Note.Credited;
        this.onCredit(this.noteChannel);
        break;
      case Note.Credited:
        ev.push(0xeb);
        this.note = Note.Idle;
        break;
      case Note.Rejecting:
        ev.push(0xed);
        this.note = Note.Rejected;
        break;
      case Note.Rejected:
        ev.push(0xec);
        this.note = Note.Idle;
        break;
    }
    if (this.notePending) {
      ev.push(0xef, this.noteChannel);
      this.note = this.inhibits & (1 << (this.noteChannel - 1)) ? Note.Read : Note.Rejecting;
      this.notePending = false;
    }
    return ev;
  }

  private reply(code: number, data: readonly number[] = []): void {
    const body = [(this.rxSeq << 7) | SspValidator.ADDRESS, data.length + 1, code, ...data];
    const crc = sspCrc(body);
    const out = [0x7f];
    for (const b of [...body, crc & 0xff, crc >> 8]) {
      out.push(b);
      if (b === 0x7f) out.push(0x7f);
    }
    this.lastReply = out;
    this.answered++;
    this.onReply(out.slice());
  }
}
