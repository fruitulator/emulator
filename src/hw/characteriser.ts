
export const BARCREST_CHALLENGES = Uint8Array.from([
  0x00, 0x1a, 0x04, 0x10, 0x18, 0x0f, 0x13, 0x1b, 0x03, 0x07, 0x17, 0x1d, 0x36, 0x35, 0x2b, 0x28,
  0x39, 0x21, 0x22, 0x25, 0x2c, 0x29, 0x31, 0x34, 0x0a, 0x1f, 0x06, 0x0e, 0x1c, 0x12, 0x1e, 0x0d,
  0x14, 0x0a, 0x19, 0x15, 0x06, 0x0f, 0x08, 0x1b, 0x1e, 0x04, 0x01, 0x0c, 0x18, 0x1a, 0x11, 0x0b,
  0x03, 0x17, 0x10, 0x1d, 0x0e, 0x07, 0x12, 0x09, 0x0d, 0x1f, 0x16, 0x05, 0x13, 0x1c, 0x02, 0x00,
]);

const LAMP_ENCODINGS = [0x00, 0x01, 0x04, 0x09, 0x10, 0x19, 0x24, 0x31];

export interface CharacteriserTable {
  name: string;
  challenges?: Uint8Array;
  responses?: Uint8Array;
  lamps?: Uint8Array;
}

export class Characteriser {
  private col = 0;
  private lampCol = 0;
  private cheat: (() => number) | null = null;

  constructor(private table: CharacteriserTable | null = null) {}

  setTable(table: CharacteriserTable | null): void {
    this.table = table;
    this.reset();
  }

  setCheat(cheat: (() => number) | null): void {
    this.cheat = cheat;
  }

  get fitted(): boolean {
    return this.table !== null || this.cheat !== null;
  }

  reset(): void {
    this.col = 0;
    this.lampCol = 0;
  }

  read(offset: number): number {
    switch (offset & 0x1f) {
      case 0x00:
        if (this.table?.responses) return this.table.responses[this.col] ?? 0;
        if (this.cheat) return this.cheat();
        return 0xff;
      case 0x03:
        return this.table?.lamps?.[this.lampCol] ?? 0;
      default:
        return 0;
    }
  }

  write(offset: number, val: number): void {
    val &= 0xff;
    switch (offset & 0x1f) {
      case 0x00:
        if (val === 0) {
          this.col = 0;
        } else {
          this.seek(val);
        }
        break;
      case 0x02:
        this.selectLampColumn(val);
        break;
    }
  }

  private seek(val: number): void {
    const challenges = this.table?.challenges ?? BARCREST_CHALLENGES;
    const want = val & 0x1f;
    for (let x = this.col; x < 64; x++) {
      if ((challenges[x] & 0x1f) === want) {
        this.col = x;
        return;
      }
    }
  }

  private selectLampColumn(val: number): void {
    const index = LAMP_ENCODINGS.indexOf(val);
    if (index >= 0) this.lampCol = index;
  }

  debugState(): { name: string | null; col: number; lampCol: number } {
    return { name: this.table?.name ?? null, col: this.col, lampCol: this.lampCol };
  }
}
