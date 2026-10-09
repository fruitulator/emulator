
type Role =
  | 'bool' | 'byte' | 'u16' | 'u32' | 'i32' | 'f32' | 'color'
  | 'font' | 'bitmap' | 'text' | 'subcount' | 'subtable' | 'nested'
  | 'raw16' | 'raw24' | 'raw48' | 'raw1536';

const FIXED: Partial<Record<Role, number>> = {
  bool: 1, byte: 1, u16: 2, u32: 4, i32: 4, f32: 4, color: 4, subcount: 4,
  raw16: 16, raw24: 24, raw48: 48, raw1536: 1536,
};

interface TagMap {
  tags: Record<number, [Role, string]>;
  nested?: TagMap;
  second?: TagMap;
  defaults?: Record<string, number>;
}

const u32 = (d: Uint8Array, o: number): number =>
  (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const i32 = (d: Uint8Array, o: number): number => u32(d, o) | 0;

const m = (
  tags: Record<number, [Role, string]>,
  nested?: TagMap,
  second?: TagMap,
  defaults?: Record<string, number>,
): TagMap => ({ tags, nested, second, defaults });

function applyDefaults(c: ParsedComponent, map: TagMap): void {
  for (const src of [map, map.nested, map.second]) {
    if (!src?.defaults) continue;
    for (const [name, value] of Object.entries(src.defaults)) {
      if (!c.values.has(name)) c.defaults.set(name, value);
    }
  }
  for (const [name, value] of Object.entries(DEFAULTS[c.type] ?? {})) {
    if (!c.values.has(name)) c.defaults.set(name, value);
  }
}

const LAMP_V20_EXTRA: Record<number, [Role, string]> = {
  0x18: ['byte', ''],
  0x1f: ['text', ''], 0x20: ['text', ''],
  0x2a: ['raw16', ''], 0x2b: ['raw16', ''], 0x2c: ['raw16', ''], 0x2d: ['raw16', ''],
  0x2e: ['raw16', ''], 0x2f: ['raw16', ''], 0x30: ['raw16', ''], 0x31: ['raw16', ''],
  0x3e: ['raw16', ''], 0x3f: ['raw16', ''], 0x40: ['raw16', ''], 0x41: ['raw16', ''],
  0x56: ['raw16', ''], 0x57: ['raw16', ''], 0x58: ['raw16', ''], 0x59: ['raw16', ''],
  0x5b: ['raw16', ''],
};

const LAMP_NESTED = m({
  ...LAMP_V20_EXTRA,
  0x1b: ['text', ''], 0x1c: ['text', ''],
  0x01: ['bitmap', 'Sublamp1'], 0x02: ['bitmap', 'Sublamp2'],
  0x0f: ['bitmap', 'Sublamp3'], 0x10: ['bitmap', 'Sublamp4'],
  0x36: ['bitmap', 'Sublamp5'], 0x37: ['bitmap', 'Sublamp6'],
  0x38: ['bitmap', 'Sublamp7'], 0x39: ['bitmap', 'Sublamp8'],
  0x46: ['bitmap', 'Sublamp9'], 0x47: ['bitmap', 'Sublamp10'],
  0x48: ['bitmap', 'Sublamp11'], 0x49: ['bitmap', 'Sublamp12'],
  0x11: ['bitmap', 'SublampMask1'], 0x12: ['bitmap', 'SublampMask2'],
  0x13: ['bitmap', 'SublampMask3'], 0x14: ['bitmap', 'SublampMask4'],
  0x3a: ['bitmap', 'SublampMask5'], 0x3b: ['bitmap', 'SublampMask6'],
  0x3c: ['bitmap', 'SublampMask7'], 0x3d: ['bitmap', 'SublampMask8'],
  0x4a: ['bitmap', 'SublampMask9'], 0x4b: ['bitmap', 'SublampMask10'],
  0x4c: ['bitmap', 'SublampMask11'], 0x4d: ['bitmap', 'SublampMask12'],
  0x03: ['bitmap', 'BrightmaskMain'], 0x5a: ['bitmap', 'BrightmaskMask'],
  0x04: ['color', 'Sublamp1Colour'], 0x05: ['color', 'Sublamp2Colour'],
  0x15: ['color', 'Sublamp3Colour'], 0x16: ['color', 'Sublamp4Colour'],
  0x32: ['color', 'Sublamp5Colour'], 0x33: ['color', 'Sublamp6Colour'],
  0x34: ['color', 'Sublamp7Colour'], 0x35: ['color', 'Sublamp8Colour'],
  0x42: ['color', 'Sublamp9Colour'], 0x43: ['color', 'Sublamp10Colour'],
  0x44: ['color', 'Sublamp11Colour'], 0x45: ['color', 'Sublamp12Colour'],
  0x06: ['color', 'OffImageColour'], 0x25: ['color', 'OutlineColour'],
  0x19: ['font', ''], 0x1a: ['font', ''], 0x1d: ['font', ''], 0x1e: ['font', ''],
  0x26: ['text', 'On1Text'], 0x27: ['text', 'On2Text'], 0x28: ['text', ''], 0x29: ['text', ''],
  0x4e: ['font', ''], 0x4f: ['font', ''], 0x50: ['font', ''], 0x51: ['font', ''],
  0x52: ['text', ''], 0x53: ['text', ''], 0x54: ['text', ''], 0x55: ['text', ''],
  0x07: ['bool', 'Graphic'], 0x08: ['bool', 'NoOutline'], 0x09: ['bool', 'Transparent'],
  0x17: ['bool', 'Blend'], 0x23: ['bool', 'ClickAll'], 0x24: ['bool', 'LED'],
  0x69: ['bool', 'RGBLED'], 0x6c: ['bool', 'PreserveAspect'],
  0x0a: ['u32', 'ShapeIndex'], 0x0b: ['u32', 'ShapeParameter'], 0x0c: ['u32', 'Roundness'],
  0x0d: ['u32', 'ShapeAngle'], 0x0e: ['u32', ''],
  0x21: ['i32', 'XOffset'], 0x22: ['i32', 'YOffset'],
  0x6a: ['u32', 'PieSize'], 0x6b: ['u32', 'PieStart'],
  0x68: ['raw24', ''],
  0x5c: ['raw24', ''], 0x5d: ['raw24', ''], 0x5e: ['raw24', ''], 0x5f: ['raw24', ''],
  0x60: ['raw24', ''], 0x61: ['raw24', ''], 0x62: ['raw24', ''], 0x63: ['raw24', ''],
  0x64: ['raw24', ''], 0x65: ['raw24', ''], 0x66: ['raw24', ''], 0x67: ['raw24', ''],
});

const LAMP2 = m({
  0x01: ['bitmap', 'Sublamp1'], 0x02: ['bitmap', 'Sublamp2'],
  0x0f: ['bitmap', 'Sublamp3'], 0x10: ['bitmap', 'Sublamp4'],
  0x36: ['bitmap', 'Sublamp5'], 0x37: ['bitmap', 'Sublamp6'],
  0x38: ['bitmap', 'Sublamp7'], 0x39: ['bitmap', 'Sublamp8'],
  0x46: ['bitmap', 'Sublamp9'], 0x47: ['bitmap', 'Sublamp10'],
  0x48: ['bitmap', 'Sublamp11'], 0x49: ['bitmap', 'Sublamp12'],
  0x11: ['bitmap', 'SublampMask1'], 0x12: ['bitmap', 'SublampMask2'],
  0x13: ['bitmap', 'SublampMask3'], 0x14: ['bitmap', 'SublampMask4'],
  0x3a: ['bitmap', 'SublampMask5'], 0x3b: ['bitmap', 'SublampMask6'],
  0x3c: ['bitmap', 'SublampMask7'], 0x3d: ['bitmap', 'SublampMask8'],
  0x4a: ['bitmap', 'SublampMask9'], 0x4b: ['bitmap', 'SublampMask10'],
  0x4c: ['bitmap', 'SublampMask11'], 0x4d: ['bitmap', 'SublampMask12'],
  0x03: ['bitmap', 'OffImage'], 0x5a: ['bitmap', 'BrightmaskMask'],
  0x04: ['color', 'Sublamp1Colour'], 0x05: ['color', 'Sublamp2Colour'],
  0x15: ['color', 'Sublamp3Colour'], 0x16: ['color', 'Sublamp4Colour'],
  0x32: ['color', 'Sublamp5Colour'], 0x33: ['color', 'Sublamp6Colour'],
  0x34: ['color', 'Sublamp7Colour'], 0x35: ['color', 'Sublamp8Colour'],
  0x42: ['color', 'Sublamp9Colour'], 0x43: ['color', 'Sublamp10Colour'],
  0x44: ['color', 'Sublamp11Colour'], 0x45: ['color', 'Sublamp12Colour'],
  0x06: ['color', 'OffImageColour'], 0x25: ['color', 'OutlineColour'],
  0x07: ['bool', 'Graphic'], 0x08: ['bool', 'NoOutline'], 0x09: ['bool', 'Transparent'],
  0x17: ['bool', 'Blend'], 0x23: ['bool', 'ClickAll'], 0x24: ['bool', 'LED'],
  0x69: ['bool', 'RGBLED'], 0x6c: ['bool', 'PreserveAspect'],
  0x0a: ['u32', 'ShapeIndex'], 0x0b: ['u32', 'ShapeParameter'],
  0x0c: ['u32', 'Roundness'], 0x0d: ['u32', 'ShapeAngle'], 0x0e: ['u32', ''],
  0x21: ['i32', 'XOffset'], 0x22: ['i32', 'YOffset'],
  0x6a: ['u32', 'PieSize'], 0x6b: ['u32', 'PieStart'], 0x68: ['raw24', ''],
  0x19: ['font', ''], 0x1a: ['font', ''], 0x1d: ['font', ''], 0x1e: ['font', ''],
  0x4e: ['font', ''], 0x4f: ['font', ''], 0x50: ['font', ''], 0x51: ['font', ''],
  0x26: ['text', 'On1Text'], 0x27: ['text', 'On2Text'], 0x28: ['text', 'Label'], 0x29: ['text', ''],
  0x52: ['text', ''], 0x53: ['text', ''], 0x54: ['text', ''], 0x55: ['text', ''],
  0x1b: ['text', 'Label2'], 0x1c: ['text', 'Label3'],
  0x5c: ['raw24', ''], 0x5d: ['raw24', ''], 0x5e: ['raw24', ''], 0x5f: ['raw24', ''],
  0x60: ['raw24', ''], 0x61: ['raw24', ''], 0x62: ['raw24', ''], 0x63: ['raw24', ''],
  0x64: ['raw24', ''], 0x65: ['raw24', ''], 0x66: ['raw24', ''], 0x67: ['raw24', ''],
  ...LAMP_V20_EXTRA,
});

const ALPHASTRIP = m({
  0x01: ['u32', 'XSize'], 0x02: ['u32', 'YSize'], 0x03: ['u32', ''],
  0x04: ['color', 'OnColour'], 0x05: ['color', 'OffColour'],
  0x06: ['color', 'BackgroundColour'],
  0x07: ['u32', 'DotSpacing'], 0x08: ['u32', ''], 0x0a: ['bool', ''],
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
});

const BANDREEL_TAGS: Record<number, [Role, string]> = {
  0x01: ['u32', 'Stops'], 0x02: ['u32', 'HalfSteps'], 0x03: ['i32', 'BandOffset'],
  0x04: ['u32', 'BorderWidth'], 0x05: ['color', 'BorderColour'],
  0x06: ['bool', 'LampsEnabled'], 0x0c: ['bool', 'Opaque'], 0x10: ['bool', 'Custom'],
  0x0e: ['u32', 'OptoTab'], 0x13: ['u32', 'View'], 0x19: ['u32', 'Spacing'],
  0x17: ['byte', 'OffLevel'], 0x18: ['byte', 'SelectedOffColourId'],
  0x3c: ['bool', 'InvertedOpto'], 0x40: ['bool', 'Reversed'],
  0x4c: ['u16', 'Orientation'],
  0x1c: ['u32', 'NonNullSublampCount'],
  0x38: ['subcount', 'SublampCount'], 0x39: ['subtable', 'SublampTable'],
  0x3b: ['u32', ''],
  0x36: ['bitmap', 'Overlay'], 0x09: ['bitmap', 'Band'],
  0x07: ['bitmap', 'LampMasks1'], 0x0d: ['bitmap', 'LampMasks2'], 0x16: ['bitmap', 'LampMasks3'],
};

const BANDREEL = m(BANDREEL_TAGS, undefined, undefined, {
  Stops: 16, HalfSteps: 320, View: 5, OptoTab: 0, BandOffset: 0, Spacing: 0,
  BorderWidth: 1, BorderColour: 0xff000000, OffLevel: 0x40, SelectedOffColourId: 0,
  LampsEnabled: 0, Opaque: 0, Custom: 0, InvertedOpto: 0, Reversed: 0, Orientation: 1,
});

const LED_TAGS: Record<number, [Role, string]> = {
  0x01: ['color', 'OnColour'], 0x02: ['color', 'OffColour'],
  0x03: ['u32', 'SelectedStyleIndex'], 0x04: ['i32', 'SelectedSegmentIndex'],
  0x05: ['bool', 'Led'], 0x06: ['bool', 'NoOutline'], 0x07: ['bool', 'NoShadow'],
  0x36: ['bitmap', 'Overlay'],
  0x1c: ['u32', ''], 0x38: ['u32', ''], 0x39: ['u32', ''], 0x3b: ['u32', ''],
};

const LED: TagMap = {
  tags: LED_TAGS,
  second: m({ 0x05: ['bool', 'Led'] }),
  defaults: { SelectedStyleIndex: 0, SelectedSegmentIndex: 0xffffffff },
};

const LAMP = m({
  0x1c: ['u32', 'DefinedLampCount'], 0x38: ['subcount', 'SublampCount'],
  0x39: ['subtable', 'SublampTable'], 0x3f: ['text', 'OffText'],
  0x27: ['font', 'Font'], 0x3b: ['u32', ''], 0x3c: ['bool', 'Inverted'],
  0x17: ['bool', ''], 0x29: ['bool', 'Lockout'],
  0x49: ['i32', 'CoinNoteId'], 0x48: ['u32', 'EffectId'],
  0x18: ['u32', 'ButtonNumber'], 0x4a: ['u32', 'InhibitLamp'],
  0x15: ['bool', 'Shortcut1Enabled'], 0x16: ['u32', 'Shortcut1'],
  0x2a: ['bool', 'Shortcut2Enabled'], 0x2b: ['u32', 'Shortcut2'],
  0x3e: ['bool', ''], 0x46: ['bitmap', 'Overlay'], 0x36: ['bitmap', 'Overlay'],
  0x68: ['u32', ''], 0x19: ['bool', 'CoinSelected'], 0x1a: ['u32', 'CoinId'], 0x08: ['u32', ''],
  0x25: ['byte', ''],
  0x07: ['bool', 'Graphic'], 0x09: ['bool', 'Transparent'],
  0x28: ['text', 'Label'], 0x1b: ['text', 'Label2'],
  0x01: ['bitmap', 'Sublamp1'], 0x02: ['bitmap', 'Sublamp2'],
  0x0f: ['bitmap', 'Sublamp3'], 0x10: ['bitmap', 'Sublamp4'],
  0x03: ['bitmap', 'OffImage'],
}, LAMP_NESTED, LAMP2);

const BUTTON = m({
  0x17: ['bool', ''], 0x18: ['u32', 'ButtonNumber'], 0x4a: ['u32', 'InhibitLamp'],
  0x15: ['bool', 'Shortcut1Enabled'], 0x16: ['u32', 'Shortcut1'],
  0x2a: ['bool', 'Shortcut2Enabled'], 0x2b: ['u32', 'Shortcut2'],
  0x02: ['color', 'Lamp1Colour'], 0x08: ['color', 'Lamp2Colour'],
  0x03: ['color', 'OffColour'], 0x04: ['bool', 'Graphic'],
  0x05: ['bitmap', 'Lamp1'], 0x07: ['bitmap', 'Lamp2'], 0x06: ['bitmap', 'Off'],
  0x0b: ['bitmap', 'Mask1'], 0x0c: ['bitmap', 'Mask2'], 0x36: ['bitmap', 'Overlay'],
  0x3c: ['bool', 'Inverted'], 0x09: ['bool', 'Split'], 0x29: ['bool', 'Lockout'],
  0x0f: ['bool', 'Led'],
  0x01: ['u32', 'ShapeId'], 0x49: ['i32', 'CoinNoteId'], 0x48: ['u32', 'EffectId'],
  0x27: ['font', 'Font'], 0x1c: ['u32', 'NonNullSublampCount'],
  0x38: ['subcount', 'SublampCount'],
  0x39: ['subtable', 'SublampTable'], 0x3b: ['u32', ''], 0x3f: ['text', 'Label'],
  0x30: ['bool', ''], 0x0d: ['i32', 'XOffset'], 0x0e: ['i32', 'YOffset'],
  0x19: ['bool', 'CoinSelected'],
  0x28: ['text', 'Label'], 0x1a: ['u32', 'CoinId'],
  0x4c: ['byte', ''],
});

const BACKGROUND_INNER = m({
  0x01: ['color', 'Colour'], 0x03: ['bitmap', 'Background'], 0x07: ['color', 'BorderColour'],
  0x08: ['bool', 'TransparencyUseColour'], 0x09: ['color', 'TransparentColour'],
  0x0a: ['i32', 'OffsetX'], 0x0b: ['i32', 'OffsetY'], 0x0c: ['bitmap', 'Tile'],
  0x0d: ['bool', 'Tiled'], 0x0e: ['bool', 'RandomTile'], 0x0f: ['bool', 'TransparencyUseAlpha'],
});

const BACKGROUND = m({
  0x09: ['bool', ''], 0x0a: ['bool', ''], 0x0b: ['bool', ''],
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''], 0x4b: ['bool', 'NoOverlayInFullscreen'],
}, BACKGROUND_INNER, BACKGROUND_INNER);

const REEL_INNER = m({
  0x01: ['u32', 'OptoTab'],
  0x02: ['bool', 'InvertedOpto'],
  0x03: ['i32', 'BandOffset'], 0x04: ['u32', 'Stops'],
  0x05: ['u32', 'HalfSteps'], 0x06: ['bool', 'LampsEnabled'], 0x07: ['bool', 'CustomEnabled'],
  0x08: ['u32', 'Resolution'], 0x09: ['bool', 'ToggleView'], 0x0a: ['u32', 'BorderThickness'],
  0x0b: ['u32', 'NumberOfWinlines'], 0x0c: ['u32', 'WinlinesThickness'],
  0x0d: ['color', 'BorderColour'],
  0x0e: ['bitmap', 'Band'], 0x0f: ['bitmap', 'LampMasks1'],
  0x11: ['u32', 'ReelHeight'],
  0x12: ['byte', ''], 0x13: ['bool', 'Reversed'],
  0x15: ['u32', 'Bounce'], 0x16: ['bool', 'OpaqueBand'], 0x17: ['u32', 'Filter'],
  0x19: ['bitmap', 'LampMasks2'], 0x1a: ['bool', 'LedsEnabled'],
  0x1c: ['bitmap', 'Gradient'], 0x1e: ['u32', 'ReelNbrOffset'], 0x1f: ['u32', 'ReelMode'],
  0x20: ['i32', 'WinlinesOffset'], 0x21: ['bool', 'Mirrored'],
  0x24: ['color', 'WinlinesColour'], 0x25: ['i32', 'WidthDiff'],
  0x26: ['color', 'BackgroundFillColour'], 0x27: ['u32', 'MirroredLevel'],
  0x28: ['bitmap', 'LampMasks3'], 0x29: ['byte', 'OffLevel'], 0x2a: ['byte', 'SelectedOffColourId'],
});

const REEL = m({
  0x08: ['u32', ''], 0x1c: ['u32', 'NonNullSublampCount'], 0x36: ['bitmap', 'Overlay'],
  0x38: ['subcount', 'SublampCount'], 0x39: ['subtable', 'SublampTable'],
  0x3b: ['u32', ''], 0x3c: ['bool', 'InvertedOpto'], 0x40: ['bool', 'Reversed'],
}, REEL_INNER, REEL_INNER, {
  Stops: 16, HalfSteps: 96, OptoTab: 0, BandOffset: 0,
  NumberOfWinlines: 1, WinlinesThickness: 1, BorderThickness: 1, BorderColour: 0xff000000,
});

const ALPHA_TAGS: Record<number, [Role, string]> = {
  0x01: ['color', 'Colour'], 0x02: ['u32', 'DigitWidth'], 0x03: ['u32', 'Columns'],
  0x04: ['bitmap', 'CharBitmap'], 0x08: ['u32', ''], 0x36: ['bitmap', 'Overlay'],
  0x3b: ['u32', ''], 0x40: ['bool', 'Reversed'],
  0x05: ['bool', 'ReversedLegacy'],
};
const ALPHA = m(ALPHA_TAGS, undefined, m(ALPHA_TAGS));

const ALPHANEW = m({
  0x01: ['color', 'OnColour'], 0x02: ['color', 'OffColour'], 0x03: ['color', 'BackgroundColour'],
  0x04: ['color', ''],
  0x06: ['f32', 'Thickness'], 0x07: ['f32', 'Spacing'], 0x08: ['f32', 'HorizontalSpacing'],
  0x09: ['f32', 'VerticalSpacing'], 0x0a: ['f32', 'Slant'], 0x0b: ['f32', 'Centre'],
  0x99: ['f32', 'Chop'], 0x0d: ['color', ''], 0x0e: ['color', ''],
  0x05: ['bool', 'ReversedLegacy'],
  0x0c: ['byte', 'Charset'], 0x0f: ['bool', 'Segment16'], 0x40: ['bool', 'Reversed'],
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
});

const SEVENSEG_INNER = m({
  0x26: ['bool', 'Alpha'], 0x27: ['bool', 'DPOff'], 0x09: ['bool', 'DPOn'], 0x21: ['bool', 'AutoDP'],
  0x0a: ['bool', 'Segment16'], 0x1d: ['bool', 'ZeroOn'], 0x08: ['bool', 'DPRight'],
  0x06: ['color', 'OnColour'], 0x07: ['color', 'OffColour'], 0x05: ['color', 'BgColour'],
  0x01: ['u32', 'Thickness'], 0x02: ['u32', 'Spacing'], 0x03: ['u32', 'HSpacing'],
  0x04: ['u32', 'VSpacing'], 0x25: ['u32', 'Offset'], 0x22: ['u32', 'DigitAngle'],
  0x1c: ['u32', 'Slant'], 0x1e: ['u32', 'Chop'], 0x1f: ['u32', 'Centre'],
  0x0b: ['bool', 'Programmable'], 0x20: ['byte', 'StyleId'], 0x24: ['byte', ''],
  0x36: ['bitmap', 'Overlay'],
});

const SEVENSEG = m({
  0x1c: ['u32', 'DefinedLampCount'], 0x36: ['bitmap', 'Overlay'], 0x38: ['subcount', 'SublampCount'],
  0x39: ['subtable', 'SublampTable'], 0x3b: ['u32', ''],
  0x08: ['i32', ''],
}, SEVENSEG_INNER, SEVENSEG_INNER);

const CHECKBOX = m({
  0x28: ['text', 'Label'],
  0x01: ['bool', 'Checked'], 0x02: ['bitmap', 'Image'], 0x36: ['bitmap', 'Overlay'],
  0x27: ['font', 'Font'], 0x3b: ['u32', ''], 0x3f: ['text', 'Label'],
  0x4c: ['byte', ''],
});

const LABEL = m({
  0x28: ['text', 'Label'],
  0x3b: ['u32', ''], 0x3f: ['text', 'Label'], 0x36: ['bitmap', 'Overlay'],
  0x39: ['i32', 'Lamp'], 0x01: ['color', 'BackgroundColour'], 0x02: ['bool', 'Transparent'],
  0x27: ['font', 'Font'],
  0x38: ['u32', ''], 0x1c: ['u32', 'DefinedLampCount'],
});

const BITMAP_TAGS: Record<number, [Role, string]> = {
  0x01: ['bool', 'Transparent'], 0x02: ['bitmap', 'Image'], 0x03: ['u32', 'StretchMode'],
  0x08: ['u32', ''], 0x36: ['bitmap', 'Overlay'], 0x33: ['bool', ''], 0x05: ['u32', ''], 0x3b: ['u32', ''],
  0x06: ['byte', ''], 0x07: ['u32', ''],
};
const BITMAP_C = m(BITMAP_TAGS, undefined, m(BITMAP_TAGS));

const FRAME = m({
  0x01: ['u32', 'ShapeIndex'], 0x02: ['u32', 'BevelIndex'], 0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
});

const ACEMATRIX = m({
  0x01: ['u32', 'Size'], 0x02: ['bool', 'Flip180'],
  0x03: ['color', 'OnColour'], 0x04: ['color', 'OffColour'],
  0x05: ['bool', 'Vertical'], 0x06: ['color', 'BackgroundColour'],
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
}, undefined, undefined, {
  Size: 7, OnColour: 0xffff0000, OffColour: 0xff000000, BackgroundColour: 0xff000000,
  Flip180: 0, Vertical: 0,
});

const PROCONNMATRIX = m({
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
}, m({
  0x01: ['u32', 'Size'], 0x02: ['color', 'OnColour'],
  0x03: ['color', 'OffColour'], 0x04: ['color', 'BackgroundColour'],
}), undefined, {
  Size: 3, OnColour: 0xff00ff00, OffColour: 0xff000000, BackgroundColour: 0xff000000,
});

const BORDER_INNER = m({
  0x01: ['color', 'OuterColour'], 0x02: ['u32', 'BorderWidth'],
  0x03: ['bitmap', 'Border'], 0x04: ['u32', ''], 0x05: ['color', 'InnerColour'],
  0x06: ['raw16', ''], 0x07: ['raw16', ''], 0x08: ['u32', 'Spacing'],
});

const BORDER = m({
  0x0a: ['bool', ''], 0x0b: ['bool', ''], 0x37: ['u32', ''],
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''], 0x3f: ['text', 'Label'],
}, BORDER_INNER, BORDER_INNER, {
  OuterColour: 0xffff0000, InnerColour: 0xff00ff00, BorderWidth: 8, Spacing: 9,
});

const BASE_TAGS: Record<number, [Role, string]> = {
  0x07: ['byte', ''], 0x09: ['byte', ''], 0x0a: ['byte', ''], 0x0b: ['byte', ''],
  0x0c: ['byte', ''], 0x15: ['byte', 'Shortcut1Enabled'], 0x17: ['byte', ''],
  0x19: ['byte', ''], 0x29: ['byte', 'Lockout'], 0x2a: ['byte', 'Shortcut2Enabled'],
  0x3c: ['byte', 'Inverted'], 0x3e: ['byte', ''], 0x40: ['byte', ''],
  0x4b: ['byte', 'NoOverlayInFullscreen'], 0x4c: ['byte', ''],
  0x06: ['u32', ''], 0x08: ['u32', ''], 0x16: ['u32', 'Shortcut1'],
  0x18: ['u32', 'ButtonNumber'], 0x1a: ['u32', 'CoinId'],
  0x1c: ['u32', 'NonNullSublampCount'],
  0x1d: ['u32', ''], 0x1e: ['u32', ''], 0x1f: ['u32', ''], 0x20: ['u32', ''], 0x21: ['u32', ''],
  0x22: ['u32', ''], 0x23: ['u32', ''], 0x24: ['u32', ''], 0x25: ['u32', ''], 0x26: ['u32', ''],
  0x2b: ['u32', 'Shortcut2'],
  0x2c: ['u32', ''], 0x2d: ['u32', ''], 0x2e: ['u32', ''], 0x2f: ['u32', ''], 0x30: ['u32', ''],
  0x31: ['u32', ''], 0x32: ['u32', ''], 0x33: ['u32', ''], 0x34: ['u32', ''], 0x35: ['u32', ''],
  0x37: ['u32', ''], 0x3b: ['u32', ''],
  0x48: ['u32', 'EffectId'], 0x49: ['i32', 'CoinNoteId'], 0x4a: ['u32', 'InhibitLamp'],
  0x38: ['subcount', 'SublampCount'], 0x39: ['subtable', 'SublampTable'],
  0x3a: ['subtable', ''],
  0x27: ['font', 'Font'], 0x28: ['text', ''], 0x3f: ['text', ''],
  0x36: ['bitmap', 'Overlay'],
};

const SEVENSEGBLOCK = m({ ...BASE_TAGS }, m({
  0x15: ['u32', 'Columns'], 0x14: ['u32', 'Rows'],
  0x16: ['u32', 'RowSpacing'], 0x17: ['u32', 'ColumnSpacing'],
  0x19: ['u32', 'DigitWidth'], 0x1a: ['u32', 'DigitHeight'],
  0x18: ['u32', ''],
  0x10: ['byte', 'SelectedTypeId'], 0x08: ['bool', 'DPRight'], 0x0a: ['bool', 'Segment14'],
  0x01: ['u32', 'Thickness'], 0x02: ['u32', 'Spacing'],
  0x03: ['u32', 'HorizontalSizePercent'], 0x04: ['u32', 'VerticalSizePercent'],
  0x05: ['color', 'BackColour'], 0x06: ['color', 'OnColour'], 0x07: ['color', 'OffColour'],
  0x1c: ['u32', 'Offset'], 0x12: ['u32', 'DigitAngle'], 0x0c: ['u32', 'Slant'],
  0x0e: ['u32', 'Chop'], 0x0f: ['u32', 'Centre'],
  0x0b: ['raw48', ''], 0x1b: ['raw1536', ''],
  0x09: ['raw48', ''], 0x0d: ['raw48', ''], 0x11: ['raw48', ''],
  0x13: ['raw48', ''], 0x1d: ['raw48', ''],
  0x36: ['bitmap', 'Overlay'],
}), undefined, {
  Columns: 1, Rows: 1, DigitWidth: 0x18, DigitHeight: 0x20, DPRight: 1,
  Thickness: 3, Spacing: 1, HorizontalSizePercent: 0x40, VerticalSizePercent: 0x4e,
  BackColour: 0xffff0000, OnColour: 0xff0000ff, OffColour: 0xff00ff00,
  Slant: 6, Chop: 0x4b, Centre: 0x32,
});
SEVENSEGBLOCK.second = SEVENSEGBLOCK.nested;

const DOTALPHA = m({
  0x01: ['u32', 'XSize'], 0x02: ['u32', 'YSize'], 0x03: ['u32', ''],
  0x04: ['u32', 'DigitSpacing'], 0x08: ['u32', 'DotSpacing'],
  0x05: ['color', 'OnColour'], 0x06: ['color', 'OffColour'], 0x07: ['color', 'BackgroundColour'],
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
});

const DOTMATRIX = m({
  0x01: ['u32', 'Size'],
  0x02: ['color', 'OnColour'], 0x03: ['color', 'OffColour'], 0x04: ['color', 'BackgroundColour'],
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
});

const EPOCHDOTALPHA = m({
  0x05: ['color', 'OnColour'], 0x06: ['color', 'OffColour'], 0x07: ['color', 'BackgroundColour'],
  0x01: ['u32', 'XSize'], 0x02: ['u32', 'YSize'], 0x03: ['u32', ''], 0x09: ['u32', ''],
  0x08: ['u32', 'DotSpacing'], 0x04: ['u32', 'DigitSpacing'],
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
});

const EPOCHMATRIX = m({
  0x01: ['u32', 'Size'],
  0x03: ['color', 'OnColourHi'], 0x04: ['color', 'OffColour'], 0x05: ['color', 'BackgroundColour'],
  0x06: ['color', 'OnColourLo'], 0x07: ['color', 'OnColourMed'],
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
});

const MAYGAYMATRIX = m({
  0x01: ['u32', 'Size'],
  0x02: ['color', 'OnColour'], 0x03: ['color', 'OffColour'], 0x04: ['color', 'BackgroundColour'],
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
});

const PLASMADISPLAY_TAGS: Record<number, [Role, string]> = {
  0x01: ['u32', 'Size'],
  0x02: ['color', 'OnColour'], 0x03: ['color', 'OffColour'], 0x04: ['color', 'BackgroundColour'],
};
const PLASMADISPLAY = m({ ...BASE_TAGS }, m(PLASMADISPLAY_TAGS), m(PLASMADISPLAY_TAGS));

const BFMVIDEO = m({
  0x01: ['u32', 'VideoMode'], 0x36: ['bitmap', 'Overlay'],
  0x33: ['bool', ''], 0x3b: ['u32', ''],
});

const PRISMLAMP = m({
  0x01: ['bitmap', 'Lamp1'], 0x02: ['bitmap', 'Lamp2'],
  0x04: ['bitmap', 'Lamp1Mask'], 0x05: ['bitmap', 'Lamp2Mask'],
  0x03: ['bitmap', 'Off'], 0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
  0x1c: ['u32', 'NumberOfDefinedLampNumbers'],
  0x38: ['subcount', 'SublampCount'], 0x39: ['subtable', 'SublampTable'],
  0x06: ['u32', 'HorizontalSpacing'], 0x0b: ['u32', 'VerticalSpacing'], 0x09: ['u32', 'Tilt'],
  0x07: ['u32', 'Style'], 0x4c: ['u16', 'IsHorizontal'], 0x0a: ['bool', 'CenterLine'],
});

const BFMALPHA = m({
  0x01: ['color', 'Colour'], 0x02: ['u32', 'OffLevel'],
  0x03: ['u32', 'DigitWidth'], 0x04: ['u32', 'Columns'],
  0x05: ['bitmap', 'CharacterImage'], 0x40: ['bool', 'Reversed'],
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
});

const RGBLED = m({
  0x1c: ['u32', ''], 0x38: ['subcount', 'SublampCount'], 0x39: ['subtable', 'SublampTable'],
  0x03: ['u32', 'SelectedStyle'],
  0x06: ['bool', 'MaxLED'], 0x07: ['bool', 'NoOutline'], 0x08: ['bool', 'NoShadow'],
  0x02: ['color', 'AdjustedOff'],
  0x09: ['color', 'AdjustedRed'], 0x0a: ['color', 'AdjustedGreen'],
  0x0b: ['color', 'AdjustedRedGreen'], 0x0c: ['color', 'AdjustedBlue'],
  0x0d: ['color', 'AdjustedRedBlue'], 0x0e: ['color', 'AdjustedRedGreen2'],
  0x0f: ['color', 'AdjustedRedGreenBlue'],
  0x36: ['bitmap', 'Overlay'], 0x3b: ['u32', ''],
});

const DISCREEL_TAGS: Record<number, [Role, string]> = {
  0x01: ['u32', 'HalfSteps'], 0x02: ['u32', 'Stops'], 0x03: ['u32', 'Resolution'],
  0x05: ['i32', 'BandOffset'], 0x06: ['u32', 'Darkness'], 0x08: ['u32', 'OuterLampSize'],
  0x0a: ['u32', 'OuterH'], 0x0b: ['u32', 'OuterL'], 0x0c: ['u32', 'InnerH'],
  0x0d: ['u32', 'InnerL'], 0x11: ['u32', 'InnerLampSize'],
  0x96: ['u32', 'OptoTab'], 0x97: ['bool', 'LampsEnabled'], 0x98: ['u32', 'NumberOfLamps'],
  0x99: ['u32', 'Bounce'], 0x38: ['subcount', 'SublampCount'],
  0x39: ['subtable', 'SublampTable'], 0x07: ['i32', 'LampPositionsOffset'],
  0x9a: ['bool', 'LampPositionsGapEnabled'], 0x9b: ['i32', 'LampPositionsGap'],
  0x40: ['bool', 'Reversed'], 0x3c: ['bool', 'InvertedOpto'],
  0x0e: ['bitmap', 'Band'], 0x0f: ['bitmap', 'DiscOverlay'],
  0x10: ['bitmap', 'OuterMask1'], 0x54: ['bitmap', 'OuterMask2'],
  0x33: ['bitmap', 'InnerMask1'], 0x55: ['bitmap', 'InnerMask2'],
  0x36: ['bitmap', 'Overlay'], 0x1c: ['u32', ''],
  0x4c: ['byte', ''],
  0x3b: ['u32', ''],
  0x3e: ['bool', ''],
  0x12: ['bool', 'Reversed'],
};

const DISCREEL_HEADER_TAGS: Record<number, [Role, string]> = {
  0x0b: ['byte', ''], 0x1c: ['u32', 'NonNullSublampCount'],
  0x36: ['bitmap', 'Overlay'],
  0x38: ['subcount', 'SublampCount'], 0x39: ['subtable', 'SublampTable'],
  0x3b: ['u32', ''], 0x3e: ['bool', ''], 0x3c: ['bool', 'InvertedOpto'],
  0x40: ['bool', 'Reversed'], 0x4c: ['byte', ''],
};

const DISCREEL = m(DISCREEL_HEADER_TAGS, undefined, m(DISCREEL_TAGS), {
  Stops: 12, HalfSteps: 96, Resolution: 1, OptoTab: 0, BandOffset: 0,
  OuterLampSize: 0x35, InnerLampSize: 0x35, NumberOfLamps: 12, LampsEnabled: 1,
  Bounce: 0, OuterH: 0, OuterL: 0, InnerH: 0, InnerL: 0,
  LampPositionsOffset: 0, Darkness: 0xb0, LampPositionsGapEnabled: 0,
});

const FLIPREEL_TAGS: Record<number, [Role, string]> = {
  0x01: ['u32', 'Stops'], 0x02: ['u32', 'HalfSteps'], 0x03: ['i32', 'BandOffset'],
  0x04: ['u32', 'BorderWidth'], 0x05: ['color', 'BorderColour'],
  0x06: ['bool', 'LampsEnabled'],
  0x07: ['bitmap', 'LampMasks1'], 0x08: ['bitmap', 'Band'],
  0x09: ['byte', ''], 0x0a: ['bitmap', 'LampMasks2'],
  0x0b: ['byte', ''], 0x0c: ['byte', ''],
  0x0d: ['u32', 'FaceInset'], 0x0e: ['bitmap', 'LampMasks3'],
};

const FLIPREEL = m({ ...BASE_TAGS }, undefined, m(FLIPREEL_TAGS), {
  Stops: 72, HalfSteps: 432, BandOffset: 0, BorderWidth: 4, FaceInset: 4,
  BorderColour: 0xff000000, LampsEnabled: 0,
});

const BARCRESTVIDEO_TAGS: Record<number, [Role, string]> = {
  0x01: ['byte', ''], 0x02: ['u32', ''], 0x03: ['u32', ''], 0x04: ['u32', ''],
  0x05: ['u32', 'LeftSkew'], 0x06: ['i32', 'RightSkew'],
};
const BARCRESTVIDEO = m({ ...BASE_TAGS }, m(BARCRESTVIDEO_TAGS), m(BARCRESTVIDEO_TAGS));

const ACEVIDEO_TAGS: Record<number, [Role, string]> = { 0x01: ['byte', 'Size'] };
const ACEVIDEO = m({ ...BASE_TAGS }, m(ACEVIDEO_TAGS), m(ACEVIDEO_TAGS));

const DEFAULTS: Record<number, Record<string, number>> = {
  0x01: { Colour: 0xfff0f0f0, BorderColour: 0xff000000 },
  0x04: { Sublamp1Colour: 0xffffff00, Sublamp2Colour: 0xffffff00, Sublamp3Colour: 0xffffff00, Sublamp4Colour: 0xffffff00, Sublamp5Colour: 0xffffff00, Sublamp6Colour: 0xffffff00, Sublamp7Colour: 0xffffff00, Sublamp8Colour: 0xffffff00, Sublamp9Colour: 0xffffff00, Sublamp10Colour: 0xffffff00, Sublamp11Colour: 0xffffff00, Sublamp12Colour: 0xffffff00, OffImageColour: 0xfff0f0f0, PieSize: 120, CoinNoteId: -1 },
  0x05: { Lamp1Colour: 0xffffff00, Lamp2Colour: 0xffffff00, OffColour: 0xffffff00,
    CoinNoteId: -1 },
  0x07: { DigitWidth: 17, Columns: 16 },
  0x0a: { BackgroundColour: 0xfff0f0f0, Transparent: 1, DefinedLampCount: 0, Lamp: -2 },
  0x0e: { OnColour: 0xffff0000, OffColour: 0xff303030,
    BgColour: 0xff000000, Thickness: 3, Spacing: 1 },
  0x12: { SelectedSegmentIndex: 0xffffffff },
  0x19: { Segment16: 1, Charset: 0, Reversed: 0, Thickness: 2, Spacing: 0,
    HorizontalSpacing: 5, VerticalSpacing: 4, Slant: 5, Centre: 48, Chop: 90 },
  0x1a: { OnColour: 0xff00ffff, OffColour: 0xff2c2c2c, BackgroundColour: 0x00000000,
    XSize: 2, YSize: 2, DotSpacing: 1 },
  0x0d: { Size: 7, OnColour: 0xffff0000, OffColour: 0xff000000, BackgroundColour: 0xff000000 },
  0x13: { XSize: 2, YSize: 2, DotSpacing: 1, DigitSpacing: 2,
    OnColour: 0xff00ffff, OffColour: 0xff002c2c, BackgroundColour: 0x00000000 },
  0x23: { Size: 5, OnColour: 0xffff8d1c, OffColour: 0xff000000, BackgroundColour: 0xff000000 },
  0x26: { SelectedStyle: 0, MaxLED: 1, NoOutline: 0, NoShadow: 0,
    AdjustedOff: 0xff7f0000, AdjustedRed: 0xff000000, AdjustedGreen: 0xff000000,
    AdjustedRedGreen: 0xff000000, AdjustedBlue: 0xff000000, AdjustedRedBlue: 0xff000000,
    AdjustedRedGreen2: 0xff000000, AdjustedRedGreenBlue: 0xff000000 },
};

const MAPS: Record<number, TagMap> = {
  0x01: BACKGROUND, 0x03: REEL, 0x04: LAMP, 0x05: BUTTON, 0x07: ALPHA,
  0x09: FRAME, 0x0a: LABEL, 0x0b: BITMAP_C, 0x0e: SEVENSEG, 0x14: CHECKBOX,
  0x19: ALPHANEW,
  0x12: LED, 0x1a: ALPHASTRIP, 0x08: BANDREEL, 0x06: DISCREEL,
  0x10: ACEMATRIX, 0x11: PROCONNMATRIX, 0x1b: BORDER, 0x1c: SEVENSEGBLOCK,
  0x0c: BFMALPHA, 0x0d: DOTMATRIX, 0x13: DOTALPHA, 0x26: RGBLED,
  0x16: EPOCHDOTALPHA, 0x22: EPOCHMATRIX, 0x29: PRISMLAMP, 0x2e: MAYGAYMATRIX,
  0x1f: BFMVIDEO, 0x2d: FLIPREEL, 0x0f: BARCRESTVIDEO, 0x23: PLASMADISPLAY,
  0x21: ACEVIDEO,
};

export function hasTagMap(type: number): boolean {
  return type in MAPS;
}

const DELTAS: Record<number, [number, number]> = {
  0x14: [7, 7],
  0x22: [2, 2],
  0x1f: [2, 2],
};

export interface ParsedComponent {
  type: number;
  x: number; y: number; width: number; height: number; number: number; angle: number;
  images: Map<string, { off: number; len: number }>;
  values: Map<string, number>;
  defaults: Map<string, number>;
  texts: Map<string, string>;
  subs?: number[];
  orientation?: number;
  value: Uint8Array;
  stop?: { off: number; tag: number };
  clean: boolean;
}

function isWireAngle(d: Uint8Array, o: number): boolean {
  if (o + 6 > d.length) return false;
  if ((d[o] !== 0x01 && d[o] !== 0x00) || d[o + 1] !== 0x08) return false;
  const v = (d[o + 2] | (d[o + 3] << 8)) << 16 >> 16;
  return v >= 0 ? d[o + 4] === 0x00 && d[o + 5] === 0x00
                : d[o + 4] === 0xff && d[o + 5] === 0xff;
}

function parseGeometry(d: Uint8Array, c: ParsedComponent, rewriteDelta: number, validDelta: number): number {
  if (d.length < 30) return d.length;
  c.x = u32(d, 6);
  c.y = u32(d, 11);
  c.height = u32(d, 16);
  c.width = u32(d, 21);
  c.number = i32(d, 26);
  const pos = 30;
  if (pos + 7 > d.length || d[pos] !== 0x07) return pos;
  if (isWireAngle(d, pos + 1)) {
    const v = (d[pos + 3] | (d[pos + 4] << 8)) << 16 >> 16;
    c.angle = v / 2;
    let a = pos + 7;
    if (a < d.length && d[a] === 0x00) { a = a + 1 + validDelta; while (a < d.length && d[a] === 0x00) a++; }
    else a += validDelta;
    return a;
  }
  return pos + 2 + rewriteDelta;
}

function textShape(d: Uint8Array, o: number): { len: number; utf16: boolean } | null {
  if (o + 4 > d.length) return null;
  const n = u32(d, o);
  if (n === 0) return { len: 4, utf16: true };
  const utf16Len = 4 + n * 2;
  let zeros = 0;
  let sampled = 0;
  for (let i = 0; i < Math.min(n, 4) && o + 4 + i * 2 + 1 < d.length; i++) {
    sampled++;
    if (d[o + 4 + i * 2 + 1] === 0) zeros++;
  }
  const utf16 = sampled > 0 && zeros === sampled && o + utf16Len <= d.length;
  return { len: utf16 ? utf16Len : 4 + n, utf16 };
}

function valueLength(d: Uint8Array, o: number, role: Role, sublampCount: number): number {
  const fixed = FIXED[role];
  if (fixed !== undefined) return fixed;
  switch (role) {
    case 'font': return o + 4 > d.length ? -1 : 4 + u32(d, o) + 10;
    case 'text': return textShape(d, o)?.len ?? -1;
    case 'bitmap':
      return o + 6 > d.length || d[o] !== 0x42 || d[o + 1] !== 0x4d ? -1 : u32(d, o + 2);
    case 'subtable': return sublampCount * 4;
    default: return -1;
  }
}

let tagObserver: ((type: number, tag: number, name: string, role: string) => void) | null = null;

export function setTagObserver(
  fn: ((type: number, tag: number, name: string, role: string) => void) | null,
): void {
  tagObserver = fn;
}

function walkTags(d: Uint8Array, start: number, map: TagMap, c: ParsedComponent, allowSeparator: boolean): number {
  let o = start;
  let active = map;
  let sublampCount = 0;
  let guard = 0;
  let separators = 0;
  while (o < d.length && guard++ < 65536) {
    const b = d[o];
    if (b === 0x00) {
      if (allowSeparator && separators < 16) {
        const next = active.second ?? active;
        const nextTag = d[o + 1];
        if (nextTag === 0x00) { o++; separators++; active = next; continue; }
        const entry2 = nextTag !== undefined ? next.tags[nextTag] : undefined;
        if (entry2) {
          const len2 = valueLength(d, o + 2, entry2[0], sublampCount);
          if (len2 >= 0 && o + 2 + len2 <= d.length) { o++; separators++; active = next; continue; }
        }
      }
      return o + 1;
    }

    if (b === 0x4c && o + 2 < d.length && d[o + 2] === 0x00
        && (active.nested || !active.tags[0x4c])) {
      if (c.orientation === undefined) c.orientation = d[o + 1];
      o += 3;
      if (active.nested) {
        const end = walkTags(d, o, active.nested, c, allowSeparator);
        if (end < 0) return -1;
        o = end;
      }
      continue;
    }

    const entry = active.tags[b];
    if (!entry) {
      if (!c.stop) c.stop = { off: o, tag: b };
      return -1;
    }
    o += 1;
    const [role, name] = entry;
    if (tagObserver) tagObserver(c.type, b, name, role);
    const len = valueLength(d, o, role, sublampCount);
    if (len < 0 || o + len > d.length) {
      if (!c.stop) c.stop = { off: o - 1, tag: b };
      return -1;
    }

    if (role === 'subcount') sublampCount = u32(d, o);
    if (role === 'subtable') {
      const subs: number[] = [];
      for (let i = 0; i < sublampCount; i++) subs.push(i32(d, o + i * 4));
      c.subs = subs;
    }
    const key = name || `#${b.toString(16)}`;
    if (role === 'bitmap') {
      if (name && !c.images.has(name)) c.images.set(name, { off: o, len });
    } else if (role === 'u32' || role === 'i32' || role === 'bool' || role === 'byte') {
      c.values.set(key, role === 'i32' ? i32(d, o) : role === 'u32' ? u32(d, o) : d[o]);
    } else if (role === 'u16') {
      c.values.set(key, d[o] | (d[o + 1] << 8));
    } else if (role === 'color') {
      c.values.set(key, u32(d, o));
    } else if (role === 'f32') {
      c.values.set(key, new DataView(d.buffer, d.byteOffset + o, 4).getFloat32(0, true));
    } else if (role === 'text') {
      const n = u32(d, o);
      const utf16 = textShape(d, o)?.utf16 ?? true;
      let s = '';
      if (utf16) {
        for (let i = 0; i < n && o + 4 + i * 2 + 1 < d.length; i++) {
          s += String.fromCharCode(d[o + 4 + i * 2] | (d[o + 4 + i * 2 + 1] << 8));
        }
      } else {
        for (let i = 0; i < n && o + 4 + i < d.length; i++) {
          s += String.fromCharCode(d[o + 4 + i]);
        }
      }
      if (s) c.texts.set(key, s);
    } else if (role === 'font') {
      const n = u32(d, o);
      let s = '';
      for (let i = 0; i < n && o + 4 + i < d.length; i++) s += String.fromCharCode(d[o + 4 + i]);
      if (s) c.texts.set(`${key}Face`, s);
      const tail = o + 4 + n;
      if (tail + 10 <= d.length) {
        c.values.set(`${key}Size`, u32(d, tail));
        c.values.set(
          `${key}Colour`,
          ((0xff000000 | (d[tail + 5] << 16) | (d[tail + 6] << 8) | d[tail + 7]) >>> 0),
        );
        c.values.set(`${key}Style`, d[tail + 9]);
      }
    }
    o += len;
  }
  return o;
}

function componentStart(p: Uint8Array): number {
  let pos = 0;
  while (pos + 8 <= p.length) {
    const tag = u32(p, pos);
    const len = u32(p, pos + 4);
    if (tag === 0xffffffff) return pos + 8 + len;
    pos += 8 + len;
    if (tag === 0x43 || tag === 0x44 || tag === 0x45) {
      const key = tag & 0xff;
      while (pos + 4 <= p.length) {
        const sl = u32(p, pos);
        if (sl > key) break;
        if (sl === 0) { pos += 4; break; }
        pos += 4 + sl;
      }
    }
  }
  return -1;
}

export function parseLayout(p: Uint8Array): ParsedComponent[] {
  const start = componentStart(p);
  if (start < 0) return [];
  const out: ParsedComponent[] = [];
  let pos = start;
  while (pos + 8 <= p.length) {
    const type = u32(p, pos);
    const len = u32(p, pos + 4);
    if (len < 8 || pos + len > p.length) break;
    const value = p.subarray(pos + 8, pos + len);
    pos += len;

    const c: ParsedComponent = {
      type, x: 0, y: 0, width: 0, height: 0, number: -1, angle: 0,
      images: new Map(), values: new Map(), defaults: new Map(), texts: new Map(),
      value, clean: false,
    };
    const map = MAPS[type];
    if (map) {
      const [rw, va] = DELTAS[type] ?? [0, 0];
      try {
        const ext = parseGeometry(value, c, rw, va);
        const separated = type === 0x01 || type === 0x03 || type === 0x19 || type === 0x04
          || type === 0x05 || type === 0x0a || type === 0x0e || type === 0x12 || type === 0x14
          || type === 0x1a || type === 0x08 || type === 0x06 || type === 0x07
          || type === 0x0b || type === 0x1b || type === 0x09
          || type === 0x13 || type === 0x26
          || type === 0x16 || type === 0x1c || type === 0x22 || type === 0x29 || type === 0x2e
          || type === 0x0d
          || type === 0x2d
          || type === 0x0f
          || type === 0x23
          || type === 0x21;
        const end = walkTags(value, ext, map, c, separated);
        if (end >= 0 && end !== value.length && !c.stop) c.stop = { off: end, tag: -1 };
        c.clean = end === value.length;
        applyDefaults(c, map);
      } catch {
        c.clean = false;
      }
    } else {
      parseGeometry(value, c, 0, 0);
    }
    out.push(c);
  }
  return out;
}
