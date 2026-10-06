
import type { H8 } from './h8';

export const F_I = 0x80;
export const F_UI = 0x40;
export const F_H = 0x20;
export const F_U = 0x10;
export const F_N = 0x08;
export const F_Z = 0x04;
export const F_V = 0x02;
export const F_C = 0x01;

const HAS_HC = true;

const HAS_MAC = false;

const EXR_NC = 0x78;
const EXR_I = 0x07;

const u8 = (v: number): number => v & 0xff;
const u16 = (v: number): number => v & 0xffff;
const u32 = (v: number): number => v >>> 0;
const s8 = (v: number): number => (v << 24) >> 24;
const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;
const bit32 = (v: number): boolean => v < 0 || v >= 0x100000000;

export function doAddx8(cpu: H8, v1: number, v2: number): number {
  v1 = u8(v1);
  v2 = u8(v2);
let c = u8(cpu.ccr & F_C ? 1 : 0);
let res = u16(v1 + v2 + c);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_C))) & 0xff;
if(HAS_HC) {
	if(((v1 & 0xf) + (v2 & 0xf) + c) & 0x10)
		cpu.ccr = (cpu.ccr | (F_H)) & 0xff;
	else
		cpu.ccr = (cpu.ccr & (~F_H)) & 0xff;
}
if(u8(res))
	cpu.ccr = (cpu.ccr & (~F_Z)) & 0xff;
if(s8(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if(~(v1^v2) & (v1^res) & 0x80)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
if(res & 0x100)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
return u8(res);
}

export function doSubx8(cpu: H8, v1: number, v2: number): number {
  v1 = u8(v1);
  v2 = u8(v2);
let c = u8(cpu.ccr & F_C ? 1 : 0);
let res = u16(v1 - v2 - c);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_C))) & 0xff;
if(HAS_HC) {
	if(((v1 & 0xf) - (v2 & 0xf) - c) & 0x10)
		cpu.ccr = (cpu.ccr | (F_H)) & 0xff;
	else
		cpu.ccr = (cpu.ccr & (~F_H)) & 0xff;
}
if(u8(res))
	cpu.ccr = (cpu.ccr & (~F_Z)) & 0xff;
if(s8(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if((v1^v2) & (v1^res) & 0x80)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
if(res & 0x100)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
return u8(res);
}

export function doInc8(cpu: H8, v1: number, v2: number): number {
  v1 = u8(v1);
  v2 = u8(v2);
let res = u8(v1 + v2);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z))) & 0xff;
if(!res)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if(~(v1^v2) & (v1^res) & 0x80)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
return u8(res);
}

export function doInc16(cpu: H8, v1: number, v2: number): number {
  v1 = u16(v1);
  v2 = u16(v2);
let res = u16(v1 + v2);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z))) & 0xff;
if(!res)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if(~(v1^v2) & (v1^res) & 0x8000)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
return u16(res);
}

export function doInc32(cpu: H8, v1: number, v2: number): number {
  v1 = u32(v1);
  v2 = u32(v2);
let res = u32(v1 + v2);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z))) & 0xff;
if(!res)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if(~(v1^v2) & (v1^res) & 0x80000000)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
return u32(res);
}

export function doAdd8(cpu: H8, v1: number, v2: number): number {
  v1 = u8(v1);
  v2 = u8(v2);
let res = u16(v1 + v2);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(HAS_HC) {
	if(((v1 & 0xf) + (v2 & 0xf)) & 0x10)
		cpu.ccr = (cpu.ccr | (F_H)) & 0xff;
	else
		cpu.ccr = (cpu.ccr & (~F_H)) & 0xff;
}
if(!u8(res))
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if(~(v1^v2) & (v1^res) & 0x80)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
if(res & 0x100)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
return u8(res);
}

export function doAdd16(cpu: H8, v1: number, v2: number): number {
  v1 = u16(v1);
  v2 = u16(v2);
let res = u32(v1 + v2);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(HAS_HC) {
	if(((v1 & 0xfff) + (v2 & 0xfff)) & 0x1000)
		cpu.ccr = (cpu.ccr | (F_H)) & 0xff;
	else
		cpu.ccr = (cpu.ccr & (~F_H)) & 0xff;
}
if(!u16(res))
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if(~(v1^v2) & (v1^res) & 0x8000)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
if(res & 0x10000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
return u16(res);
}

export function doAdd32(cpu: H8, v1: number, v2: number): number {
  v1 = u32(v1);
  v2 = u32(v2);
let res = (v1) + (v2);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(HAS_HC) {
	if(((v1 & 0xfffffff) + (v2 & 0xfffffff)) & 0x10000000)
		cpu.ccr = (cpu.ccr | (F_H)) & 0xff;
	else
		cpu.ccr = (cpu.ccr & (~F_H)) & 0xff;
}
if(!u32(res))
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if(~(v1^v2) & (v1^res) & 0x80000000)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
if(bit32(res))
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
return u32(res);
}

export function doDec8(cpu: H8, v1: number, v2: number): number {
  v1 = u8(v1);
  v2 = u8(v2);
let res = u8(v1 - v2);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z))) & 0xff;
if(!res)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if((v1^v2) & (v1^res) & 0x80)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
return u8(res);
}

export function doDec16(cpu: H8, v1: number, v2: number): number {
  v1 = u16(v1);
  v2 = u16(v2);
let res = u16(v1 - v2);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z))) & 0xff;
if(!res)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if((v1^v2) & (v1^res) & 0x8000)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
return u16(res);
}

export function doDec32(cpu: H8, v1: number, v2: number): number {
  v1 = u32(v1);
  v2 = u32(v2);
let res = u32(v1 - v2);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z))) & 0xff;
if(!res)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if((v1^v2) & (v1^res) & 0x80000000)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
return u32(res);
}

export function doSub8(cpu: H8, v1: number, v2: number): number {
  v1 = u8(v1);
  v2 = u8(v2);
let res = u16(v1 - v2);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(HAS_HC) {
	if(((v1 & 0xf) - (v2 & 0xf)) & 0x10)
		cpu.ccr = (cpu.ccr | (F_H)) & 0xff;
	else
		cpu.ccr = (cpu.ccr & (~F_H)) & 0xff;
}
if(!u8(res))
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if((v1^v2) & (v1^res) & 0x80)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
if(res & 0x100)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
return u8(res);
}

export function doSub16(cpu: H8, v1: number, v2: number): number {
  v1 = u16(v1);
  v2 = u16(v2);
let res = u32(v1 - v2);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(HAS_HC) {
	if(((v1 & 0xfff) - (v2 & 0xfff)) & 0x1000)
		cpu.ccr = (cpu.ccr | (F_H)) & 0xff;
	else
		cpu.ccr = (cpu.ccr & (~F_H)) & 0xff;
}
if(!u16(res))
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if((v1^v2) & (v1^res) & 0x8000)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
if(res & 0x10000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
return u16(res);
}

export function doSub32(cpu: H8, v1: number, v2: number): number {
  v1 = u32(v1);
  v2 = u32(v2);
let res = (v1) - (v2);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(HAS_HC) {
	if(((v1 & 0xfffffff) - (v2 & 0xfffffff)) & 0x10000000)
		cpu.ccr = (cpu.ccr | (F_H)) & 0xff;
	else
		cpu.ccr = (cpu.ccr & (~F_H)) & 0xff;
}
if(!u32(res))
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(res) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
if((v1^v2) & (v1^res) & 0x80000000)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
if(bit32(res))
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
return u32(res);
}

export function doShal8(cpu: H8, v: number): number {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x80)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
if((v & 0xc0) == 0x40 || (v & 0xc0) == 0x80)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
v <<= 1;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u8(v);
}

export function doShal16(cpu: H8, v: number): number {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x8000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
if((v & 0xc000) == 0x4000 || (v & 0xc000) == 0x8000)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
v <<= 1;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u16(v);
}

export function doShal32(cpu: H8, v: number): number {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x80000000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
if((v & 0xc0000000) == 0x40000000 || (v & 0xc0000000) == 0x80000000)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
v <<= 1;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u32(v);
}

export function doShar8(cpu: H8, v: number): number {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 1)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v >>= 1;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(v & 0x40) {
	v |= 0x80;
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
}
return u8(v);
}

export function doShar16(cpu: H8, v: number): number {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 1)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v >>= 1;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(v & 0x4000) {
	v |= 0x8000;
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
}
return u16(v);
}

export function doShar32(cpu: H8, v: number): number {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 1)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v >>>= 1;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(v & 0x40000000) {
	v |= 0x80000000;
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
}
return u32(v);
}

export function doShll8(cpu: H8, v: number): number {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x80)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v <<= 1;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u8(v);
}

export function doShll16(cpu: H8, v: number): number {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x8000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v <<= 1;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u16(v);
}

export function doShll32(cpu: H8, v: number): number {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x80000000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v <<= 1;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u32(v);
}

export function doShlr8(cpu: H8, v: number): number {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 1)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v >>= 1;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
return u8(v);
}

export function doShlr16(cpu: H8, v: number): number {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 1)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v >>= 1;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
return u16(v);
}

export function doShlr32(cpu: H8, v: number): number {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 1)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v >>>= 1;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
return u32(v);
}

export function doShal28(cpu: H8, v: number): number {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x40)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
if((v & 0xc0) == 0x40 || (v & 0xc0) == 0x80 ||
	(v & 0x60) == 0x20 || (v & 0x60) == 0x40)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
v <<= 2;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u8(v);
}

export function doShal216(cpu: H8, v: number): number {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x4000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
if((v & 0xc000) == 0x4000 || (v & 0xc000) == 0x8000 ||
	(v & 0x6000) == 0x2000 || (v & 0x6000) == 0x4000)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
v <<= 2;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u16(v);
}

export function doShal232(cpu: H8, v: number): number {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x40000000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
if((v & 0xc0000000) == 0x40000000 || (v & 0xc0000000) == 0x80000000 ||
	(v & 0x60000000) == 0x20000000 || (v & 0x60000000) == 0x40000000)
	cpu.ccr = (cpu.ccr | (F_V)) & 0xff;
v <<= 2;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u32(v);
}

export function doShar28(cpu: H8, v: number): number {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 2)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v >>= 2;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(v & 0x20) {
	v |= 0xc0;
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
}
return u8(v);
}

export function doShar216(cpu: H8, v: number): number {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 2)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v >>= 2;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(v & 0x2000) {
	v |= 0xc000;
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
}
return u16(v);
}

export function doShar232(cpu: H8, v: number): number {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 2)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v >>>= 2;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(v & 0x20000000) {
	v |= 0xc0000000;
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
}
return u32(v);
}

export function doShll28(cpu: H8, v: number): number {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x40)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v <<= 2;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u8(v);
}

export function doShll216(cpu: H8, v: number): number {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x4000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v <<= 2;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u16(v);
}

export function doShll232(cpu: H8, v: number): number {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x40000000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v <<= 2;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u32(v);
}

export function doShlr28(cpu: H8, v: number): number {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 2)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v >>= 2;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
return u8(v);
}

export function doShlr216(cpu: H8, v: number): number {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 2)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v >>= 2;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
return u16(v);
}

export function doShlr232(cpu: H8, v: number): number {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 2)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v >>>= 2;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
return u32(v);
}

export function doRotl8(cpu: H8, v: number): number {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x80)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 1) | (v >> 7);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u8(v);
}

export function doRotl16(cpu: H8, v: number): number {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x8000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 1) | (v >> 15);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u16(v);
}

export function doRotl32(cpu: H8, v: number): number {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x80000000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 1) | (v >>> 31);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u32(v);
}

export function doRotr8(cpu: H8, v: number): number {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x01)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 7) | (v >> 1);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u8(v);
}

export function doRotr16(cpu: H8, v: number): number {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x0001)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 15) | (v >> 1);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u16(v);
}

export function doRotr32(cpu: H8, v: number): number {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x00000001)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 31) | (v >>> 1);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u32(v);
}

export function doRotxl8(cpu: H8, v: number): number {
  v = u8(v);
let c = u8(cpu.ccr & F_C ? 1 : 0);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x80)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 1) | c;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u8(v);
}

export function doRotxl16(cpu: H8, v: number): number {
  v = u16(v);
let c = u16(cpu.ccr & F_C ? 1 : 0);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x8000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 1) | c;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u16(v);
}

export function doRotxl32(cpu: H8, v: number): number {
  v = u32(v);
let c = u32(cpu.ccr & F_C ? 1 : 0);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x80000000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 1) | c;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u32(v);
}

export function doRotxr8(cpu: H8, v: number): number {
  v = u8(v);
let c = u8(cpu.ccr & F_C ? 1 : 0);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x01)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v >> 1) | (c << 7);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u8(v);
}

export function doRotxr16(cpu: H8, v: number): number {
  v = u16(v);
let c = u8(cpu.ccr & F_C ? 1 : 0);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x0001)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v >> 1) | (c << 15);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u16(v);
}

export function doRotxr32(cpu: H8, v: number): number {
  v = u32(v);
let c = u8(cpu.ccr & F_C ? 1 : 0);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x00000001)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v >>> 1) | (c << 31);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u32(v);
}

export function doRotl28(cpu: H8, v: number): number {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x40)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 2) | (v >> 6);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u8(v);
}

export function doRotl216(cpu: H8, v: number): number {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x4000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 2) | (v >> 14);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u16(v);
}

export function doRotl232(cpu: H8, v: number): number {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x40000000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 2) | (v >>> 30);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u32(v);
}

export function doRotr28(cpu: H8, v: number): number {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x02)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 6) | (v >> 2);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u8(v);
}

export function doRotr216(cpu: H8, v: number): number {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x0002)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 14) | (v >> 2);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u16(v);
}

export function doRotr232(cpu: H8, v: number): number {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x00000002)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 30) | (v >>> 2);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u32(v);
}

export function doRotxl28(cpu: H8, v: number): number {
  v = u8(v);
let c = u8(cpu.ccr & F_C ? 1 : 0);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x40)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 2) | (c << 1) | (v >> 7);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u8(v);
}

export function doRotxl216(cpu: H8, v: number): number {
  v = u16(v);
let c = u16(cpu.ccr & F_C ? 1 : 0);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x4000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 2) | (c << 1) | (v >> 15);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u16(v);
}

export function doRotxl232(cpu: H8, v: number): number {
  v = u32(v);
let c = u32(cpu.ccr & F_C ? 1 : 0);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x40000000)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v << 2) | (c << 1) | (v >>> 31);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u32(v);
}

export function doRotxr28(cpu: H8, v: number): number {
  v = u8(v);
let c = u8(cpu.ccr & F_C ? 1 : 0);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x02)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v >> 2) | (c << 6) | (v << 7);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u8(v);
}

export function doRotxr216(cpu: H8, v: number): number {
  v = u16(v);
let c = u16(cpu.ccr & F_C ? 1 : 0);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x0002)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v >> 2) | (c << 14) | (v << 15);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u16(v);
}

export function doRotxr232(cpu: H8, v: number): number {
  v = u32(v);
let c = u32(cpu.ccr & F_C ? 1 : 0);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z|F_C))) & 0xff;
if(v & 0x00000002)
	cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
v = (v >>> 2) | (c << 30) | (v << 31);
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
return u32(v);
}

export function setNzv8(cpu: H8, v: number): void {
  v = u8(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z))) & 0xff;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s8(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
}

export function setNzv16(cpu: H8, v: number): void {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z))) & 0xff;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
}

export function setNzv32(cpu: H8, v: number): void {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_V|F_Z))) & 0xff;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
}

export function setNz16(cpu: H8, v: number): void {
  v = u16(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_Z))) & 0xff;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s16(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
}

export function setNz32(cpu: H8, v: number): void {
  v = u32(v);
cpu.ccr = (cpu.ccr & (~(F_N|F_Z))) & 0xff;
if(!v)
	cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
else if(s32(v) < 0)
	cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
}

function op_nop(cpu: H8): void {
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_mov_l_r32ih_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[1] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read16(cpu.tmp2) << 16) >>> 0;
  cpu.tmp1 = (cpu.tmp1 | (cpu.read16(cpu.tmp2+2))) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[1], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_l_r32l_r32ih(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[1] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1])) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.write16(cpu.tmp2, cpu.tmp1 >> 16);
  cpu.write16(cpu.tmp2+2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_l_abs16_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (s16(cpu.ir[2])) >>> 0;
  cpu.tmp1 = (cpu.read16(cpu.tmp2) << 16) >>> 0;
  cpu.tmp1 = (cpu.tmp1 | (cpu.read16(cpu.tmp2+2))) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[1], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_l_abs32_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[3] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = ((cpu.ir[2] << 16) | cpu.ir[3]) >>> 0;
  cpu.tmp1 = (cpu.read16(cpu.tmp2) << 16) >>> 0;
  cpu.tmp1 = (cpu.tmp1 | (cpu.read16(cpu.tmp2+2))) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[1], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_l_r32l_abs16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1])) >>> 0;
  cpu.tmp2 = (s16(cpu.ir[2])) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.write16(cpu.tmp2, cpu.tmp1 >> 16);
  cpu.write16(cpu.tmp2+2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_l_r32l_abs32(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[3] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1])) >>> 0;
  cpu.tmp2 = ((cpu.ir[2] << 16) | cpu.ir[3]) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.write16(cpu.tmp2, cpu.tmp1 >> 16);
  cpu.write16(cpu.tmp2+2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_l_r32ph_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.internal(1);
  cpu.tmp2 = (cpu.r32r(cpu.ir[1] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read16(cpu.tmp2) << 16) >>> 0;
  cpu.tmp1 = (cpu.tmp1 | (cpu.read16(cpu.tmp2+2))) >>> 0;
  cpu.tmp2 = (cpu.tmp2 + (4)) >>> 0;
  cpu.r32w(cpu.ir[1] >> 4, cpu.tmp2);
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[1], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_l_r32l_pr32h(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.internal(1);
  cpu.tmp1 = (cpu.r32r(cpu.ir[1])) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[1] >> 4)) >>> 0;
  cpu.tmp2 = (cpu.tmp2 - (4)) >>> 0;
  cpu.r32w(cpu.ir[1] >> 4, cpu.tmp2);
  setNzv32(cpu, cpu.tmp1);
  cpu.write16(cpu.tmp2, cpu.tmp1 >> 16);
  cpu.write16(cpu.tmp2+2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_l_r32d16h_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4) + s16(cpu.ir[2])) >>> 0;
  cpu.tmp2 = (cpu.read16(cpu.tmp1) << 16) >>> 0;
  cpu.tmp2 = (cpu.tmp2 | (cpu.read16(cpu.tmp1+2))) >>> 0;
  setNzv32(cpu, cpu.tmp2);
  cpu.r32w(cpu.ir[1], cpu.tmp2);
  cpu.prefetchDone();
}

function op_mov_l_r32l_r32d16h(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4) + s16(cpu.ir[2])) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[1])) >>> 0;
  setNzv32(cpu, cpu.tmp2);
  cpu.write16(cpu.tmp1, cpu.tmp2 >> 16);
  cpu.write16(cpu.tmp1+2, cpu.tmp2);
  cpu.prefetchDone();
}

function op_mov_l_r32d32hh_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[3] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[4] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4) + (cpu.ir[3] << 16) + cpu.ir[4]) >>> 0;
  cpu.tmp2 = (cpu.read16(cpu.tmp1) << 16) >>> 0;
  cpu.tmp2 = (cpu.tmp2 | (cpu.read16(cpu.tmp1+2))) >>> 0;
  setNzv32(cpu, cpu.tmp2);
  cpu.r32w(cpu.ir[2], cpu.tmp2);
  cpu.prefetchDone();
}

function op_mov_l_r32l_r32d32hh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[3] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[4] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4) + (cpu.ir[3] << 16) + cpu.ir[4]) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[2])) >>> 0;
  setNzv32(cpu, cpu.tmp2);
  cpu.write16(cpu.tmp1, cpu.tmp2 >> 16);
  cpu.write16(cpu.tmp1+2, cpu.tmp2);
  cpu.prefetchDone();
}

function op_ldc_w_r32ih_ccr(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4)) >>> 0;
  cpu.ccr = (cpu.read16(cpu.tmp1) >> 8) & 0xff;
  cpu.updateIrqFilter();
  cpu.prefetchDoneNoirq();
}

function op_stc_w_ccr_r32ih(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4)) >>> 0;
  cpu.write16(cpu.tmp1, (cpu.ccr << 8) | cpu.ccr);
  cpu.prefetchDone();
}

function op_ldc_w_abs16_ccr(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (s16(cpu.ir[2])) >>> 0;
  cpu.ccr = (cpu.read16(cpu.tmp1) >> 8) & 0xff;
  cpu.updateIrqFilter();
  cpu.prefetchDoneNoirq();
}

function op_ldc_w_abs32_ccr(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[3] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = ((cpu.ir[2] << 16) | cpu.ir[3]) >>> 0;
  cpu.ccr = (cpu.read16(cpu.tmp1) >> 8) & 0xff;
  cpu.updateIrqFilter();
  cpu.prefetchDoneNoirq();
}

function op_stc_w_ccr_abs16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (s16(cpu.ir[2])) >>> 0;
  cpu.write16(cpu.tmp1, (cpu.ccr << 8) | cpu.ccr);
  cpu.prefetchDone();
}

function op_stc_w_ccr_abs32(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[3] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = ((cpu.ir[2] << 16) | cpu.ir[3]) >>> 0;
  cpu.write16(cpu.tmp1, (cpu.ccr << 8) | cpu.ccr);
  cpu.prefetchDone();
}

function op_ldc_w_r32ph_ccr(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.internal(1);
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4)) >>> 0;
  cpu.r32w(cpu.ir[1] >> 4, cpu.tmp1+2);
  cpu.ccr = (cpu.read16(cpu.tmp1) >> 8) & 0xff;
  cpu.updateIrqFilter();
  cpu.prefetchDoneNoirq();
}

function op_stc_w_ccr_pr32h(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.internal(1);
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4) - 2) >>> 0;
  cpu.r32w(cpu.ir[1] >> 4, cpu.tmp1);
  cpu.write16(cpu.tmp1, (cpu.ccr << 8) | cpu.ccr);
  cpu.prefetchDone();
}

function op_ldc_w_r32d16h_ccr(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4) + s16(cpu.ir[2])) >>> 0;
  cpu.ccr = (cpu.read16(cpu.tmp1) >> 8) & 0xff;
  cpu.updateIrqFilter();
  cpu.prefetchDoneNoirq();
}

function op_stc_w_ccr_r32d16h(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4) + s16(cpu.ir[2])) >>> 0;
  cpu.write16(cpu.tmp1, (cpu.ccr << 8) | cpu.ccr);
  cpu.prefetchDone();
}

function op_ldc_w_r32d32hh_ccr(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[3] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[4] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4) + (cpu.ir[3] << 16) + cpu.ir[4]) >>> 0;
  cpu.ccr = (cpu.read16(cpu.tmp1) >> 8) & 0xff;
  cpu.updateIrqFilter();
  cpu.prefetchDoneNoirq();
}

function op_stc_w_ccr_r32d32hh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[3] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[4] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4) + (cpu.ir[3] << 16) + cpu.ir[4]) >>> 0;
  cpu.write16(cpu.tmp1, (cpu.ccr << 8) | cpu.ccr);
  cpu.prefetchDone();
}

function op_sleep(cpu: H8): void {
  cpu.sleep();
}

function op_mulxs_b_r8h_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (s8(cpu.r16r(cpu.ir[1])) * s8(cpu.r8r(cpu.ir[1] >> 4))) >>> 0;
  setNz16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[1], cpu.tmp1);
  cpu.internal(HAS_MAC ? 2 : 11);
  cpu.prefetchDone();
}

function op_mulxs_w_r16h_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (s16(cpu.r32r(cpu.ir[1])) * s16(cpu.r16r(cpu.ir[1] >> 4))) >>> 0;
  setNz32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[1], cpu.tmp1);
  cpu.internal(HAS_MAC ? 3 : 19);
  cpu.prefetchDone();
}

function op_divxs_b_r8h_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.internal(11);
  cpu.tmp1 = (s16(cpu.r16r(cpu.ir[1]))) >>> 0;
  cpu.tmp2 = (s8(cpu.r8r(cpu.ir[1] >> 4))) >>> 0;
  cpu.ccr = (cpu.ccr & (~(F_Z|F_N))) & 0xff;
  if(!cpu.tmp2) {
    cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
  } else {
    let q = 0, r = 0;
    if(cpu.tmp2 & 0x80000000) {
      if(cpu.tmp1 & 0x80000000) {
        q = Math.trunc((u32(-cpu.tmp1)) / (u32(-cpu.tmp2)));
        r = -((u32(-cpu.tmp1)) % (u32(-cpu.tmp2)));
      } else {
        q = Math.trunc(-(cpu.tmp1 / (u32(-cpu.tmp2))));
        r = cpu.tmp1 % (u32(-cpu.tmp2));
      }
    } else {
      if(cpu.tmp1 & 0x80000000) {
        q = Math.trunc(-((u32(-cpu.tmp1)) / cpu.tmp2));
        r = -((u32(-cpu.tmp1)) % cpu.tmp2);
      } else {
        q = Math.trunc(cpu.tmp1 / cpu.tmp2);
        r = cpu.tmp1 % cpu.tmp2;
      }
    }
    if(q < 0)
      cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
    cpu.r16w(cpu.ir[1], (q & 0xff) | ((r & 0xff) << 8));
  }
  cpu.prefetchDone();
}

function op_divxs_w_r16h_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.internal(19);
  cpu.tmp1 = (cpu.r32r(cpu.ir[1])) >>> 0;
  cpu.tmp2 = (s16(cpu.r16r(cpu.ir[1] >> 4))) >>> 0;
  cpu.ccr = (cpu.ccr & (~(F_Z|F_N))) & 0xff;
  if(!cpu.tmp2) {
    cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
  } else {
    let q = 0, r = 0;
    if(cpu.tmp2 & 0x80000000) {
      if(cpu.tmp1 & 0x80000000) {
        q = Math.trunc((u32(-cpu.tmp1)) / (u32(-cpu.tmp2)));
        r = -((u32(-cpu.tmp1)) % (u32(-cpu.tmp2)));
      } else {
        q = Math.trunc(-(cpu.tmp1 / (u32(-cpu.tmp2))));
        r = cpu.tmp1 % (u32(-cpu.tmp2));
      }
    } else {
      if(cpu.tmp1 & 0x80000000) {
        q = Math.trunc(-((u32(-cpu.tmp1)) / cpu.tmp2));
        r = -((u32(-cpu.tmp1)) % cpu.tmp2);
      } else {
        q = Math.trunc(cpu.tmp1 / cpu.tmp2);
        r = cpu.tmp1 % cpu.tmp2;
      }
    }
    if(q < 0)
      cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
    cpu.r32w(cpu.ir[1], (q & 0xffff) | ((r & 0xffff) << 16));
  }
  cpu.prefetchDone();
}

function op_or_l_r32h_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4) | cpu.r32r(cpu.ir[1])) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[1], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_xor_l_r32h_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4) ^ cpu.r32r(cpu.ir[1])) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[1], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_and_l_r32h_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[1] >> 4) & cpu.r32r(cpu.ir[1])) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[1], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_stc_ccr_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], cpu.ccr);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_ldc_r8l_ccr(cpu: H8): void {
  cpu.ccr = (cpu.r8r(cpu.ir[0])) & 0xff;
  cpu.updateIrqFilter();
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDoneNoirq();
}

function op_orc_imm8_ccr(cpu: H8): void {
  cpu.ccr = (cpu.ccr | (cpu.ir[0])) & 0xff;
  cpu.updateIrqFilter();
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDoneNoirq();
}

function op_xorc_imm8_ccr(cpu: H8): void {
  cpu.ccr = (cpu.ccr ^ (cpu.ir[0])) & 0xff;
  cpu.updateIrqFilter();
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDoneNoirq();
}

function op_andc_imm8_ccr(cpu: H8): void {
  cpu.ccr = (cpu.ccr & (cpu.ir[0])) & 0xff;
  cpu.updateIrqFilter();
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDoneNoirq();
}

function op_ldc_imm8_ccr(cpu: H8): void {
  cpu.ccr = (cpu.ir[0]) & 0xff;
  cpu.updateIrqFilter();
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDoneNoirq();
}

function op_add_b_r8h_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doAdd8(cpu, cpu.r8r(cpu.ir[0]), cpu.r8r(cpu.ir[0] >> 4)));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_add_w_r16h_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doAdd16(cpu, cpu.r16r(cpu.ir[0]), cpu.r16r(cpu.ir[0] >> 4)));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_inc_b_one_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doInc8(cpu, cpu.r8r(cpu.ir[0]), 1));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_add_l_r32h_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doAdd32(cpu, cpu.r32r(cpu.ir[0]), cpu.r32r(cpu.ir[0] >> 4)));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_adds_l_one_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], cpu.r32r(cpu.ir[0])+1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_inc_w_one_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doInc16(cpu, cpu.r16r(cpu.ir[0]), 1));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_inc_l_one_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doInc32(cpu, cpu.r32r(cpu.ir[0]), 1));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_adds_l_two_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], cpu.r32r(cpu.ir[0])+2);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_adds_l_four_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], cpu.r32r(cpu.ir[0])+4);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_inc_w_two_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doInc16(cpu, cpu.r16r(cpu.ir[0]), 2));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_inc_l_two_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doInc32(cpu, cpu.r32r(cpu.ir[0]), 2));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_mov_b_r8h_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0] >> 4)) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_mov_w_r16h_r16l(cpu: H8): void {
  cpu.tmp1 = (cpu.r16r(cpu.ir[0] >> 4)) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_addx_b_r8h_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doAddx8(cpu, cpu.r8r(cpu.ir[0]), cpu.r8r(cpu.ir[0] >> 4)));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_daa_b_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  cpu.tmp2 = (0) >>> 0;
  if(cpu.ccr & F_C) {
    if(HAS_HC && (cpu.ccr & F_H)) {
      if((cpu.tmp1 & 0xf0) <= 0x30 && (cpu.tmp1 & 0x0f) <= 3)
        cpu.tmp2 = (0x66) >>> 0;
    } else {
      if((cpu.tmp1 & 0xf0) <= 0x20)
        cpu.tmp2 = ((cpu.tmp1 & 0x0f) <= 9 ? 0x60 : 0x66) >>> 0;
    }
  } else {
    if(HAS_HC && (cpu.ccr & F_H)) {
      if((cpu.tmp1 & 0x0f) <= 3)
        cpu.tmp2 = ((cpu.tmp1 & 0xf0) <= 0x90 ? 0x06 : 0x66) >>> 0;
    } else {
      if((cpu.tmp1 & 0x0f) <= 9)
        cpu.tmp2 = ((cpu.tmp1 & 0xf0) <= 0x90 ? 0x00 : 0x60) >>> 0;
      else
        cpu.tmp2 = ((cpu.tmp1 & 0xf0) <= 0x80 ? 0x06 : 0x66) >>> 0;
    }
  }
  cpu.r8w(cpu.ir[0], doAdd8(cpu, cpu.tmp1, cpu.tmp2));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_mov_l_r32h_r32l(cpu: H8): void {
  cpu.tmp1 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_shll_b_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doShll8(cpu, cpu.r8r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_shll_w_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doShll16(cpu, cpu.r16r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_shll_l_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doShll32(cpu, cpu.r32r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_shal_b_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doShal8(cpu, cpu.r8r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_shal_w_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doShal16(cpu, cpu.r16r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_shal_l_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doShal32(cpu, cpu.r32r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_shlr_b_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doShlr8(cpu, cpu.r8r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_shlr_w_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doShlr16(cpu, cpu.r16r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_shlr_l_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doShlr32(cpu, cpu.r32r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_shar_b_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doShar8(cpu, cpu.r8r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_shar_w_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doShar16(cpu, cpu.r16r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_shar_l_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doShar32(cpu, cpu.r32r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_rotxl_b_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doRotxl8(cpu, cpu.r8r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_rotxl_w_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doRotxl16(cpu, cpu.r16r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_rotxl_l_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doRotxl32(cpu, cpu.r32r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_rotl_b_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doRotl8(cpu, cpu.r8r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_rotl_w_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doRotl16(cpu, cpu.r16r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_rotl_l_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doRotl32(cpu, cpu.r32r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_rotxr_b_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doRotxr8(cpu, cpu.r8r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_rotxr_w_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doRotxr16(cpu, cpu.r16r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_rotxr_l_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doRotxr32(cpu, cpu.r32r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_rotr_b_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doRotr8(cpu, cpu.r8r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_rotr_w_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doRotr16(cpu, cpu.r16r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_rotr_l_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doRotr32(cpu, cpu.r32r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_or_b_r8h_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0] >> 4) | cpu.r8r(cpu.ir[0])) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_xor_b_r8h_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0] >> 4) ^ cpu.r8r(cpu.ir[0])) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_and_b_r8h_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0] >> 4) & cpu.r8r(cpu.ir[0])) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_not_b_r8l(cpu: H8): void {
  cpu.tmp1 = (~cpu.r8r(cpu.ir[0])) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_not_w_r16l(cpu: H8): void {
  cpu.tmp1 = (~cpu.r16r(cpu.ir[0])) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_not_l_r32l(cpu: H8): void {
  cpu.tmp1 = (~cpu.r32r(cpu.ir[0])) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_extu_w_r16l(cpu: H8): void {
  cpu.tmp1 = (u8(cpu.r16r(cpu.ir[0]))) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_extu_l_r32l(cpu: H8): void {
  cpu.tmp1 = (u16(cpu.r32r(cpu.ir[0]))) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_neg_b_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doSub8(cpu, 0, cpu.r8r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_neg_w_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doSub16(cpu, 0, cpu.r16r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_neg_l_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doSub32(cpu, 0, cpu.r32r(cpu.ir[0])));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_exts_w_r16l(cpu: H8): void {
  cpu.tmp1 = (s8(cpu.r16r(cpu.ir[0]))) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_exts_l_r32l(cpu: H8): void {
  cpu.tmp1 = (s16(cpu.r32r(cpu.ir[0]))) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_sub_b_r8h_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doSub8(cpu, cpu.r8r(cpu.ir[0]), cpu.r8r(cpu.ir[0] >> 4)));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_sub_w_r16h_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doSub16(cpu, cpu.r16r(cpu.ir[0]), cpu.r16r(cpu.ir[0] >> 4)));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_dec_b_one_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doDec8(cpu, cpu.r8r(cpu.ir[0]), 1));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_sub_l_r32h_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doSub32(cpu, cpu.r32r(cpu.ir[0]), cpu.r32r(cpu.ir[0] >> 4)));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_subs_l_one_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], cpu.r32r(cpu.ir[0])-1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_dec_w_one_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doDec16(cpu, cpu.r16r(cpu.ir[0]), 1));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_dec_l_one_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doDec32(cpu, cpu.r32r(cpu.ir[0]), 1));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_subs_l_two_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], cpu.r32r(cpu.ir[0])-2);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_subs_l_four_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], cpu.r32r(cpu.ir[0])-4);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_dec_w_two_r16l(cpu: H8): void {
  cpu.r16w(cpu.ir[0], doDec16(cpu, cpu.r16r(cpu.ir[0]), 2));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_dec_l_two_r32l(cpu: H8): void {
  cpu.r32w(cpu.ir[0], doDec32(cpu, cpu.r32r(cpu.ir[0]), 2));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_cmp_b_r8h_r8l(cpu: H8): void {
  doSub8(cpu, cpu.r8r(cpu.ir[0]), cpu.r8r(cpu.ir[0] >> 4));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_cmp_w_r16h_r16l(cpu: H8): void {
  doSub16(cpu, cpu.r16r(cpu.ir[0]), cpu.r16r(cpu.ir[0] >> 4));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_subx_b_r8h_r8l(cpu: H8): void {
  cpu.r8w(cpu.ir[0], doSubx8(cpu, cpu.r8r(cpu.ir[0]), cpu.r8r(cpu.ir[0] >> 4)));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_das_b_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  cpu.tmp2 = (0) >>> 0;
  if(cpu.ccr & F_C) {
    if(HAS_HC && (cpu.ccr & F_H)) {
      if((cpu.tmp1 & 0xf0) >= 0x60 && (cpu.tmp1 & 0x0f) >= 6)
        cpu.tmp2 = (0x9a) >>> 0;
    } else {
      if((cpu.tmp1 & 0xf0) >= 0x70 && (cpu.tmp1 & 0x0f) <= 9)
        cpu.tmp2 = (0xa0) >>> 0;
    }
  } else {
    if(HAS_HC && (cpu.ccr & F_H)) {
      if((cpu.tmp1 & 0xf0) <= 0x80 && (cpu.tmp1 & 0x0f) >= 6)
        cpu.tmp2 = (0xfa) >>> 0;
    }
  }
  cpu.r8w(cpu.ir[0], doAdd8(cpu, cpu.tmp1, cpu.tmp2));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_cmp_l_r32h_r32l(cpu: H8): void {
  doSub32(cpu, cpu.r32r(cpu.ir[0]), cpu.r32r(cpu.ir[0] >> 4));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_mov_b_abs8_r8u(cpu: H8): void {
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.read8(0xffffff00 | cpu.ir[0])) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0] >> 8, cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_b_r8u_abs8(cpu: H8): void {
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r8r(cpu.ir[0] >> 8)) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.write8(0xffffff00 | cpu.ir[0], cpu.tmp1);
  cpu.prefetchDone();
}

function op_bt_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(true)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bf_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(false)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bhi_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!(cpu.ccr & (F_C|F_Z)))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bls_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(cpu.ccr & (F_C|F_Z))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bcc_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!(cpu.ccr & F_C))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bcs_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(cpu.ccr & F_C)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bne_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!(cpu.ccr & F_Z))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_beq_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(cpu.ccr & F_Z)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bvc_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!(cpu.ccr & F_V))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bvs_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(cpu.ccr & F_V)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bpl_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!(cpu.ccr & F_N))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bmi_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(cpu.ccr & F_N)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bge_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!((cpu.ccr & (F_N|F_V)) == F_N || (cpu.ccr & (F_N|F_V)) == F_V))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_blt_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if((cpu.ccr & (F_N|F_V)) == F_N || (cpu.ccr & (F_N|F_V)) == F_V)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bgt_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!((cpu.ccr & F_Z) || (cpu.ccr & (F_N|F_V)) == F_N || (cpu.ccr & (F_N|F_V)) == F_V))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_ble_rel8(cpu: H8): void {
  cpu.tmp1 = (cpu.pc + s8(cpu.ir[0])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if((cpu.ccr & F_Z) || (cpu.ccr & (F_N|F_V)) == F_N || (cpu.ccr & (F_N|F_V)) == F_V)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_mulxu_b_r8h_r16l(cpu: H8): void {
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.r16w(cpu.ir[0], u8(cpu.r16r(cpu.ir[0])) * cpu.r8r(cpu.ir[0] >> 4));
  cpu.internal(HAS_MAC ? 2 : 11);
  cpu.prefetchDone();
}

function op_divxu_b_r8h_r16l(cpu: H8): void {
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.internal(11);
  cpu.tmp1 = (cpu.r16r(cpu.ir[0])) >>> 0;
  cpu.tmp2 = (cpu.r8r(cpu.ir[0] >> 4)) >>> 0;
  cpu.ccr = (cpu.ccr & (~(F_Z|F_N))) & 0xff;
  if(cpu.tmp2 & 0x80)
    cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
  if(!cpu.tmp2) {
    cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
  } else {
    let q = Math.trunc(cpu.tmp1 / cpu.tmp2);
    let r = Math.trunc(cpu.tmp1 % cpu.tmp2);
    cpu.r16w(cpu.ir[0], (q & 0xff) | ((r & 0xff) << 8));
  }
  cpu.prefetchDone();
}

function op_mulxu_w_r16h_r32l(cpu: H8): void {
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.r32w(cpu.ir[0], u16(cpu.r32r(cpu.ir[0])) * cpu.r16r(cpu.ir[0] >> 4));
  cpu.internal(HAS_MAC ? 3 : 19);
  cpu.prefetchDone();
}

function op_divxu_w_r16h_r32l(cpu: H8): void {
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.internal(11);
  cpu.tmp1 = (cpu.r32r(cpu.ir[0])) >>> 0;
  cpu.tmp2 = (cpu.r16r(cpu.ir[0] >> 4)) >>> 0;
  cpu.ccr = (cpu.ccr & (~(F_Z|F_N))) & 0xff;
  if(cpu.tmp2 & 0x80)
    cpu.ccr = (cpu.ccr | (F_N)) & 0xff;
  if(!cpu.tmp2) {
    cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
  } else {
    let q = Math.trunc(cpu.tmp1 / cpu.tmp2);
    let r = Math.trunc(cpu.tmp1 % cpu.tmp2);
    cpu.r32w(cpu.ir[0], (q & 0xffff) | ((r & 0xffff) << 16));
  }
  cpu.prefetchDone();
}

function op_rts(cpu: H8): void {
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(7)) >>> 0;
  if(cpu.modeAdvanced) {
    cpu.tmp2 = (cpu.read16(cpu.tmp1) << 16) >>> 0;
    cpu.tmp2 = (cpu.tmp2 | (cpu.read16(cpu.tmp1+2))) >>> 0;
    cpu.r32w(7, cpu.tmp1+4);
  } else {
    cpu.tmp2 = (cpu.read16(cpu.tmp1)) >>> 0;
    cpu.r32w(7, cpu.tmp1+2);
  }
  cpu.internal(1);
  cpu.pc = (cpu.tmp2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bsr_rel8(cpu: H8): void {
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.tmp2 = (cpu.pc) >>> 0;
  cpu.pc = (cpu.pc + (s8(cpu.ir[0]))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  if(cpu.modeAdvanced) {
    cpu.tmp1 = (cpu.r32r(7) - 4) >>> 0;
    cpu.r32w(7, cpu.tmp1);
    cpu.write16(cpu.tmp1, cpu.tmp2 >> 16);
    cpu.write16(cpu.tmp1+2, cpu.tmp2);
  } else {
    cpu.tmp1 = (cpu.r32r(7) - 2) >>> 0;
    cpu.r32w(7, cpu.tmp1);
    cpu.write16(cpu.tmp1, cpu.tmp2);
  }
  cpu.prefetchDone();
}

function op_rte(cpu: H8): void {
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(7)) >>> 0;
  if(false) {
    cpu.exr = ((cpu.read16(cpu.tmp1) >> 8) | EXR_NC) & 0xff;
    cpu.tmp1 = (cpu.tmp1 + (2)) >>> 0;
  }
  cpu.tmp2 = (cpu.read16(cpu.tmp1)) >>> 0;
  cpu.ccr = (cpu.tmp2 >> 8) & 0xff;
  if(cpu.modeAdvanced) {
    cpu.tmp2 = ((cpu.tmp2 & 0xff) << 16) >>> 0;
    cpu.tmp2 = (cpu.tmp2 | (cpu.read16(cpu.tmp1+2))) >>> 0;
  } else {
    cpu.tmp2 = (cpu.read16(cpu.tmp1+2)) >>> 0;
  }
  cpu.r32w(7, cpu.tmp1+4);
  cpu.internal(1);
  cpu.pc = (cpu.tmp2) >>> 0;
  cpu.updateIrqFilter();
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDoneNotrace();
}

function op_trapa_imm2(cpu: H8): void {
  cpu.internal(1);
  cpu.tmp1 = (cpu.r32r(7) - 2) >>> 0;
  cpu.r32w(7, cpu.tmp1);
  cpu.write16(cpu.tmp1, cpu.npc);
  cpu.tmp1 = (cpu.r32r(7) - 2) >>> 0;
  cpu.r32w(7, cpu.tmp1);
  cpu.write16(cpu.tmp1, (cpu.ccr << 8) | ((cpu.npc >> 16) & 0xff));
  if(false) {
    cpu.tmp1 = (cpu.r32r(7) - 2) >>> 0;
    cpu.r32w(7, cpu.tmp1);
    cpu.write16(cpu.tmp1, cpu.exr << 8);
  }
  cpu.takenIrqVector = 8 + ((cpu.ir[0] >> 4) & 3);
  cpu.exceptionHook(cpu.takenIrqVector);
  if(cpu.modeAdvanced) {
    cpu.ir[0] = (cpu.read16i(4*cpu.takenIrqVector)) & 0xffff;
    cpu.ir[1] = (cpu.read16i(4*cpu.takenIrqVector+2)) & 0xffff;
    cpu.pc = ((cpu.ir[0] << 16) | cpu.ir[1]) >>> 0;
  } else {
    cpu.pc = (cpu.read16i(2*cpu.takenIrqVector)) >>> 0;
  }
  cpu.internal(1);
  cpu.updateIrqFilter();
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bt_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(true)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bf_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(false)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bhi_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!(cpu.ccr & (F_C|F_Z)))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bls_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(cpu.ccr & (F_C|F_Z))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bcc_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!(cpu.ccr & F_C))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bcs_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(cpu.ccr & F_C)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bne_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!(cpu.ccr & F_Z))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_beq_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(cpu.ccr & F_Z)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bvc_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!(cpu.ccr & F_V))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bvs_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(cpu.ccr & F_V)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bpl_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!(cpu.ccr & F_N))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bmi_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(cpu.ccr & F_N)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bge_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!((cpu.ccr & (F_N|F_V)) == F_N || (cpu.ccr & (F_N|F_V)) == F_V))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_blt_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if((cpu.ccr & (F_N|F_V)) == F_N || (cpu.ccr & (F_N|F_V)) == F_V)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bgt_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if(!((cpu.ccr & F_Z) || (cpu.ccr & (F_N|F_V)) == F_N || (cpu.ccr & (F_N|F_V)) == F_V))
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_ble_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.pc + s16(cpu.ir[1])) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp2 = (cpu.read16i(cpu.tmp1)) >>> 0;
  if((cpu.ccr & F_Z) || (cpu.ccr & (F_N|F_V)) == F_N || (cpu.ccr & (F_N|F_V)) == F_V)
    cpu.prefetchSwitch(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_jmp_r32h(cpu: H8): void {
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.pc = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_jmp_abs24e(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.internal(1);
  cpu.pc = (((cpu.ir[0] & 0xff) << 16) | cpu.ir[1]) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_jmp_abs8i(cpu: H8): void {
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  if(cpu.modeAdvanced) {
    cpu.tmp1 = (cpu.read16(cpu.ir[0] & 0xff) << 16) >>> 0;
    cpu.tmp1 = (cpu.tmp1 | (cpu.read16((cpu.ir[0] & 0xff) + 2))) >>> 0;
    cpu.pc = (cpu.tmp1) >>> 0;
  } else {
    cpu.pc = (cpu.read16(cpu.ir[0] & 0xff)) >>> 0;
  }
  cpu.internal(1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bsr_rel16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.internal(1);
  cpu.tmp2 = (cpu.pc) >>> 0;
  cpu.pc = (cpu.pc + (s16(cpu.ir[1]))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  if(cpu.modeAdvanced) {
    cpu.tmp1 = (cpu.r32r(7) - 4) >>> 0;
    cpu.r32w(7, cpu.tmp1);
    cpu.write16(cpu.tmp1, cpu.tmp2 >> 16);
    cpu.write16(cpu.tmp1+2, cpu.tmp2);
  } else {
    cpu.tmp1 = (cpu.r32r(7) - 2) >>> 0;
    cpu.r32w(7, cpu.tmp1);
    cpu.write16(cpu.tmp1, cpu.tmp2);
  }
  cpu.prefetchDone();
}

function op_jsr_r32h(cpu: H8): void {
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.tmp2 = (cpu.pc) >>> 0;
  cpu.pc = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  if(cpu.modeAdvanced) {
    cpu.tmp1 = (cpu.r32r(7) - 4) >>> 0;
    cpu.r32w(7, cpu.tmp1);
    cpu.write16(cpu.tmp1, cpu.tmp2 >> 16);
    cpu.write16(cpu.tmp1+2, cpu.tmp2);
  } else {
    cpu.tmp1 = (cpu.r32r(7) - 2) >>> 0;
    cpu.r32w(7, cpu.tmp1);
    cpu.write16(cpu.tmp1, cpu.tmp2);
  }
  cpu.prefetchDone();
}

function op_jsr_abs24e(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.internal(1);
  cpu.tmp2 = (cpu.pc) >>> 0;
  cpu.pc = (((cpu.ir[0] & 0xff) << 16) | cpu.ir[1]) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  if(cpu.modeAdvanced) {
    cpu.tmp1 = (cpu.r32r(7) - 4) >>> 0;
    cpu.r32w(7, cpu.tmp1);
    cpu.write16(cpu.tmp1, cpu.tmp2 >> 16);
    cpu.write16(cpu.tmp1+2, cpu.tmp2);
  } else {
    cpu.tmp1 = (cpu.r32r(7) - 2) >>> 0;
    cpu.r32w(7, cpu.tmp1);
    cpu.write16(cpu.tmp1, cpu.tmp2);
  }
  cpu.prefetchDone();
}

function op_jsr_abs8i(cpu: H8): void {
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.tmp2 = (cpu.pc) >>> 0;
  if(cpu.modeAdvanced) {
    cpu.tmp1 = (cpu.read16(cpu.ir[0] & 0xff) << 16) >>> 0;
    cpu.tmp1 = (cpu.tmp1 | (cpu.read16((cpu.ir[0] & 0xff) + 2))) >>> 0;
    cpu.pc = (cpu.tmp1) >>> 0;
  } else {
    cpu.pc = (cpu.read16(cpu.ir[0] & 0xff)) >>> 0;
  }
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  if(cpu.modeAdvanced) {
    cpu.tmp1 = (cpu.r32r(7) - 4) >>> 0;
    cpu.r32w(7, cpu.tmp1);
    cpu.write16(cpu.tmp1, cpu.tmp2 >> 16);
    cpu.write16(cpu.tmp1+2, cpu.tmp2);
  } else {
    cpu.tmp1 = (cpu.r32r(7) - 2) >>> 0;
    cpu.r32w(7, cpu.tmp1);
    cpu.write16(cpu.tmp1, cpu.tmp2);
  }
  cpu.prefetchDone();
}

function op_bset_r8h_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  cpu.tmp1 = (cpu.tmp1 | (1 << ((cpu.r8r(cpu.ir[0] >> 4)) & 7))) >>> 0;
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bnot_r8h_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  cpu.tmp1 = (cpu.tmp1 ^ (1 << ((cpu.r8r(cpu.ir[0] >> 4)) & 7))) >>> 0;
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bclr_r8h_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  cpu.tmp1 = (cpu.tmp1 & (~(1 << ((cpu.r8r(cpu.ir[0] >> 4)) & 7)))) >>> 0;
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_btst_r8h_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.r8r(cpu.ir[0] >> 4)) & 7)))
    cpu.ccr = (cpu.ccr & (~F_Z)) & 0xff;
  else
    cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_or_w_r16h_r16l(cpu: H8): void {
  cpu.tmp1 = (cpu.r16r(cpu.ir[0] >> 4) | cpu.r16r(cpu.ir[0])) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_xor_w_r16h_r16l(cpu: H8): void {
  cpu.tmp1 = (cpu.r16r(cpu.ir[0] >> 4) ^ cpu.r16r(cpu.ir[0])) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_and_w_r16h_r16l(cpu: H8): void {
  cpu.tmp1 = (cpu.r16r(cpu.ir[0] >> 4) & cpu.r16r(cpu.ir[0])) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bst_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  if(cpu.ccr & F_C)
    cpu.tmp1 = (cpu.tmp1 | (1 << ((cpu.ir[0] >> 4) & 7))) >>> 0;
  else
    cpu.tmp1 = (cpu.tmp1 & (~(1 << ((cpu.ir[0] >> 4) & 7)))) >>> 0;
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bist_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  if(!(cpu.ccr & F_C))
    cpu.tmp1 = (cpu.tmp1 | (1 << ((cpu.ir[0] >> 4) & 7))) >>> 0;
  else
    cpu.tmp1 = (cpu.tmp1 & (~(1 << ((cpu.ir[0] >> 4) & 7)))) >>> 0;
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_mov_b_r32ih_r8l(cpu: H8): void {
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.r32r(cpu.ir[0] >> 4))) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_b_r8l_r32ih(cpu: H8): void {
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.write8(cpu.r32r(cpu.ir[0] >> 4), cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_w_r32ih_r16l(cpu: H8): void {
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.read16(cpu.r32r(cpu.ir[0] >> 4))) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_w_r16l_r32ih(cpu: H8): void {
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r16r(cpu.ir[0])) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.write16(cpu.r32r(cpu.ir[0] >> 4), cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_b_abs16_r8l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.read8(s16(cpu.ir[1]))) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_b_abs32_r8l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.read8((cpu.ir[1] << 16) | cpu.ir[2])) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.prefetchDone();
}

function op_movfpe_abs16_r8l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.read8(s16(cpu.ir[1]))) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_b_r8l_abs16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.write8(s16(cpu.ir[1]), cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_b_r8l_abs32(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.write8((cpu.ir[1] << 16) | cpu.ir[2], cpu.tmp1);
  cpu.prefetchDone();
}

function op_movtpe_r8l_abs16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.write8(s16(cpu.ir[1]), cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_w_abs16_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.read16(s16(cpu.ir[1]))) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_w_abs32_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.read16((cpu.ir[1] << 16) | cpu.ir[2])) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_w_r16l_abs16(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r16r(cpu.ir[0])) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.write16(s16(cpu.ir[1]), cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_w_r16l_abs32(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r16r(cpu.ir[0])) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.write16((cpu.ir[1] << 16) | cpu.ir[2], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_b_r32ph_r8l(cpu: H8): void {
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.internal(1);
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.tmp2 = (cpu.tmp2 + (1)) >>> 0;
  cpu.r32w(cpu.ir[0] >> 4, cpu.tmp2);
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_b_r8l_pr32h(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.internal(1);
  cpu.tmp2 = (cpu.tmp2 - (1)) >>> 0;
  cpu.r32w(cpu.ir[0] >> 4, cpu.tmp2);
  setNzv8(cpu, cpu.tmp1);
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_w_r32ph_r16l(cpu: H8): void {
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.internal(1);
  cpu.tmp1 = (cpu.read16(cpu.tmp2)) >>> 0;
  cpu.tmp2 = (cpu.tmp2 + (2)) >>> 0;
  cpu.r32w(cpu.ir[0] >> 4, cpu.tmp2);
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_w_r16l_pr32h(cpu: H8): void {
  cpu.tmp1 = (cpu.r16r(cpu.ir[0])) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.internal(1);
  cpu.tmp2 = (cpu.tmp2 - (2)) >>> 0;
  cpu.r32w(cpu.ir[0] >> 4, cpu.tmp2);
  setNzv16(cpu, cpu.tmp1);
  cpu.write16(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_mov_b_r32d16h_r8l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[0] >> 4) + s16(cpu.ir[1])) >>> 0;
  cpu.tmp2 = (cpu.read8(cpu.tmp1)) >>> 0;
  setNzv8(cpu, cpu.tmp2);
  cpu.r8w(cpu.ir[0], cpu.tmp2);
  cpu.prefetchDone();
}

function op_mov_b_r8l_r32d16h(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[0] >> 4) + s16(cpu.ir[1])) >>> 0;
  cpu.tmp2 = (cpu.r8r(cpu.ir[0])) >>> 0;
  setNzv8(cpu, cpu.tmp2);
  cpu.write8(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_mov_w_r32d16h_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[0] >> 4) + s16(cpu.ir[1])) >>> 0;
  cpu.tmp2 = (cpu.read16(cpu.tmp1)) >>> 0;
  setNzv16(cpu, cpu.tmp2);
  cpu.r16w(cpu.ir[0], cpu.tmp2);
  cpu.prefetchDone();
}

function op_mov_w_r16l_r32d16h(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[0] >> 4) + s16(cpu.ir[1])) >>> 0;
  cpu.tmp2 = (cpu.r16r(cpu.ir[0])) >>> 0;
  setNzv16(cpu, cpu.tmp2);
  cpu.write16(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_bset_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  cpu.tmp1 = (cpu.tmp1 | (1 << ((cpu.ir[0] >> 4) & 7))) >>> 0;
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bnot_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  cpu.tmp1 = (cpu.tmp1 ^ (1 << ((cpu.ir[0] >> 4) & 7))) >>> 0;
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bclr_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  cpu.tmp1 = (cpu.tmp1 & (~(1 << ((cpu.ir[0] >> 4) & 7)))) >>> 0;
  cpu.r8w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_btst_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[0] >> 4) & 7)))
    cpu.ccr = (cpu.ccr & (~F_Z)) & 0xff;
  else
    cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bor_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[0] >> 4) & 7)))
    cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bior_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  if(!(cpu.tmp1 & (1 << ((cpu.ir[0] >> 4) & 7))))
    cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bxor_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[0] >> 4) & 7)))
    cpu.ccr = (cpu.ccr ^ (F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bixor_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  if(!(cpu.tmp1 & (1 << ((cpu.ir[0] >> 4) & 7))))
    cpu.ccr = (cpu.ccr ^ (F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_band_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  if(!(cpu.tmp1 & (1 << ((cpu.ir[0] >> 4) & 7))))
    cpu.ccr = (cpu.ccr & (~F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_biand_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[0] >> 4) & 7)))
    cpu.ccr = (cpu.ccr & (~F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bld_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[0] >> 4) & 7)))
    cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
  else
    cpu.ccr = (cpu.ccr & (~F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bild_imm3_r8l(cpu: H8): void {
  cpu.tmp1 = (cpu.r8r(cpu.ir[0])) >>> 0;
  if(!(cpu.tmp1 & (1 << ((cpu.ir[0] >> 4) & 7))))
    cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
  else
    cpu.ccr = (cpu.ccr & (~F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_mov_b_r32d32hh_r8l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[3] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[0] >> 4) + (cpu.ir[2] << 16) + cpu.ir[3]) >>> 0;
  cpu.tmp2 = (cpu.read8(cpu.tmp1)) >>> 0;
  setNzv8(cpu, cpu.tmp2);
  cpu.r8w(cpu.ir[1], cpu.tmp2);
  cpu.prefetchDone();
}

function op_mov_b_r8l_r32d32hh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[3] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[0] >> 4) + (cpu.ir[2] << 16) + cpu.ir[3]) >>> 0;
  cpu.tmp2 = (cpu.r8r(cpu.ir[1])) >>> 0;
  setNzv8(cpu, cpu.tmp2);
  cpu.write8(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_mov_w_r32d32hh_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[3] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[0] >> 4) + (cpu.ir[2] << 16) + cpu.ir[3]) >>> 0;
  cpu.tmp2 = (cpu.read16(cpu.tmp1)) >>> 0;
  setNzv16(cpu, cpu.tmp2);
  cpu.r16w(cpu.ir[1], cpu.tmp2);
  cpu.prefetchDone();
}

function op_mov_w_r16l_r32d32hh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[3] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[0] >> 4) + (cpu.ir[2] << 16) + cpu.ir[3]) >>> 0;
  cpu.tmp2 = (cpu.r16r(cpu.ir[1])) >>> 0;
  setNzv16(cpu, cpu.tmp2);
  cpu.write16(cpu.tmp1, cpu.tmp2);
  cpu.prefetchDone();
}

function op_mov_w_imm16_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  setNzv16(cpu, cpu.ir[1]);
  cpu.r16w(cpu.ir[0], cpu.ir[1]);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_add_w_imm16_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.r16w(cpu.ir[0], doAdd16(cpu, cpu.r16r(cpu.ir[0]), cpu.ir[1]));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_cmp_w_imm16_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  doSub16(cpu, cpu.r16r(cpu.ir[0]), cpu.ir[1]);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_sub_w_imm16_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.r16w(cpu.ir[0], doSub16(cpu, cpu.r16r(cpu.ir[0]), cpu.ir[1]));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_or_w_imm16_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.ir[1] | cpu.r16r(cpu.ir[0])) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_xor_w_imm16_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.ir[1] ^ cpu.r16r(cpu.ir[0])) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_and_w_imm16_r16l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.ir[1] & cpu.r16r(cpu.ir[0])) >>> 0;
  setNzv16(cpu, cpu.tmp1);
  cpu.r16w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_mov_l_imm32_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = ((cpu.ir[1] << 16) | cpu.ir[2]) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_add_l_imm32_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.r32w(cpu.ir[0], doAdd32(cpu, cpu.r32r(cpu.ir[0]), (cpu.ir[1] << 16) | cpu.ir[2]));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_cmp_l_imm32_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  doSub32(cpu, cpu.r32r(cpu.ir[0]), (cpu.ir[1] << 16) | cpu.ir[2]);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_sub_l_imm32_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.r32w(cpu.ir[0], doSub32(cpu, cpu.r32r(cpu.ir[0]), (cpu.ir[1] << 16) | cpu.ir[2]));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_or_l_imm32_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[0]) | ((cpu.ir[1] << 16) | cpu.ir[2])) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_xor_l_imm32_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[0]) ^ ((cpu.ir[1] << 16) | cpu.ir[2])) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_and_l_imm32_r32l(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.ir[2] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp1 = (cpu.r32r(cpu.ir[0]) & ((cpu.ir[1] << 16) | cpu.ir[2])) >>> 0;
  setNzv32(cpu, cpu.tmp1);
  cpu.r32w(cpu.ir[0], cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_eepmov_b(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  while(cpu.r8r(4+8)) {
    cpu.tmp1 = (cpu.read8(cpu.r32r(5))) >>> 0;
    cpu.write8(cpu.r32r(6), cpu.tmp1);
    cpu.r32w(5, cpu.r32r(5)+1);
    cpu.r32w(6, cpu.r32r(6)+1);
    cpu.r8w(4+8, cpu.r8r(4+8)-1);
  }
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_eepmov_w(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  while(cpu.r16r(4)) {
    cpu.tmp1 = (cpu.read8(cpu.r32r(5))) >>> 0;
    cpu.write8(cpu.r32r(6), cpu.tmp1);
    cpu.r32w(5, cpu.r32r(5)+1);
    cpu.r32w(6, cpu.r32r(6)+1);
    cpu.r16w(4, cpu.r16r(4)-1);
  }
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_btst_r8h_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.r8r(cpu.ir[1] >> 4)) & 7)))
    cpu.ccr = (cpu.ccr & (~F_Z)) & 0xff;
  else
    cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_btst_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7)))
    cpu.ccr = (cpu.ccr & (~F_Z)) & 0xff;
  else
    cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bor_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7)))
    cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bior_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(!(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7))))
    cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bxor_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7)))
    cpu.ccr = (cpu.ccr ^ (F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bixor_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(!(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7))))
    cpu.ccr = (cpu.ccr ^ (F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_band_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(!(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7))))
    cpu.ccr = (cpu.ccr & (~F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_biand_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7)))
    cpu.ccr = (cpu.ccr & (~F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bld_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7)))
    cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
  else
    cpu.ccr = (cpu.ccr & (~F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bild_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(!(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7))))
    cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
  else
    cpu.ccr = (cpu.ccr & (~F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bset_r8h_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.tmp1 = (cpu.tmp1 | (1 << ((cpu.r8r(cpu.ir[1] >> 4)) & 7))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bnot_r8h_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.tmp1 = (cpu.tmp1 ^ (1 << ((cpu.r8r(cpu.ir[1] >> 4)) & 7))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bclr_r8h_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.tmp1 = (cpu.tmp1 & (~(1 << ((cpu.r8r(cpu.ir[1] >> 4)) & 7)))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bst_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.ccr & F_C)
    cpu.tmp1 = (cpu.tmp1 | (1 << ((cpu.ir[1] >> 4) & 7))) >>> 0;
  else
    cpu.tmp1 = (cpu.tmp1 & (~(1 << ((cpu.ir[1] >> 4) & 7)))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bist_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(!(cpu.ccr & F_C))
    cpu.tmp1 = (cpu.tmp1 | (1 << ((cpu.ir[1] >> 4) & 7))) >>> 0;
  else
    cpu.tmp1 = (cpu.tmp1 & (~(1 << ((cpu.ir[1] >> 4) & 7)))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bset_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.tmp1 = (cpu.tmp1 | (1 << ((cpu.ir[1] >> 4) & 7))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bnot_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.tmp1 = (cpu.tmp1 ^ (1 << ((cpu.ir[1] >> 4) & 7))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bclr_imm3_r32ihh(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (cpu.r32r(cpu.ir[0] >> 4)) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.tmp1 = (cpu.tmp1 & (~(1 << ((cpu.ir[1] >> 4) & 7)))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_btst_r8h_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.r8r(cpu.ir[1] >> 4)) & 7)))
    cpu.ccr = (cpu.ccr & (~F_Z)) & 0xff;
  else
    cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_btst_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7)))
    cpu.ccr = (cpu.ccr & (~F_Z)) & 0xff;
  else
    cpu.ccr = (cpu.ccr | (F_Z)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bor_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7)))
    cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bior_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(!(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7))))
    cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bxor_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7)))
    cpu.ccr = (cpu.ccr ^ (F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bixor_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(!(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7))))
    cpu.ccr = (cpu.ccr ^ (F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_band_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(!(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7))))
    cpu.ccr = (cpu.ccr & (~F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_biand_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7)))
    cpu.ccr = (cpu.ccr & (~F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bld_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7)))
    cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
  else
    cpu.ccr = (cpu.ccr & (~F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bild_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  if(!(cpu.tmp1 & (1 << ((cpu.ir[1] >> 4) & 7))))
    cpu.ccr = (cpu.ccr | (F_C)) & 0xff;
  else
    cpu.ccr = (cpu.ccr & (~F_C)) & 0xff;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_bset_r8h_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.tmp1 = (cpu.tmp1 | (1 << ((cpu.r8r(cpu.ir[1] >> 4)) & 7))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bnot_r8h_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.tmp1 = (cpu.tmp1 ^ (1 << ((cpu.r8r(cpu.ir[1] >> 4)) & 7))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bclr_r8h_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.tmp1 = (cpu.tmp1 & (~(1 << ((cpu.r8r(cpu.ir[1] >> 4)) & 7)))) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bst_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  if(cpu.ccr & F_C)
    cpu.tmp1 = (cpu.tmp1 | (1 << ((cpu.ir[1] >> 4) & 7))) >>> 0;
  else
    cpu.tmp1 = (cpu.tmp1 & (~(1 << ((cpu.ir[1] >> 4) & 7)))) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bist_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  if(!(cpu.ccr & F_C))
    cpu.tmp1 = (cpu.tmp1 | (1 << ((cpu.ir[1] >> 4) & 7))) >>> 0;
  else
    cpu.tmp1 = (cpu.tmp1 & (~(1 << ((cpu.ir[1] >> 4) & 7)))) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bset_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.tmp1 | (1 << ((cpu.ir[1] >> 4) & 7))) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bnot_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.tmp1 ^ (1 << ((cpu.ir[1] >> 4) & 7))) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_bclr_imm3_abs8(cpu: H8): void {
  cpu.ir[1] = cpu.read16i(cpu.pc);
  cpu.pc = (cpu.pc + 2) >>> 0;
  cpu.tmp2 = (0xffffff00 | cpu.ir[0]) >>> 0;
  cpu.tmp1 = (cpu.read8(cpu.tmp2)) >>> 0;
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.tmp1 = (cpu.tmp1 & (~(1 << ((cpu.ir[1] >> 4) & 7)))) >>> 0;
  cpu.write8(cpu.tmp2, cpu.tmp1);
  cpu.prefetchDone();
}

function op_add_b_imm8_r8u(cpu: H8): void {
  cpu.r8w(cpu.ir[0] >> 8, doAdd8(cpu, cpu.r8r(cpu.ir[0] >> 8), cpu.ir[0]));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_addx_b_imm8_r8u(cpu: H8): void {
  cpu.r8w(cpu.ir[0] >> 8, doAddx8(cpu, cpu.r8r(cpu.ir[0] >> 8), cpu.ir[0]));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_cmp_b_imm8_r8u(cpu: H8): void {
  doSub8(cpu, cpu.r8r(cpu.ir[0] >> 8), cpu.ir[0]);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_subx_b_imm8_r8u(cpu: H8): void {
  cpu.r8w(cpu.ir[0] >> 8, doSubx8(cpu, cpu.r8r(cpu.ir[0] >> 8), cpu.ir[0]));
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_or_b_imm8_r8u(cpu: H8): void {
  cpu.tmp1 = (cpu.ir[0] | cpu.r8r(cpu.ir[0] >> 8)) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0] >> 8, cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_xor_b_imm8_r8u(cpu: H8): void {
  cpu.tmp1 = (cpu.ir[0] ^ cpu.r8r(cpu.ir[0] >> 8)) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0] >> 8, cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_and_b_imm8_r8u(cpu: H8): void {
  cpu.tmp1 = (cpu.ir[0] & cpu.r8r(cpu.ir[0] >> 8)) >>> 0;
  setNzv8(cpu, cpu.tmp1);
  cpu.r8w(cpu.ir[0] >> 8, cpu.tmp1);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

function op_mov_b_imm8_r8u(cpu: H8): void {
  setNzv8(cpu, cpu.ir[0]);
  cpu.r8w(cpu.ir[0] >> 8, cpu.ir[0]);
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDone();
}

export function stateReset(cpu: H8): void {
  cpu.ccr = (cpu.ccr | ((HAS_HC ? F_I : F_H))) & 0xff;
  cpu.exr = (EXR_I | EXR_NC) & 0xff;
  if(cpu.modeAdvanced) {
    cpu.ir[0] = (cpu.read16i(0)) & 0xffff;
    cpu.ir[1] = (cpu.read16i(2)) & 0xffff;
    cpu.pc = ((cpu.ir[0] << 16) | cpu.ir[1]) >>> 0;
  } else {
    cpu.pc = (cpu.read16i(0)) >>> 0;
  }
  cpu.updateIrqFilter();
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDoneNoirq();
}

export function stateIrq(cpu: H8): void {
  cpu.internal(1);
  cpu.tmp1 = (cpu.r32r(7) - 2) >>> 0;
  cpu.r32w(7, cpu.tmp1);
  cpu.write16(cpu.tmp1, cpu.npc);
  cpu.tmp1 = (cpu.r32r(7) - 2) >>> 0;
  cpu.r32w(7, cpu.tmp1);
  cpu.write16(cpu.tmp1, (cpu.ccr << 8) | ((cpu.npc >> 16) & 0xff));
  if(false) {
    cpu.tmp1 = (cpu.r32r(7) - 2) >>> 0;
    cpu.r32w(7, cpu.tmp1);
    cpu.write16(cpu.tmp1, cpu.exr << 8);
  }
  cpu.exceptionHook(cpu.takenIrqVector);
  if(cpu.modeAdvanced) {
    cpu.ir[0] = (cpu.read16i(4*cpu.takenIrqVector)) & 0xffff;
    cpu.ir[1] = (cpu.read16i(4*cpu.takenIrqVector+2)) & 0xffff;
    cpu.pc = ((cpu.ir[0] << 16) | cpu.ir[1]) >>> 0;
  } else {
    cpu.pc = (cpu.read16i(2*cpu.takenIrqVector)) >>> 0;
  }
  cpu.internal(1);
  cpu.irqSetup();
  cpu.updateIrqFilter();
  cpu.interruptTaken();
  cpu.npc = (cpu.pc & 0xffffff) >>> 0;
  cpu.pir = (cpu.read16i(cpu.pc)) & 0xffff;
  cpu.pc = (cpu.pc + (2)) >>> 0;
  cpu.prefetchDoneNoirq();
}

export interface Encoding {
  slot: number;
  val: number;
  mask: number;
  val0: number;
  mask0: number;
  run: (cpu: H8) => void;
  name: string;
}

export const ENCODINGS: readonly Encoding[] = [
  { slot: 0, val: 0x0, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_nop, name: 'nop - -' },
  { slot: 1, val: 0x1006900, mask: 0xffffff88, val0: 0x0, mask0: 0x0, run: op_mov_l_r32ih_r32l, name: 'mov.l r32ih r32l' },
  { slot: 1, val: 0x1006980, mask: 0xffffff88, val0: 0x0, mask0: 0x0, run: op_mov_l_r32l_r32ih, name: 'mov.l r32l r32ih' },
  { slot: 1, val: 0x1006b00, mask: 0xfffffff8, val0: 0x0, mask0: 0x0, run: op_mov_l_abs16_r32l, name: 'mov.l abs16 r32l' },
  { slot: 1, val: 0x1006b20, mask: 0xfffffff8, val0: 0x0, mask0: 0x0, run: op_mov_l_abs32_r32l, name: 'mov.l abs32 r32l' },
  { slot: 1, val: 0x1006b80, mask: 0xfffffff8, val0: 0x0, mask0: 0x0, run: op_mov_l_r32l_abs16, name: 'mov.l r32l abs16' },
  { slot: 1, val: 0x1006ba0, mask: 0xfffffff8, val0: 0x0, mask0: 0x0, run: op_mov_l_r32l_abs32, name: 'mov.l r32l abs32' },
  { slot: 1, val: 0x1006d00, mask: 0xffffff88, val0: 0x0, mask0: 0x0, run: op_mov_l_r32ph_r32l, name: 'mov.l r32ph r32l' },
  { slot: 1, val: 0x1006d80, mask: 0xffffff88, val0: 0x0, mask0: 0x0, run: op_mov_l_r32l_pr32h, name: 'mov.l r32l pr32h' },
  { slot: 1, val: 0x1006f00, mask: 0xffffff88, val0: 0x0, mask0: 0x0, run: op_mov_l_r32d16h_r32l, name: 'mov.l r32d16h r32l' },
  { slot: 1, val: 0x1006f80, mask: 0xffffff88, val0: 0x0, mask0: 0x0, run: op_mov_l_r32l_r32d16h, name: 'mov.l r32l r32d16h' },
  { slot: 4, val: 0x78006b20, mask: 0xff0ffff8, val0: 0x100, mask0: 0xffff, run: op_mov_l_r32d32hh_r32l, name: 'mov.l r32d32hh r32l' },
  { slot: 4, val: 0x78006ba0, mask: 0xff0ffff8, val0: 0x100, mask0: 0xffff, run: op_mov_l_r32l_r32d32hh, name: 'mov.l r32l r32d32hh' },
  { slot: 1, val: 0x1406900, mask: 0xffffff8f, val0: 0x0, mask0: 0x0, run: op_ldc_w_r32ih_ccr, name: 'ldc.w r32ih ccr' },
  { slot: 1, val: 0x1406980, mask: 0xffffff8f, val0: 0x0, mask0: 0x0, run: op_stc_w_ccr_r32ih, name: 'stc.w ccr r32ih' },
  { slot: 1, val: 0x1406b00, mask: 0xffffffff, val0: 0x0, mask0: 0x0, run: op_ldc_w_abs16_ccr, name: 'ldc.w abs16 ccr' },
  { slot: 1, val: 0x1406b20, mask: 0xffffffff, val0: 0x0, mask0: 0x0, run: op_ldc_w_abs32_ccr, name: 'ldc.w abs32 ccr' },
  { slot: 1, val: 0x1406b80, mask: 0xffffffff, val0: 0x0, mask0: 0x0, run: op_stc_w_ccr_abs16, name: 'stc.w ccr abs16' },
  { slot: 1, val: 0x1406ba0, mask: 0xffffffff, val0: 0x0, mask0: 0x0, run: op_stc_w_ccr_abs32, name: 'stc.w ccr abs32' },
  { slot: 1, val: 0x1406d00, mask: 0xffffff8f, val0: 0x0, mask0: 0x0, run: op_ldc_w_r32ph_ccr, name: 'ldc.w r32ph ccr' },
  { slot: 1, val: 0x1406d80, mask: 0xffffff8f, val0: 0x0, mask0: 0x0, run: op_stc_w_ccr_pr32h, name: 'stc.w ccr pr32h' },
  { slot: 1, val: 0x1406f00, mask: 0xffffff8f, val0: 0x0, mask0: 0x0, run: op_ldc_w_r32d16h_ccr, name: 'ldc.w r32d16h ccr' },
  { slot: 1, val: 0x1406f80, mask: 0xffffff8f, val0: 0x0, mask0: 0x0, run: op_stc_w_ccr_r32d16h, name: 'stc.w ccr r32d16h' },
  { slot: 4, val: 0x78006b20, mask: 0xff8fffff, val0: 0x140, mask0: 0xffff, run: op_ldc_w_r32d32hh_ccr, name: 'ldc.w r32d32hh ccr' },
  { slot: 4, val: 0x78806ba0, mask: 0xff8fffff, val0: 0x140, mask0: 0xffff, run: op_stc_w_ccr_r32d32hh, name: 'stc.w ccr r32d32hh' },
  { slot: 0, val: 0x180, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_sleep, name: 'sleep - -' },
  { slot: 1, val: 0x1c05000, mask: 0xffffff00, val0: 0x0, mask0: 0x0, run: op_mulxs_b_r8h_r16l, name: 'mulxs.b r8h r16l' },
  { slot: 1, val: 0x1c05200, mask: 0xffffff08, val0: 0x0, mask0: 0x0, run: op_mulxs_w_r16h_r32l, name: 'mulxs.w r16h r32l' },
  { slot: 1, val: 0x1d05100, mask: 0xffffff00, val0: 0x0, mask0: 0x0, run: op_divxs_b_r8h_r16l, name: 'divxs.b r8h r16l' },
  { slot: 1, val: 0x1d05300, mask: 0xffffff08, val0: 0x0, mask0: 0x0, run: op_divxs_w_r16h_r32l, name: 'divxs.w r16h r32l' },
  { slot: 1, val: 0x1f06400, mask: 0xffffff88, val0: 0x0, mask0: 0x0, run: op_or_l_r32h_r32l, name: 'or.l r32h r32l' },
  { slot: 1, val: 0x1f06500, mask: 0xffffff88, val0: 0x0, mask0: 0x0, run: op_xor_l_r32h_r32l, name: 'xor.l r32h r32l' },
  { slot: 1, val: 0x1f06600, mask: 0xffffff88, val0: 0x0, mask0: 0x0, run: op_and_l_r32h_r32l, name: 'and.l r32h r32l' },
  { slot: 0, val: 0x200, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_stc_ccr_r8l, name: 'stc ccr r8l' },
  { slot: 0, val: 0x300, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_ldc_r8l_ccr, name: 'ldc r8l ccr' },
  { slot: 0, val: 0x400, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_orc_imm8_ccr, name: 'orc imm8 ccr' },
  { slot: 0, val: 0x500, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_xorc_imm8_ccr, name: 'xorc imm8 ccr' },
  { slot: 0, val: 0x600, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_andc_imm8_ccr, name: 'andc imm8 ccr' },
  { slot: 0, val: 0x700, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_ldc_imm8_ccr, name: 'ldc imm8 ccr' },
  { slot: 0, val: 0x800, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_add_b_r8h_r8l, name: 'add.b r8h r8l' },
  { slot: 0, val: 0x900, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_add_w_r16h_r16l, name: 'add.w r16h r16l' },
  { slot: 0, val: 0xa00, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_inc_b_one_r8l, name: 'inc.b one r8l' },
  { slot: 0, val: 0xa80, mask: 0xff88, val0: 0x0, mask0: 0x0, run: op_add_l_r32h_r32l, name: 'add.l r32h r32l' },
  { slot: 0, val: 0xb00, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_adds_l_one_r32l, name: 'adds.l one r32l' },
  { slot: 0, val: 0xb50, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_inc_w_one_r16l, name: 'inc.w one r16l' },
  { slot: 0, val: 0xb70, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_inc_l_one_r32l, name: 'inc.l one r32l' },
  { slot: 0, val: 0xb80, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_adds_l_two_r32l, name: 'adds.l two r32l' },
  { slot: 0, val: 0xb90, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_adds_l_four_r32l, name: 'adds.l four r32l' },
  { slot: 0, val: 0xbd0, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_inc_w_two_r16l, name: 'inc.w two r16l' },
  { slot: 0, val: 0xbf0, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_inc_l_two_r32l, name: 'inc.l two r32l' },
  { slot: 0, val: 0xc00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_mov_b_r8h_r8l, name: 'mov.b r8h r8l' },
  { slot: 0, val: 0xd00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_mov_w_r16h_r16l, name: 'mov.w r16h r16l' },
  { slot: 0, val: 0xe00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_addx_b_r8h_r8l, name: 'addx.b r8h r8l' },
  { slot: 0, val: 0xf00, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_daa_b_r8l, name: 'daa.b r8l -' },
  { slot: 0, val: 0xf80, mask: 0xff88, val0: 0x0, mask0: 0x0, run: op_mov_l_r32h_r32l, name: 'mov.l r32h r32l' },
  { slot: 0, val: 0x1000, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_shll_b_r8l, name: 'shll.b r8l -' },
  { slot: 0, val: 0x1010, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_shll_w_r16l, name: 'shll.w r16l -' },
  { slot: 0, val: 0x1030, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_shll_l_r32l, name: 'shll.l r32l -' },
  { slot: 0, val: 0x1080, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_shal_b_r8l, name: 'shal.b r8l -' },
  { slot: 0, val: 0x1090, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_shal_w_r16l, name: 'shal.w r16l -' },
  { slot: 0, val: 0x10b0, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_shal_l_r32l, name: 'shal.l r32l -' },
  { slot: 0, val: 0x1100, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_shlr_b_r8l, name: 'shlr.b r8l -' },
  { slot: 0, val: 0x1110, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_shlr_w_r16l, name: 'shlr.w r16l -' },
  { slot: 0, val: 0x1130, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_shlr_l_r32l, name: 'shlr.l r32l -' },
  { slot: 0, val: 0x1180, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_shar_b_r8l, name: 'shar.b r8l -' },
  { slot: 0, val: 0x1190, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_shar_w_r16l, name: 'shar.w r16l -' },
  { slot: 0, val: 0x11b0, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_shar_l_r32l, name: 'shar.l r32l -' },
  { slot: 0, val: 0x1200, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_rotxl_b_r8l, name: 'rotxl.b r8l -' },
  { slot: 0, val: 0x1210, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_rotxl_w_r16l, name: 'rotxl.w r16l -' },
  { slot: 0, val: 0x1230, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_rotxl_l_r32l, name: 'rotxl.l r32l -' },
  { slot: 0, val: 0x1280, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_rotl_b_r8l, name: 'rotl.b r8l -' },
  { slot: 0, val: 0x1290, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_rotl_w_r16l, name: 'rotl.w r16l -' },
  { slot: 0, val: 0x12b0, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_rotl_l_r32l, name: 'rotl.l r32l -' },
  { slot: 0, val: 0x1300, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_rotxr_b_r8l, name: 'rotxr.b r8l -' },
  { slot: 0, val: 0x1310, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_rotxr_w_r16l, name: 'rotxr.w r16l -' },
  { slot: 0, val: 0x1330, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_rotxr_l_r32l, name: 'rotxr.l r32l -' },
  { slot: 0, val: 0x1380, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_rotr_b_r8l, name: 'rotr.b r8l -' },
  { slot: 0, val: 0x1390, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_rotr_w_r16l, name: 'rotr.w r16l -' },
  { slot: 0, val: 0x13b0, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_rotr_l_r32l, name: 'rotr.l r32l -' },
  { slot: 0, val: 0x1400, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_or_b_r8h_r8l, name: 'or.b r8h r8l' },
  { slot: 0, val: 0x1500, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_xor_b_r8h_r8l, name: 'xor.b r8h r8l' },
  { slot: 0, val: 0x1600, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_and_b_r8h_r8l, name: 'and.b r8h r8l' },
  { slot: 0, val: 0x1700, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_not_b_r8l, name: 'not.b r8l -' },
  { slot: 0, val: 0x1710, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_not_w_r16l, name: 'not.w r16l -' },
  { slot: 0, val: 0x1730, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_not_l_r32l, name: 'not.l r32l -' },
  { slot: 0, val: 0x1750, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_extu_w_r16l, name: 'extu.w r16l -' },
  { slot: 0, val: 0x1770, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_extu_l_r32l, name: 'extu.l r32l -' },
  { slot: 0, val: 0x1780, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_neg_b_r8l, name: 'neg.b r8l -' },
  { slot: 0, val: 0x1790, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_neg_w_r16l, name: 'neg.w r16l -' },
  { slot: 0, val: 0x17b0, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_neg_l_r32l, name: 'neg.l r32l -' },
  { slot: 0, val: 0x17d0, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_exts_w_r16l, name: 'exts.w r16l -' },
  { slot: 0, val: 0x17f0, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_exts_l_r32l, name: 'exts.l r32l -' },
  { slot: 0, val: 0x1800, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_sub_b_r8h_r8l, name: 'sub.b r8h r8l' },
  { slot: 0, val: 0x1900, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_sub_w_r16h_r16l, name: 'sub.w r16h r16l' },
  { slot: 0, val: 0x1a00, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_dec_b_one_r8l, name: 'dec.b one r8l' },
  { slot: 0, val: 0x1a80, mask: 0xff88, val0: 0x0, mask0: 0x0, run: op_sub_l_r32h_r32l, name: 'sub.l r32h r32l' },
  { slot: 0, val: 0x1b00, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_subs_l_one_r32l, name: 'subs.l one r32l' },
  { slot: 0, val: 0x1b50, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_dec_w_one_r16l, name: 'dec.w one r16l' },
  { slot: 0, val: 0x1b70, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_dec_l_one_r32l, name: 'dec.l one r32l' },
  { slot: 0, val: 0x1b80, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_subs_l_two_r32l, name: 'subs.l two r32l' },
  { slot: 0, val: 0x1b90, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_subs_l_four_r32l, name: 'subs.l four r32l' },
  { slot: 0, val: 0x1bd0, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_dec_w_two_r16l, name: 'dec.w two r16l' },
  { slot: 0, val: 0x1bf0, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_dec_l_two_r32l, name: 'dec.l two r32l' },
  { slot: 0, val: 0x1c00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_cmp_b_r8h_r8l, name: 'cmp.b r8h r8l' },
  { slot: 0, val: 0x1d00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_cmp_w_r16h_r16l, name: 'cmp.w r16h r16l' },
  { slot: 0, val: 0x1e00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_subx_b_r8h_r8l, name: 'subx.b r8h r8l' },
  { slot: 0, val: 0x1f00, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_das_b_r8l, name: 'das.b r8l -' },
  { slot: 0, val: 0x1f80, mask: 0xff88, val0: 0x0, mask0: 0x0, run: op_cmp_l_r32h_r32l, name: 'cmp.l r32h r32l' },
  { slot: 0, val: 0x2000, mask: 0xf000, val0: 0x0, mask0: 0x0, run: op_mov_b_abs8_r8u, name: 'mov.b abs8 r8u' },
  { slot: 0, val: 0x3000, mask: 0xf000, val0: 0x0, mask0: 0x0, run: op_mov_b_r8u_abs8, name: 'mov.b r8u abs8' },
  { slot: 0, val: 0x4000, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bt_rel8, name: 'bt rel8 -' },
  { slot: 0, val: 0x4100, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bf_rel8, name: 'bf rel8 -' },
  { slot: 0, val: 0x4200, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bhi_rel8, name: 'bhi rel8 -' },
  { slot: 0, val: 0x4300, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bls_rel8, name: 'bls rel8 -' },
  { slot: 0, val: 0x4400, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bcc_rel8, name: 'bcc rel8 -' },
  { slot: 0, val: 0x4500, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bcs_rel8, name: 'bcs rel8 -' },
  { slot: 0, val: 0x4600, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bne_rel8, name: 'bne rel8 -' },
  { slot: 0, val: 0x4700, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_beq_rel8, name: 'beq rel8 -' },
  { slot: 0, val: 0x4800, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bvc_rel8, name: 'bvc rel8 -' },
  { slot: 0, val: 0x4900, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bvs_rel8, name: 'bvs rel8 -' },
  { slot: 0, val: 0x4a00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bpl_rel8, name: 'bpl rel8 -' },
  { slot: 0, val: 0x4b00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bmi_rel8, name: 'bmi rel8 -' },
  { slot: 0, val: 0x4c00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bge_rel8, name: 'bge rel8 -' },
  { slot: 0, val: 0x4d00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_blt_rel8, name: 'blt rel8 -' },
  { slot: 0, val: 0x4e00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bgt_rel8, name: 'bgt rel8 -' },
  { slot: 0, val: 0x4f00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_ble_rel8, name: 'ble rel8 -' },
  { slot: 0, val: 0x5000, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_mulxu_b_r8h_r16l, name: 'mulxu.b r8h r16l' },
  { slot: 0, val: 0x5100, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_divxu_b_r8h_r16l, name: 'divxu.b r8h r16l' },
  { slot: 0, val: 0x5200, mask: 0xff08, val0: 0x0, mask0: 0x0, run: op_mulxu_w_r16h_r32l, name: 'mulxu.w r16h r32l' },
  { slot: 0, val: 0x5300, mask: 0xff08, val0: 0x0, mask0: 0x0, run: op_divxu_w_r16h_r32l, name: 'divxu.w r16h r32l' },
  { slot: 0, val: 0x5470, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_rts, name: 'rts - -' },
  { slot: 0, val: 0x5500, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bsr_rel8, name: 'bsr rel8 -' },
  { slot: 0, val: 0x5670, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_rte, name: 'rte - -' },
  { slot: 0, val: 0x5700, mask: 0xffcf, val0: 0x0, mask0: 0x0, run: op_trapa_imm2, name: 'trapa imm2 -' },
  { slot: 0, val: 0x5800, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bt_rel16, name: 'bt rel16 -' },
  { slot: 0, val: 0x5810, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bf_rel16, name: 'bf rel16 -' },
  { slot: 0, val: 0x5820, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bhi_rel16, name: 'bhi rel16 -' },
  { slot: 0, val: 0x5830, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bls_rel16, name: 'bls rel16 -' },
  { slot: 0, val: 0x5840, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bcc_rel16, name: 'bcc rel16 -' },
  { slot: 0, val: 0x5850, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bcs_rel16, name: 'bcs rel16 -' },
  { slot: 0, val: 0x5860, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bne_rel16, name: 'bne rel16 -' },
  { slot: 0, val: 0x5870, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_beq_rel16, name: 'beq rel16 -' },
  { slot: 0, val: 0x5880, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bvc_rel16, name: 'bvc rel16 -' },
  { slot: 0, val: 0x5890, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bvs_rel16, name: 'bvs rel16 -' },
  { slot: 0, val: 0x58a0, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bpl_rel16, name: 'bpl rel16 -' },
  { slot: 0, val: 0x58b0, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bmi_rel16, name: 'bmi rel16 -' },
  { slot: 0, val: 0x58c0, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bge_rel16, name: 'bge rel16 -' },
  { slot: 0, val: 0x58d0, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_blt_rel16, name: 'blt rel16 -' },
  { slot: 0, val: 0x58e0, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bgt_rel16, name: 'bgt rel16 -' },
  { slot: 0, val: 0x58f0, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_ble_rel16, name: 'ble rel16 -' },
  { slot: 0, val: 0x5900, mask: 0xff8f, val0: 0x0, mask0: 0x0, run: op_jmp_r32h, name: 'jmp r32h -' },
  { slot: 0, val: 0x5a00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_jmp_abs24e, name: 'jmp abs24e -' },
  { slot: 0, val: 0x5b00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_jmp_abs8i, name: 'jmp abs8i -' },
  { slot: 0, val: 0x5c00, mask: 0xffff, val0: 0x0, mask0: 0x0, run: op_bsr_rel16, name: 'bsr rel16 -' },
  { slot: 0, val: 0x5d00, mask: 0xff8f, val0: 0x0, mask0: 0x0, run: op_jsr_r32h, name: 'jsr r32h -' },
  { slot: 0, val: 0x5e00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_jsr_abs24e, name: 'jsr abs24e -' },
  { slot: 0, val: 0x5f00, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_jsr_abs8i, name: 'jsr abs8i -' },
  { slot: 0, val: 0x6000, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bset_r8h_r8l, name: 'bset r8h r8l' },
  { slot: 0, val: 0x6100, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bnot_r8h_r8l, name: 'bnot r8h r8l' },
  { slot: 0, val: 0x6200, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_bclr_r8h_r8l, name: 'bclr r8h r8l' },
  { slot: 0, val: 0x6300, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_btst_r8h_r8l, name: 'btst r8h r8l' },
  { slot: 0, val: 0x6400, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_or_w_r16h_r16l, name: 'or.w r16h r16l' },
  { slot: 0, val: 0x6500, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_xor_w_r16h_r16l, name: 'xor.w r16h r16l' },
  { slot: 0, val: 0x6600, mask: 0xff00, val0: 0x0, mask0: 0x0, run: op_and_w_r16h_r16l, name: 'and.w r16h r16l' },
  { slot: 0, val: 0x6700, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_bst_imm3_r8l, name: 'bst imm3 r8l' },
  { slot: 0, val: 0x6780, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_bist_imm3_r8l, name: 'bist imm3 r8l' },
  { slot: 0, val: 0x6800, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_mov_b_r32ih_r8l, name: 'mov.b r32ih r8l' },
  { slot: 0, val: 0x6880, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_mov_b_r8l_r32ih, name: 'mov.b r8l r32ih' },
  { slot: 0, val: 0x6900, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_mov_w_r32ih_r16l, name: 'mov.w r32ih r16l' },
  { slot: 0, val: 0x6980, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_mov_w_r16l_r32ih, name: 'mov.w r16l r32ih' },
  { slot: 0, val: 0x6a00, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_mov_b_abs16_r8l, name: 'mov.b abs16 r8l' },
  { slot: 0, val: 0x6a20, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_mov_b_abs32_r8l, name: 'mov.b abs32 r8l' },
  { slot: 0, val: 0x6a40, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_movfpe_abs16_r8l, name: 'movfpe abs16 r8l' },
  { slot: 0, val: 0x6a80, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_mov_b_r8l_abs16, name: 'mov.b r8l abs16' },
  { slot: 0, val: 0x6aa0, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_mov_b_r8l_abs32, name: 'mov.b r8l abs32' },
  { slot: 0, val: 0x6ac0, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_movtpe_r8l_abs16, name: 'movtpe r8l abs16' },
  { slot: 0, val: 0x6b00, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_mov_w_abs16_r16l, name: 'mov.w abs16 r16l' },
  { slot: 0, val: 0x6b20, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_mov_w_abs32_r16l, name: 'mov.w abs32 r16l' },
  { slot: 0, val: 0x6b80, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_mov_w_r16l_abs16, name: 'mov.w r16l abs16' },
  { slot: 0, val: 0x6ba0, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_mov_w_r16l_abs32, name: 'mov.w r16l abs32' },
  { slot: 0, val: 0x6c00, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_mov_b_r32ph_r8l, name: 'mov.b r32ph r8l' },
  { slot: 0, val: 0x6c80, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_mov_b_r8l_pr32h, name: 'mov.b r8l pr32h' },
  { slot: 0, val: 0x6d00, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_mov_w_r32ph_r16l, name: 'mov.w r32ph r16l' },
  { slot: 0, val: 0x6d80, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_mov_w_r16l_pr32h, name: 'mov.w r16l pr32h' },
  { slot: 0, val: 0x6e00, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_mov_b_r32d16h_r8l, name: 'mov.b r32d16h r8l' },
  { slot: 0, val: 0x6e80, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_mov_b_r8l_r32d16h, name: 'mov.b r8l r32d16h' },
  { slot: 0, val: 0x6f00, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_mov_w_r32d16h_r16l, name: 'mov.w r32d16h r16l' },
  { slot: 0, val: 0x6f80, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_mov_w_r16l_r32d16h, name: 'mov.w r16l r32d16h' },
  { slot: 0, val: 0x7000, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_bset_imm3_r8l, name: 'bset imm3 r8l' },
  { slot: 0, val: 0x7100, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_bnot_imm3_r8l, name: 'bnot imm3 r8l' },
  { slot: 0, val: 0x7200, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_bclr_imm3_r8l, name: 'bclr imm3 r8l' },
  { slot: 0, val: 0x7300, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_btst_imm3_r8l, name: 'btst imm3 r8l' },
  { slot: 0, val: 0x7400, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_bor_imm3_r8l, name: 'bor imm3 r8l' },
  { slot: 0, val: 0x7480, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_bior_imm3_r8l, name: 'bior imm3 r8l' },
  { slot: 0, val: 0x7500, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_bxor_imm3_r8l, name: 'bxor imm3 r8l' },
  { slot: 0, val: 0x7580, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_bixor_imm3_r8l, name: 'bixor imm3 r8l' },
  { slot: 0, val: 0x7600, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_band_imm3_r8l, name: 'band imm3 r8l' },
  { slot: 0, val: 0x7680, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_biand_imm3_r8l, name: 'biand imm3 r8l' },
  { slot: 0, val: 0x7700, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_bld_imm3_r8l, name: 'bld imm3 r8l' },
  { slot: 0, val: 0x7780, mask: 0xff80, val0: 0x0, mask0: 0x0, run: op_bild_imm3_r8l, name: 'bild imm3 r8l' },
  { slot: 1, val: 0x78006a20, mask: 0xff8ffff0, val0: 0x0, mask0: 0x0, run: op_mov_b_r32d32hh_r8l, name: 'mov.b r32d32hh r8l' },
  { slot: 1, val: 0x78006aa0, mask: 0xff8ffff0, val0: 0x0, mask0: 0x0, run: op_mov_b_r8l_r32d32hh, name: 'mov.b r8l r32d32hh' },
  { slot: 1, val: 0x78006b20, mask: 0xff8ffff0, val0: 0x0, mask0: 0x0, run: op_mov_w_r32d32hh_r16l, name: 'mov.w r32d32hh r16l' },
  { slot: 1, val: 0x78006ba0, mask: 0xff8ffff0, val0: 0x0, mask0: 0x0, run: op_mov_w_r16l_r32d32hh, name: 'mov.w r16l r32d32hh' },
  { slot: 0, val: 0x7900, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_mov_w_imm16_r16l, name: 'mov.w imm16 r16l' },
  { slot: 0, val: 0x7910, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_add_w_imm16_r16l, name: 'add.w imm16 r16l' },
  { slot: 0, val: 0x7920, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_cmp_w_imm16_r16l, name: 'cmp.w imm16 r16l' },
  { slot: 0, val: 0x7930, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_sub_w_imm16_r16l, name: 'sub.w imm16 r16l' },
  { slot: 0, val: 0x7940, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_or_w_imm16_r16l, name: 'or.w imm16 r16l' },
  { slot: 0, val: 0x7950, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_xor_w_imm16_r16l, name: 'xor.w imm16 r16l' },
  { slot: 0, val: 0x7960, mask: 0xfff0, val0: 0x0, mask0: 0x0, run: op_and_w_imm16_r16l, name: 'and.w imm16 r16l' },
  { slot: 0, val: 0x7a00, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_mov_l_imm32_r32l, name: 'mov.l imm32 r32l' },
  { slot: 0, val: 0x7a10, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_add_l_imm32_r32l, name: 'add.l imm32 r32l' },
  { slot: 0, val: 0x7a20, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_cmp_l_imm32_r32l, name: 'cmp.l imm32 r32l' },
  { slot: 0, val: 0x7a30, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_sub_l_imm32_r32l, name: 'sub.l imm32 r32l' },
  { slot: 0, val: 0x7a40, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_or_l_imm32_r32l, name: 'or.l imm32 r32l' },
  { slot: 0, val: 0x7a50, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_xor_l_imm32_r32l, name: 'xor.l imm32 r32l' },
  { slot: 0, val: 0x7a60, mask: 0xfff8, val0: 0x0, mask0: 0x0, run: op_and_l_imm32_r32l, name: 'and.l imm32 r32l' },
  { slot: 1, val: 0x7b5c598f, mask: 0xffffffff, val0: 0x0, mask0: 0x0, run: op_eepmov_b, name: 'eepmov.b - -' },
  { slot: 1, val: 0x7bd4598f, mask: 0xffffffff, val0: 0x0, mask0: 0x0, run: op_eepmov_w, name: 'eepmov.w - -' },
  { slot: 1, val: 0x7c006300, mask: 0xff8fff0f, val0: 0x0, mask0: 0x0, run: op_btst_r8h_r32ihh, name: 'btst r8h r32ihh' },
  { slot: 1, val: 0x7c007300, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_btst_imm3_r32ihh, name: 'btst imm3 r32ihh' },
  { slot: 1, val: 0x7c007400, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_bor_imm3_r32ihh, name: 'bor imm3 r32ihh' },
  { slot: 1, val: 0x7c007480, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_bior_imm3_r32ihh, name: 'bior imm3 r32ihh' },
  { slot: 1, val: 0x7c007500, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_bxor_imm3_r32ihh, name: 'bxor imm3 r32ihh' },
  { slot: 1, val: 0x7c007580, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_bixor_imm3_r32ihh, name: 'bixor imm3 r32ihh' },
  { slot: 1, val: 0x7c007600, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_band_imm3_r32ihh, name: 'band imm3 r32ihh' },
  { slot: 1, val: 0x7c007680, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_biand_imm3_r32ihh, name: 'biand imm3 r32ihh' },
  { slot: 1, val: 0x7c007700, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_bld_imm3_r32ihh, name: 'bld imm3 r32ihh' },
  { slot: 1, val: 0x7c007780, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_bild_imm3_r32ihh, name: 'bild imm3 r32ihh' },
  { slot: 1, val: 0x7d006000, mask: 0xff8fff0f, val0: 0x0, mask0: 0x0, run: op_bset_r8h_r32ihh, name: 'bset r8h r32ihh' },
  { slot: 1, val: 0x7d006100, mask: 0xff8fff0f, val0: 0x0, mask0: 0x0, run: op_bnot_r8h_r32ihh, name: 'bnot r8h r32ihh' },
  { slot: 1, val: 0x7d006200, mask: 0xff8fff0f, val0: 0x0, mask0: 0x0, run: op_bclr_r8h_r32ihh, name: 'bclr r8h r32ihh' },
  { slot: 1, val: 0x7d006700, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_bst_imm3_r32ihh, name: 'bst imm3 r32ihh' },
  { slot: 1, val: 0x7d006780, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_bist_imm3_r32ihh, name: 'bist imm3 r32ihh' },
  { slot: 1, val: 0x7d007000, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_bset_imm3_r32ihh, name: 'bset imm3 r32ihh' },
  { slot: 1, val: 0x7d007100, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_bnot_imm3_r32ihh, name: 'bnot imm3 r32ihh' },
  { slot: 1, val: 0x7d007200, mask: 0xff8fff8f, val0: 0x0, mask0: 0x0, run: op_bclr_imm3_r32ihh, name: 'bclr imm3 r32ihh' },
  { slot: 1, val: 0x7e006300, mask: 0xff00ff0f, val0: 0x0, mask0: 0x0, run: op_btst_r8h_abs8, name: 'btst r8h abs8' },
  { slot: 1, val: 0x7e007300, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_btst_imm3_abs8, name: 'btst imm3 abs8' },
  { slot: 1, val: 0x7e007400, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_bor_imm3_abs8, name: 'bor imm3 abs8' },
  { slot: 1, val: 0x7e007480, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_bior_imm3_abs8, name: 'bior imm3 abs8' },
  { slot: 1, val: 0x7e007500, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_bxor_imm3_abs8, name: 'bxor imm3 abs8' },
  { slot: 1, val: 0x7e007580, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_bixor_imm3_abs8, name: 'bixor imm3 abs8' },
  { slot: 1, val: 0x7e007600, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_band_imm3_abs8, name: 'band imm3 abs8' },
  { slot: 1, val: 0x7e007680, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_biand_imm3_abs8, name: 'biand imm3 abs8' },
  { slot: 1, val: 0x7e007700, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_bld_imm3_abs8, name: 'bld imm3 abs8' },
  { slot: 1, val: 0x7e007780, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_bild_imm3_abs8, name: 'bild imm3 abs8' },
  { slot: 1, val: 0x7f006000, mask: 0xff00ff0f, val0: 0x0, mask0: 0x0, run: op_bset_r8h_abs8, name: 'bset r8h abs8' },
  { slot: 1, val: 0x7f006100, mask: 0xff00ff0f, val0: 0x0, mask0: 0x0, run: op_bnot_r8h_abs8, name: 'bnot r8h abs8' },
  { slot: 1, val: 0x7f006200, mask: 0xff00ff0f, val0: 0x0, mask0: 0x0, run: op_bclr_r8h_abs8, name: 'bclr r8h abs8' },
  { slot: 1, val: 0x7f006700, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_bst_imm3_abs8, name: 'bst imm3 abs8' },
  { slot: 1, val: 0x7f006780, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_bist_imm3_abs8, name: 'bist imm3 abs8' },
  { slot: 1, val: 0x7f007000, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_bset_imm3_abs8, name: 'bset imm3 abs8' },
  { slot: 1, val: 0x7f007100, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_bnot_imm3_abs8, name: 'bnot imm3 abs8' },
  { slot: 1, val: 0x7f007200, mask: 0xff00ff8f, val0: 0x0, mask0: 0x0, run: op_bclr_imm3_abs8, name: 'bclr imm3 abs8' },
  { slot: 0, val: 0x8000, mask: 0xf000, val0: 0x0, mask0: 0x0, run: op_add_b_imm8_r8u, name: 'add.b imm8 r8u' },
  { slot: 0, val: 0x9000, mask: 0xf000, val0: 0x0, mask0: 0x0, run: op_addx_b_imm8_r8u, name: 'addx.b imm8 r8u' },
  { slot: 0, val: 0xa000, mask: 0xf000, val0: 0x0, mask0: 0x0, run: op_cmp_b_imm8_r8u, name: 'cmp.b imm8 r8u' },
  { slot: 0, val: 0xb000, mask: 0xf000, val0: 0x0, mask0: 0x0, run: op_subx_b_imm8_r8u, name: 'subx.b imm8 r8u' },
  { slot: 0, val: 0xc000, mask: 0xf000, val0: 0x0, mask0: 0x0, run: op_or_b_imm8_r8u, name: 'or.b imm8 r8u' },
  { slot: 0, val: 0xd000, mask: 0xf000, val0: 0x0, mask0: 0x0, run: op_xor_b_imm8_r8u, name: 'xor.b imm8 r8u' },
  { slot: 0, val: 0xe000, mask: 0xf000, val0: 0x0, mask0: 0x0, run: op_and_b_imm8_r8u, name: 'and.b imm8 r8u' },
  { slot: 0, val: 0xf000, mask: 0xf000, val0: 0x0, mask0: 0x0, run: op_mov_b_imm8_r8u, name: 'mov.b imm8 r8u' },
];
