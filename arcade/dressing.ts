import { windowWidth } from './floor';
import * as THREE from 'three';
import { buildCeiling, ceilingKey, ceilingOf } from './ceiling';
import { surfaceMaterial } from './roomtextures';
import viewHarbour from './views/harbour.jpg?url';
import viewSquare from './views/square.jpg?url';
import viewOldtown from './views/oldtown.jpg?url';
import viewCarpark from './views/carpark.jpg?url';
import { copyLook, fullHeight, HOUSE_LOOK, isHardFloor, SCONCE_SHADES, WALL_LIGHT_STRENGTHS, type RoomLook } from './roomlook';
import viewHarbourNear from './views/harbour-near.webp?url';
import {
  VIEW_CONTRAST, VIEW_DISTANCE_M, VIEW_EXTERIOR, VIEW_EXTERIOR_LEVEL, VIEW_HAZE, VIEW_HORIZON_Y, VIEW_LAYERS, VIEW_LEVEL, VIEW_MID, VIEW_MIP_BIAS,
  VIEW_RADIUS_M, viewBackdrop,
} from './windowview';
import { edgeMaterial, edgeShade, glassMaterial, SPILL, viewColour, WindowEnv } from './windowglass';
import { glazing, revealGeometry, type RevealData, type RevealSpec, wallHole } from './windowreveal';
import extBrick from './textures/Bricks005/Bricks005_Color_512.jpg?url';
import extRender from './textures/Plaster001/Plaster001_Color_512.jpg?url';
import { str } from '../web/i18n';
import { paintWall, placeWallLights, wallFixture, type WallLight, type WallRun } from './walllayout';
import { buildWallLights } from './walllights';
import type { WallFixture } from './roomlook';

const CEILING = 3.1;
const MARGIN_SIDE = 2.4;
const MARGIN_BACK = 0.35;
const MARGIN_FRONT = 2.6;
const DADO = 1.0;
const RAIL_H = 0.06;
const RAIL_D = 0.03;
const WIN_TRANSOM_AT = 0.6;
const WIN_SILL_Y = DADO + RAIL_H / 2 + 0.27;
const WIN_H = 1.2;
const WIN_BEAD = 0.006;
const WIN_FRAME_SET = 0.23;
const WIN_OUTSIDE = 0.05;
const WIN_BOARD_T = 0.025;
const WIN_BOARD_PROUD = 0.035;
const WIN_BOARD_EARS = 0.04;
const WIN_FRAME = 0.06;
const WIN_BAR = 0.04;
const WIN_REVEAL_D = WIN_FRAME_SET + WIN_FRAME + WIN_OUTSIDE;
const WIN_SPLIT = WIN_FRAME_SET + WIN_FRAME / 2;
const EXT_TILE_M = { brick: 1.2, render: 2.0 };
const WIN_HEAD_BOUNCE = 0.28;
const WIN_FROST_LEVEL = 0.5;
const WIN_WARM = 0.3;
const BLIND_SLAT_M = 0.025;
const BLIND_SLATS_PER_TILE = 8;
const BLIND_GLOW = 0.08;
const SHADE_CORNER_M = 0.7;
const SHADE_CEILING_M = 0.9;
const SHADE_FLOOR_M = 0.35;
const SHADE_CARPET_M = 0.6;
const SHADE_MAX = 0.55;

const POOL_PX_M = 48;
const POOL_INTENSITY = 4;
const RELIEF_INTENSITY = 1.6;
const ROOM_LIGHT = 0.45;

function paintPool(
  c: HTMLCanvasElement, len: number, kind: WallFixture | null, lights: WallLight[], panelWash: boolean, look: RoomLook,
): void {
  const sconce = kind === 'sconces';
  const strength = WALL_LIGHT_STRENGTHS.find((s) => s.id === look.wallLightStrength)!.k;
  const p = paintWall(len, CEILING, POOL_PX_M, kind, lights, panelWash, strength);
  c.width = p.w;
  c.height = p.h;
  const g = c.getContext('2d')!;
  const wash = new THREE.Color(WASH_COLOUR);
  if (sconce) wash.lerp(new THREE.Color(SCONCE_SHADES.find((s) => s.id === look.sconceShade)!.glow), SCONCE_TINT);
  const col = wash.lerp(new THREE.Color(0xffffff), 0.35);
  const img = g.createImageData(p.w, p.h);
  for (let i = 0; i < p.level.length; i++) {
    const v = p.level[i] * POOL_PEAK;
    img.data[i * 4] = Math.round(col.r * 255 * v);
    img.data[i * 4 + 1] = Math.round(col.g * 255 * v);
    img.data[i * 4 + 2] = Math.round(col.b * 255 * v);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

const POOL_PEAK = 1;
const WASH_MAX = 12;
const WASH_COLOUR = 0xffd2a0;
const SCONCE_TINT = 0.3;
const WALL_LIGHT_CLEAR_M = 0.35;
const WASH_CANDELA = 9;
const WASH_ANGLE = 0.8;

const CARPET_GLOW = 0.35;
const HARD_FLOOR_GLOW = 0.1;

const CARPET_TILE_M = 2.0;

const REALISM_LEAN_X = -0.12;
const REALISM_LEAN_Z = -0.24;
const SHADOW_PX = 2048;
const SHADOW_TOP_M = 2.3;
const HALO_WALL_M = 0.9;
const HALO_CEILING_M = 0.7;
const HALO_LEVEL = 0.2;

const NEON = ['#ff2fb0', '#23c8ff', '#ffe03a'];

export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function carpetCanvas(
  size = 1024, seed = 1990, style: { ground: string; inks: readonly string[] } = { ground: '#050407', inks: NEON },
): HTMLCanvasElement {
  const inks = style.inks;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = style.ground;
  g.fillRect(0, 0, size, size);
  const rnd = seeded(seed);
  for (let i = 0; i < size * 6; i++) {
    g.fillStyle = `rgba(${40 + rnd() * 30},${30 + rnd() * 30},${50 + rnd() * 40},${0.25 + rnd() * 0.3})`;
    g.fillRect(rnd() * size, rnd() * size, 1.5, 1.5);
  }
  const wrapped = (draw: () => void): void => {
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        g.save();
        g.translate(dx, dy);
        draw();
        g.restore();
      }
    }
  };
  const S = size / 1024;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let i = 0; i < 26; i++) {
    const col = inks[i % inks.length];
    const pts: [number, number][] = [];
    let x = rnd() * size;
    let y = rnd() * size;
    let a = rnd() * Math.PI * 2;
    const n = 5 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      pts.push([x, y]);
      a += (rnd() - 0.5) * 2.4;
      const step = (30 + rnd() * 40) * S;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
    }
    const w = (6 + rnd() * 5) * S;
    wrapped(() => {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length - 1; k++) {
        const mx = (pts[k][0] + pts[k + 1][0]) / 2;
        const my = (pts[k][1] + pts[k + 1][1]) / 2;
        g.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
      }
      g.stroke();
    });
  }
  for (let i = 0; i < 12; i++) {
    const col = inks[(i + 1) % inks.length];
    const x = rnd() * size;
    const y = rnd() * size;
    const a = rnd() * Math.PI;
    const seg = (14 + rnd() * 10) * S;
    const k = 4 + Math.floor(rnd() * 4);
    wrapped(() => {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.strokeStyle = col;
      g.lineWidth = 5 * S;
      g.beginPath();
      g.moveTo(0, 0);
      for (let j = 1; j <= k; j++) g.lineTo(j * seg, j % 2 ? seg * 0.8 : 0);
      g.stroke();
      g.restore();
    });
  }
  for (let i = 0; i < 16; i++) {
    const col = inks[(i + 2) % inks.length];
    const x = rnd() * size;
    const y = rnd() * size;
    const r = (10 + rnd() * 16) * S;
    const tri = i % 3 === 0;
    const a = rnd() * Math.PI;
    wrapped(() => {
      g.strokeStyle = col;
      g.lineWidth = 4.5 * S;
      g.beginPath();
      if (tri) {
        for (let j = 0; j < 3; j++) {
          const t = a + (j * Math.PI * 2) / 3;
          if (j === 0) g.moveTo(x + Math.cos(t) * r, y + Math.sin(t) * r);
          else g.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r);
        }
        g.closePath();
      } else {
        g.arc(x, y, r, 0, Math.PI * 2);
      }
      g.stroke();
    });
  }
  for (let i = 0; i < 60; i++) {
    const col = inks[i % inks.length];
    const x = rnd() * size;
    const y = rnd() * size;
    const r = (3 + rnd() * 4) * S;
    wrapped(() => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    });
  }
  return c;
}

const PILE_TILE_M = 0.14;
const PILE_PX = 256;
const PILE_TUFTS = 20;
const PILE_SHADE = 0.6;
const PILE_BUMP = 1.1;
const PILE_FIBRE = [0.011, 0.009, 0.016] as const;
const PILE_LAY = 0.16;
const PILE_LAY_TILES = 17;

export interface CarpetPile {
  normal: Uint8Array;
  rough: Uint8Array;
  mean: number;
  size: number;
}

export function carpetPile(size = PILE_PX, tufts = PILE_TUFTS, seed = 1966): CarpetPile {
  const rnd = seeded(seed);
  const h = new Float32Array(size * size);
  const rough = new Float32Array(size * size).fill(1);
  const pitch = size / tufts;
  for (let row = 0; row < tufts; row++) {
    for (let col = 0; col < tufts; col++) {
      const cx = (col + (row % 2) * 0.5 + (rnd() - 0.5) * 0.45) * pitch;
      const cy = (row + 0.5 + (rnd() - 0.5) * 0.45) * pitch;
      const r = pitch * (0.52 + rnd() * 0.22);
      const top = 0.7 + rnd() * 0.3;
      const lx = (rnd() - 0.5) * r * 0.5;
      const ly = (rnd() - 0.5) * r * 0.5;
      const rv = 0.62 + rnd() * 0.3;
      const reach = Math.ceil(r + 1);
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const d = Math.hypot(dx - lx * (1 - Math.hypot(dx, dy) / r), dy - ly * (1 - Math.hypot(dx, dy) / r)) / r;
          if (d >= 1) continue;
          const x = ((Math.round(cx) + dx) % size + size) % size;
          const y = ((Math.round(cy) + dy) % size + size) % size;
          const v = top * Math.cos(d * Math.PI / 2) ** 1.5;
          const i = y * size + x;
          if (v > h[i]) { h[i] = v; rough[i] = rv; }
        }
      }
    }
  }
  for (let i = 0; i < h.length; i++) h[i] = Math.min(1, h[i] * (0.9 + rnd() * 0.1));
  const L = 5;
  const lat = Array.from({ length: L * L }, () => rnd());
  const lay = (x: number, y: number): number => {
    const fx = (x / size) * L;
    const fy = (y / size) * L;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const s = (t: number): number => t * t * (3 - 2 * t);
    const tx = s(fx - x0);
    const ty = s(fy - y0);
    const v = (i: number, j: number): number => lat[((j % L) + L) % L * L + ((i % L) + L) % L];
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
  const normal = new Uint8Array(size * size * 4);
  const out = new Uint8Array(size * size * 4);
  let sum = 0;
  const at = (x: number, y: number): number => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const sx = (at(x + 1, y) - at(x - 1, y)) * PILE_BUMP * 2;
      const sy = (at(x, y + 1) - at(x, y - 1)) * PILE_BUMP * 2;
      const len = Math.hypot(sx, sy, 1);
      normal[i * 4] = Math.round(((-sx / len) * 0.5 + 0.5) * 255);
      normal[i * 4 + 1] = Math.round(((sy / len) * 0.5 + 0.5) * 255);
      normal[i * 4 + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      normal[i * 4 + 3] = Math.round(h[i] * 255);
      sum += Math.round(h[i] * 255) / 255;
      out[i * 4] = Math.round(lay(x, y) * 255);
      out[i * 4 + 1] = out[i * 4 + 2] = Math.round(rough[i] * 255);
      out[i * 4 + 3] = 255;
    }
  }
  return { normal, rough: out, mean: sum / h.length, size };
}

function pileTexture(data: Uint8Array, size: number, repeat: number, renderer: THREE.WebGLRenderer): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.needsUpdate = true;
  return t;
}

const VIEWS: Partial<Record<RoomLook['window'], string>> = { harbour: viewHarbour, square: viewSquare, oldtown: viewOldtown, carpark: viewCarpark };
const LAYER_URLS: Record<string, string> = { 'harbour-near.webp': viewHarbourNear };
const VIEW_HAZE_COLOUR = new THREE.Color(0x30404c);

function gradeView(mat: THREE.MeshBasicMaterial): void {
  const haze = VIEW_HAZE_COLOUR.toArray().map((x) => x.toFixed(4)).join(', ');
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv, ${VIEW_MIP_BIAS.toFixed(2)} );
        sampledDiffuseColor.rgb = mix( vec3( ${VIEW_MID.toFixed(4)} ), sampledDiffuseColor.rgb, ${VIEW_CONTRAST.toFixed(3)} );
        sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, vec3( ${haze} ), ${VIEW_HAZE.toFixed(3)} );
        diffuseColor *= sampledDiffuseColor;
      #endif`);
  };
}

function viewTexture(t: THREE.Texture, renderer: THREE.WebGLRenderer): THREE.Texture {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const FROSTED_VIEW = viewSquare;
const viewLoader = new THREE.TextureLoader();

export interface Dressing {
  group: THREE.Group;
  box: { minX: number; maxX: number; minZ: number; maxZ: number; height: number };
  restyle(look: RoomLook): void;
  lights: number;
  door: { box: THREE.Box3; stand: { x: number; z: number } };
  tick(t: number, eye?: THREE.Vector3): void;
  seenFrom(eye: THREE.Vector3): void;
  motion: boolean;
  captureWindow(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void;
  dispose(): void;
  floor: THREE.Mesh;
  backWall: { mesh: THREE.Mesh; w: number; along: number; vOff: number; y0: number; h: number };
  setRealism(o: { shadow: boolean; halos: boolean; picture?: boolean }): void;
  dim(k: number): void;
}

const dressedLevels = new WeakMap<THREE.Material, { lightMap: number; emissive: number; opacity: number }>();

export function dimMaterials(root: THREE.Object3D, k: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial;
      const basic = m as THREE.MeshBasicMaterial;
      let base = dressedLevels.get(m);
      if (!base) {
        base = { lightMap: std.lightMapIntensity ?? 1, emissive: std.emissiveIntensity ?? 0, opacity: m.opacity };
        dressedLevels.set(m, base);
      }
      if (std.lightMap) std.lightMapIntensity = base.lightMap * k;
      if (std.isMeshStandardMaterial && base.emissive > 0) std.emissiveIntensity = base.emissive * k;
      if (basic.isMeshBasicMaterial && m.blending === THREE.AdditiveBlending && m.transparent) m.opacity = base.opacity * k;
    }
  });
}

interface Tube { mat: THREE.MeshBasicMaterial; len: number; base: THREE.Color; chase: THREE.Texture | null; mesh: THREE.Mesh; halo: THREE.MeshBasicMaterial | null; haloMesh: THREE.Object3D | null }

const CHASE_M = 0.45;
const CHASE_MPS = 0.9;
const PULSE_S = 2.2;
const CYCLE_S = 12;

let chaseTex: THREE.Texture | null = null;
function chasePattern(): THREE.Texture {
  if (!chaseTex) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(0.62, '#b4b4b4');
    grad.addColorStop(1, '#9c9c9c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
    chaseTex = new THREE.CanvasTexture(c);
    chaseTex.colorSpace = THREE.SRGBColorSpace;
    chaseTex.wrapS = chaseTex.wrapT = THREE.RepeatWrapping;
  }
  return chaseTex;
}

function flickerAt(t: number, k: number): number {
  const r = seeded(Math.floor(t * 6 + k * 13.7) * 7919 + k)();
  return r < 0.06 ? 0.15 : r < 0.12 ? 0.6 : 1;
}

const DOOR_LEAF_W = 0.9;
const DOOR_H = 2.1;
const DOOR_PROUD = 0.012;
const DOOR_LEAF_D = 0.045;
const DOOR_GLOW = 0.14;
const DOOR_STAND_M = 1.8;
const DOOR_CORNER_M = 2.6;
const ARCHITRAVE_W = 0.11;
const ARCHITRAVE_D = 0.07;
const PUSH_BAR_Y = 1.0;
const VISION_W = 0.2;
const VISION_H = 0.6;
const EXIT_W = 0.42;
const EXIT_H = 0.2;
const EXIT_D = 0.045;
const EXIT_GREEN = '#0d8a40';
const EXIT_GLOW_M = 1.5;

let exitTex: THREE.Texture | null = null;
function exitSign(): THREE.Texture {
  if (exitTex) return exitTex;
  const c = document.createElement('canvas');
  c.width = 420;
  c.height = 200;
  const g = c.getContext('2d')!;
  g.fillStyle = EXIT_GREEN;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 10;
  g.strokeRect(22, 30, 54, 140);
  g.fillRect(22, 30, 54, 140);
  g.fillStyle = EXIT_GREEN;
  g.fillRect(34, 42, 42, 128);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(132, 52, 15, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 14;
  g.beginPath();
  g.moveTo(126, 72); g.lineTo(108, 118);
  g.moveTo(108, 118); g.lineTo(84, 142); g.lineTo(90, 168);
  g.moveTo(108, 118); g.lineTo(130, 134); g.lineTo(112, 170);
  g.moveTo(122, 84); g.lineTo(96, 96); g.lineTo(78, 86);
  g.moveTo(122, 84); g.lineTo(146, 104); g.lineTo(160, 90);
  g.stroke();
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(346, 100); g.lineTo(400, 100);
  g.moveTo(378, 78); g.lineTo(400, 100); g.lineTo(378, 122);
  g.stroke();
  g.font = 'bold 86px "Helvetica Neue", Arial, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(str('arcade.dressing.exit'), 256, 104);
  exitTex = new THREE.CanvasTexture(c);
  exitTex.colorSpace = THREE.SRGBColorSpace;
  exitTex.anisotropy = 4;
  return exitTex;
}

let exitGlowTex: THREE.Texture | null = null;
function exitGlow(): THREE.Texture {
  if (!exitGlowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(90,255,150,0.9)');
    r.addColorStop(0.45, 'rgba(90,255,150,0.3)');
    r.addColorStop(1, 'rgba(90,255,150,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    exitGlowTex = new THREE.CanvasTexture(c);
    exitGlowTex.colorSpace = THREE.SRGBColorSpace;
  }
  return exitGlowTex;
}

function buildDoorway(
  renderer: THREE.WebGLRenderer, look: RoomLook, x: number, z: number, rotY: number,
  lit: { pool: THREE.Texture; u: number; w: number } | null,
): { group: THREE.Group; leafMat: THREE.MeshStandardMaterial } {
  const at = new THREE.Group();
  at.position.set(x, 0, z);
  at.rotation.y = rotY;
  const openW = DOOR_LEAF_W * 2;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.6 });
  const leafMat = surfaceMaterial('wood', DOOR_LEAF_W, DOOR_H, renderer, look.rail, 0, DOOR_GLOW);
  if (lit) {
    for (const m of [leafMat, frameMat]) {
      const t = lit.pool.clone();
      t.repeat.set(lit.w, DOOR_H / CEILING);
      t.offset.set(lit.u - lit.w / 2, 0);
      m.lightMap = t;
      m.lightMapIntensity = POOL_INTENSITY * ROOM_LIGHT;
    }
  }
  const metalMat = surfaceMaterial('powder', 0.7, 0.3, renderer, 0xd8d8d8);
  metalMat.metalness = 0.6;
  metalMat.roughness = 0.45;
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 0.12, metalness: 0.5 });
  const box = (w: number, h: number, d: number, px: number, py: number, pz: number, mat: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(px, py, pz + d / 2);
    at.add(m);
    return m;
  };
  const reveal = new THREE.Mesh(new THREE.PlaneGeometry(openW + 0.02, DOOR_H + 0.02), new THREE.MeshStandardMaterial({ color: 0x070608, roughness: 1 }));
  reveal.position.set(0, DOOR_H / 2, DOOR_PROUD);
  at.add(reveal);
  for (const side of [-1, 1]) {
    const lx = (side * DOOR_LEAF_W) / 2;
    box(DOOR_LEAF_W - 0.012, DOOR_H - 0.02, DOOR_LEAF_D, lx, DOOR_H / 2, DOOR_PROUD + 0.004, leafMat);
    const front = DOOR_PROUD + 0.004 + DOOR_LEAF_D;
    box(VISION_W, VISION_H, 0.006, lx - side * 0.12, 1.6, front, glassMat);
    box(VISION_W + 0.04, 0.02, 0.012, lx - side * 0.12, 1.6 + VISION_H / 2 + 0.01, front, metalMat);
    box(VISION_W + 0.04, 0.02, 0.012, lx - side * 0.12, 1.6 - VISION_H / 2 - 0.01, front, metalMat);
    box(0.02, VISION_H + 0.04, 0.012, lx - side * 0.12 - VISION_W / 2 - 0.01, 1.6, front, metalMat);
    box(0.02, VISION_H + 0.04, 0.012, lx - side * 0.12 + VISION_W / 2 + 0.01, 1.6, front, metalMat);
    box(0.04, 0.05, 0.08, lx - (DOOR_LEAF_W / 2 - 0.1) , PUSH_BAR_Y, front, metalMat);
    box(0.04, 0.05, 0.08, lx + (DOOR_LEAF_W / 2 - 0.1), PUSH_BAR_Y, front, metalMat);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, DOOR_LEAF_W - 0.14, 10).rotateZ(Math.PI / 2), metalMat);
    bar.position.set(lx, PUSH_BAR_Y, front + 0.07);
    at.add(bar);
    box(DOOR_LEAF_W - 0.1, 0.24, 0.004, lx, 0.15, front, metalMat);
  }
  box(openW + ARCHITRAVE_W * 2, ARCHITRAVE_W, ARCHITRAVE_D, 0, DOOR_H + ARCHITRAVE_W / 2, 0, frameMat);
  box(ARCHITRAVE_W, DOOR_H, ARCHITRAVE_D, -(openW + ARCHITRAVE_W) / 2, DOOR_H / 2, 0, frameMat);
  box(ARCHITRAVE_W, DOOR_H, ARCHITRAVE_D, (openW + ARCHITRAVE_W) / 2, DOOR_H / 2, 0, frameMat);
  const signY = DOOR_H + ARCHITRAVE_W + 0.1 + EXIT_H / 2;
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x101210, roughness: 0.8 });
  const face = new THREE.MeshBasicMaterial({ map: exitSign() });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(EXIT_W, EXIT_H, EXIT_D), [caseMat, caseMat, caseMat, caseMat, face, caseMat]);
  sign.position.set(0, signY, 0.02 + EXIT_D / 2);
  at.add(sign);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(EXIT_GLOW_M, EXIT_GLOW_M * 0.6),
    new THREE.MeshBasicMaterial({ map: exitGlow(), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  glow.position.set(0, signY, 0.008);
  at.add(glow);
  return { group: at, leafMat };
}

export const BANK_MARGINS = { side: MARGIN_SIDE, back: MARGIN_BACK, front: MARGIN_FRONT };

export function buildRoom(
  box: { minX: number; maxX: number; minZ: number; maxZ: number }, renderer: THREE.WebGLRenderer, look: RoomLook = HOUSE_LOOK,
  sw: { lights: number; shade: boolean; pools: boolean; winEnv?: boolean } = { lights: 0, shade: true, pools: true },
  doorAt?: number,
): Dressing {
  const group = new THREE.Group();
  const { minX, maxX, minZ, maxZ } = box;
  const W = maxX - minX;
  const D = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const neonCanvas = (l: RoomLook): HTMLCanvasElement => carpetCanvas(1024, 1990, { ground: l.carpetGround, inks: l.carpetInks });
  const tex = new THREE.CanvasTexture(neonCanvas(look));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(W / CARPET_TILE_M, D / CARPET_TILE_M);
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const pile = carpetPile();
  const pileRepeat = [W / PILE_TILE_M, D / PILE_TILE_M] as const;
  const pileNormal = pileTexture(pile.normal, pile.size, 1, renderer);
  pileNormal.repeat.set(...pileRepeat);
  const pileRough = pileTexture(pile.rough, pile.size, 1, renderer);
  pileRough.repeat.set(...pileRepeat);
  const carpetMat = new THREE.MeshStandardMaterial({
    map: tex, roughness: 1, metalness: 0,
    emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.32,
    normalMap: pileNormal, normalScale: new THREE.Vector2(1, 1),
    roughnessMap: pileRough,
  });
  carpetMat.onBeforeCompile = (shader) => {
    shader.uniforms.pileMean = { value: pile.mean };
    shader.uniforms.pileShade = { value: PILE_SHADE };
    shader.uniforms.pileFibre = { value: new THREE.Vector3(...PILE_FIBRE) };
    shader.uniforms.pileLay = { value: PILE_LAY };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform float pileMean;
uniform float pileShade;
uniform vec3 pileFibre;
uniform float pileLay;
void main() {`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        // The tufts' height (the normal map's alpha) shades the pattern and
        // its glow about 1: tops a little lighter, the gaps between darker.
        float pileH = texture2D( normalMap, vNormalMapUv ).a;
        float pileK = max( 0.0, 1.0 + pileShade * ( pileH - pileMean ) / max( pileMean, 0.05 ) );
        // The lay: broad patches a little lighter or darker.
        pileK *= 1.0 + pileLay * ( texture2D( roughnessMap, vRoughnessMapUv / ${PILE_LAY_TILES}.0 ).r - 0.5 ) * 2.0;
        diffuseColor.rgb *= pileK;
        totalEmissiveRadiance *= pileK;
        totalEmissiveRadiance += pileFibre * pileH * pileK;
      }`);
  };
  const laid = (l: RoomLook): THREE.Material => (l.carpet === 'neon' ? carpetMat
    : surfaceMaterial(l.carpet, W, D, renderer, l.carpetColour, 0, isHardFloor(l.carpet) ? HARD_FLOOR_GLOW : CARPET_GLOW));
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), laid(look));
  carpet.position.set(cx, 0, cz);
  group.add(carpet);

  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.7 });
  const railMat = surfaceMaterial('wood', 4, 0.06, renderer, look.rail);
  type Piece = { m: THREE.Mesh; w: number; along: number; pool: THREE.Texture | null; v0: number; v1: number };
  const lowerKind = (l: RoomLook): RoomLook['lower'] | RoomLook['upper'] => (fullHeight(l.upper) ? l.upper : l.lower);
  const lowerTint = (l: RoomLook): string => (fullHeight(l.upper) ? l.upperColour : l.lowerColour);
  const rails: THREE.Mesh[] = [];
  const lowers: Piece[] = [];
  const uppers: Piece[] = [];
  const poolOn = (p: Piece): void => {
    if (!p.pool) return;
    const t = p.pool.clone();
    t.repeat.set(1, p.v1 - p.v0);
    t.offset.set(0, p.v0);
    const mat = p.m.material as THREE.MeshStandardMaterial;
    mat.lightMap = t;
    mat.lightMapIntensity = POOL_INTENSITY * ROOM_LIGHT;
    mat.needsUpdate = true;
  };
  let along = 0;
  const pools: { c: HTMLCanvasElement; w: number; tex: THREE.Texture }[] = [];
  const ceilingShades: THREE.Object3D[] = [];
  const wall = (w: number, x: number, z: number, rotY: number, hole?: { x: number; w: number; y0: number; y1: number }): void => {
    const piece = (h: number, y: number, mat: THREE.Material): THREE.Mesh => {
      const cut = hole && hole.y0 >= y - h / 2 && hole.y1 <= y + h / 2 ? { ...hole, y0: hole.y0 - y, y1: hole.y1 - y } : undefined;
      const m = new THREE.Mesh(cut ? holedPlane(w, h, cut) : new THREE.PlaneGeometry(w, h), mat);
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      group.add(m);
      return m;
    };
    let pool: THREE.Texture | null = null;
    if (sw.pools) {
      const c = document.createElement('canvas');
      paintPool(c, w, null, [], false, look);
      pool = new THREE.CanvasTexture(c);
      pool.colorSpace = THREE.SRGBColorSpace;
      pools.push({ c, w, tex: pool });
    }
    const low: Piece = { m: piece(DADO, DADO / 2, surfaceMaterial(lowerKind(look), w, DADO, renderer, lowerTint(look), along)), w, along, pool, v0: 0, v1: DADO / CEILING };
    const up: Piece = {
      m: piece(CEILING - DADO, (CEILING + DADO) / 2, surfaceMaterial(look.upper, w, CEILING - DADO, renderer, look.upperColour, along, 0, DADO)),
      w, along, pool, v0: DADO / CEILING, v1: 1,
    };
    poolOn(low);
    poolOn(up);
    lowers.push(low);
    uppers.push(up);
    along += w;
    const ledge = (h: number, d: number, y: number, mat: THREE.Material): THREE.Mesh => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      s.position.set(x, y, z);
      s.rotation.y = rotY;
      s.translateZ(d / 2);
      group.add(s);
      return s;
    };
    ledge(0.12, 0.02, 0.06, skirtMat);
    const rail = ledge(RAIL_H, RAIL_D, DADO, railMat);
    rail.visible = !fullHeight(look.upper);
    rails.push(rail);
    if (sw.shade) ceilingShades.push(shadeWall(group, w, x, z, rotY, hole));
  };
  wall(W, cx, minZ, 0);
  wall(W, cx, maxZ, Math.PI);
  const winW = windowWidth(D);
  const revealSpec: RevealSpec = {
    winW, sillY: WIN_SILL_Y, headY: WIN_SILL_Y + WIN_H, depth: WIN_REVEAL_D, split: WIN_SPLIT, bead: WIN_BEAD,
    wallW: D, wallH: CEILING - DADO, wallY0: DADO,
  };
  wall(D, minX, cz, Math.PI / 2, wallHole(revealSpec));
  const leftUpper = uppers[uppers.length - 1].m;
  const leftHoled = leftUpper.geometry;
  const leftWhole = new THREE.PlaneGeometry(D, CEILING - DADO);
  wall(D, maxX, cz, -Math.PI / 2);
  if (sw.shade) shadeFloor(group, box);

  let ceiling = buildCeiling(ceilingOf(look), W, D, cx, cz, CEILING, renderer);
  group.add(ceiling.group);

  const win = new THREE.Group();
  win.position.set(minX, 0, cz);
  win.rotation.y = Math.PI / 2;
  group.add(win);
  const winY = WIN_SILL_Y + WIN_H / 2;
  const woodAlong = mouldingMaterial(look.rail, false);
  const woodUp = mouldingMaterial(look.rail, true);
  const woods = [woodAlong, woodUp];
  const warmGlow = (rail: string): THREE.Color => new THREE.Color(rail).lerp(new THREE.Color(WASH_COLOUR), WIN_WARM);
  for (const m of woods) m.emissive.copy(warmGlow(look.rail));
  const winBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat?: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat ?? (h > w ? woodUp : woodAlong));
    m.position.set(x, y, z);
    win.add(m);
    return m;
  };
  const meshOf = (d: RevealData): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    g.addGroup(d.groups.interior[0], d.groups.interior[1], 0);
    g.addGroup(d.groups.head[0], d.groups.head[1], 1);
    g.addGroup(d.groups.exterior[0], d.groups.exterior[1], 2);
    return g;
  };
  const headMatOf = (l: RoomLook): THREE.MeshStandardMaterial => {
    const m = (leftUpper.material as THREE.MeshStandardMaterial).clone();
    m.emissive.set(l.upperColour).multiply(new THREE.Color(WASH_COLOUR));
    m.emissiveMap = m.map;
    m.emissiveIntensity = WIN_HEAD_BOUNCE * ROOM_LIGHT;
    return m;
  };
  let headMat = headMatOf(look);
  const extMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false });
  gradeView(extMat);
  const extHue = new THREE.Color(0.55, 0.62, 0.8);
  const extTextures = new Map<string, THREE.Texture>();
  const extOn = (v: RoomLook['window']): void => {
    const kind = VIEW_EXTERIOR[v] ?? 'render';
    let t = extTextures.get(kind);
    if (!t) {
      t = viewLoader.load(kind === 'brick' ? extBrick : extRender, () => { extMat.needsUpdate = true; });
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.setScalar(1 / EXT_TILE_M[kind]);
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      extTextures.set(kind, t);
    }
    if (extMat.map !== t) { extMat.map = t; extMat.needsUpdate = true; }
  };
  const reveal = new THREE.Mesh(meshOf(revealGeometry(revealSpec)), [leftUpper.material as THREE.Material, headMat, extMat]);
  reveal.onBeforeRender = (r) => { extMat.color.copy(extHue).multiplyScalar(VIEW_EXTERIOR_LEVEL * VIEW_LEVEL * r.toneMappingExposure); };
  win.add(reveal);
  const frameSpan: [number, number] = [WIN_FRAME_SET - WIN_BEAD, WIN_FRAME_SET + WIN_FRAME - WIN_BEAD];
  const edges: ReturnType<typeof edgeMaterial>[] = [];
  const overlay = (corners: number[][], st: [number, number][], shade: Parameters<typeof edgeShade>[0], lift: number[]): THREE.Mesh => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(corners.flatMap((c) => [c[0] + lift[0], c[1] + lift[1], c[2] + lift[2]])), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(st.flat()), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mat = edgeMaterial(edgeShade(shade));
    mat.side = THREE.DoubleSide;
    edges.push(mat);
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 2;
    win.add(m);
    return m;
  };
  const headY = WIN_SILL_Y + WIN_H;
  const zIn = -WIN_BEAD, zOut = -WIN_SPLIT;
  const flatD = WIN_SPLIT - WIN_BEAD;
  const lift = 0.0005;
  const jamb = { depth: flatD, len: WIN_H, frame: frameSpan, ends: true, spill: true };
  for (const side of [-1, 1]) {
    const x = side * winW / 2;
    overlay([[x, WIN_SILL_Y, zIn], [x, WIN_SILL_Y, zOut], [x, headY, zOut], [x, headY, zIn]], [[0, 0], [1, 0], [1, 1], [0, 1]], jamb, [-side * lift, 0, 0]);
  }
  overlay([[-winW / 2, headY, zIn], [-winW / 2, headY, zOut], [winW / 2, headY, zOut], [winW / 2, headY, zIn]], [[0, 0], [1, 0], [1, 1], [0, 1]],
    { depth: flatD, len: winW, frame: frameSpan, ends: true, spill: true }, [0, -lift, 0]);
  const boardW = winW + 2 * (WIN_BEAD + WIN_BOARD_EARS);
  const boardBack = -(WIN_FRAME_SET + 0.01);
  const noseZ = WIN_BOARD_PROUD - WIN_BOARD_T / 2;
  const boardY = WIN_SILL_Y - WIN_BOARD_T / 2;
  winBox(boardW, WIN_BOARD_T, noseZ - boardBack, 0, boardY, (noseZ + boardBack) / 2, woodAlong);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(WIN_BOARD_T / 2, WIN_BOARD_T / 2, boardW, 16, 1, false, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2), woodAlong);
  nose.position.set(0, boardY, noseZ);
  win.add(nose);
  const boardD = noseZ + WIN_FRAME_SET;
  overlay([[-winW / 2, WIN_SILL_Y, noseZ], [-winW / 2, WIN_SILL_Y, -WIN_FRAME_SET], [winW / 2, WIN_SILL_Y, -WIN_FRAME_SET], [winW / 2, WIN_SILL_Y, noseZ]],
    [[0, 0], [1, 0], [1, 1], [0, 1]], { depth: boardD, len: winW, frame: [boardD, boardD + WIN_FRAME], ends: true, spill: true }, [0, lift, 0]);
  const underTop = WIN_SILL_Y - WIN_BOARD_T, underFoot = DADO + RAIL_H / 2;
  const underH = underTop - underFoot;
  overlay([[-boardW / 2, underTop, 0], [-boardW / 2, underFoot, 0], [boardW / 2, underFoot, 0], [boardW / 2, underTop, 0]],
    [[0, 0], [1, 0], [1, 1], [0, 1]], { depth: underH, len: boardW, frame: null, ends: false, spill: false, from: 'top' }, [0, 0, lift]);
  const fz = -(WIN_FRAME_SET + WIN_FRAME / 2);
  const glaze = glazing({ w: winW, y0: WIN_SILL_Y, h: WIN_H, frame: WIN_FRAME, bar: WIN_BAR, transomAt: WIN_TRANSOM_AT });
  for (const m of glaze.members) winBox(m.w, m.h, WIN_FRAME, m.x, m.y, fz);
  const glassMat = glassMaterial({ w: winW, h: WIN_H, frame: WIN_FRAME, bar: WIN_BAR, transomY: glaze.members[5].y - winY });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(winW, WIN_H), glassMat);
  glass.position.set(0, winY, fz - WIN_FRAME / 4);
  glass.renderOrder = 3;
  win.add(glass);
  let winEnv: WindowEnv | null = null;
  let glassLevel = 1;
  const frostMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false });
  const frost = new THREE.Mesh(new THREE.PlaneGeometry(winW, WIN_H), frostMat);
  frost.position.copy(glass.position);
  frost.onBeforeRender = (r) => { frostMat.color.setScalar(WIN_FROST_LEVEL * r.toneMappingExposure); };
  win.add(frost);
  const slats = blindSlats();
  slats.repeat.set(1, WIN_H / (BLIND_SLATS_PER_TILE * BLIND_SLAT_M));
  const blindMat = new THREE.MeshStandardMaterial({
    color: 0xa89e8c, map: slats, roughness: 0.7, emissive: 0xa89e8c, emissiveMap: slats, emissiveIntensity: BLIND_GLOW,
  });
  const blinds = new THREE.Group();
  const blindZ = fz + WIN_FRAME / 2 + 0.012;
  const blindPanel = new THREE.Mesh(new THREE.PlaneGeometry(winW - 0.02, WIN_H - 0.05), blindMat);
  blindPanel.position.set(0, winY - 0.02, blindZ);
  blinds.add(blindPanel);
  const headRail = new THREE.Mesh(new THREE.BoxGeometry(winW - 0.01, 0.045, 0.03), blindMat);
  headRail.position.set(0, WIN_SILL_Y + WIN_H - 0.025, blindZ + 0.005);
  blinds.add(headRail);
  win.add(blinds);
  const viewData = viewBackdrop(1);
  const viewGeom = new THREE.BufferGeometry();
  viewGeom.setAttribute('position', new THREE.BufferAttribute(viewData.position, 3));
  viewGeom.setAttribute('uv', new THREE.BufferAttribute(viewData.uv, 2));
  viewGeom.setIndex(new THREE.BufferAttribute(viewData.index, 1));
  const viewMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false });
  viewMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      gl_Position.z = gl_Position.w * 0.999999;`);
  };
  gradeView(viewMat);
  const backdrop = new THREE.Mesh(viewGeom, viewMat);
  backdrop.position.set(0, VIEW_HORIZON_Y, 0);
  backdrop.frustumCulled = false;
  backdrop.onBeforeRender = (r) => { viewMat.color.setScalar(VIEW_LEVEL * r.toneMappingExposure); };
  win.add(backdrop);
  const layers = new THREE.Group();
  layers.position.set(0, VIEW_HORIZON_Y, 0);
  win.add(layers);
  const clearLayers = (): void => {
    for (const m of [...layers.children] as THREE.Mesh[]) {
      layers.remove(m);
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
  };
  const addLayer = (url: string, distance: number, topDeg: number, v: RoomLook['window']): void => {
    const d = viewBackdrop(1, undefined, undefined, undefined, 48, 16, topDeg);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false, transparent: true, depthWrite: false });
    gradeView(mat);
    const m = new THREE.Mesh(g, mat);
    m.scale.setScalar(distance);
    m.renderOrder = 1;
    m.visible = false;
    m.onBeforeRender = (r) => { mat.color.setScalar(VIEW_LEVEL * r.toneMappingExposure); };
    layers.add(m);
    viewLoader.load(url, (t) => {
      if (windowKind !== v || m.parent !== layers) { t.dispose(); return; }
      mat.map = viewTexture(t, renderer);
      mat.needsUpdate = true;
      m.visible = true;
    });
  };
  const spillFrom = (img: CanvasImageSource | null, level: number): void => {
    const c = img ? viewColour(img).multiplyScalar(SPILL * level) : new THREE.Color(0, 0, 0);
    for (const e of edges) e.uniforms.spill.value.copy(c);
    if (img) {
      const hue = viewColour(img);
      extHue.copy(hue).multiplyScalar(1 / Math.max(hue.r, hue.g, hue.b, 1e-6));
    }
  };
  let windowKind: RoomLook['window'] = look.window;
  let inRoom = true;
  const viewOn = (v: RoomLook['window']): void => {
    windowKind = v;
    const street = VIEWS[v];
    win.visible = v !== 'none';
    leftUpper.geometry = v === 'none' ? leftWhole : leftHoled;
    blinds.visible = v === 'blinds';
    frost.visible = v === 'frosted';
    glass.visible = v !== 'frosted';
    backdrop.visible = inRoom && !!street;
    layers.visible = inRoom && !!street;
    clearLayers();
    if (!street && v !== 'frosted') spillFrom(null, 0);
    extOn(v);
    if (street) {
      backdrop.scale.setScalar(VIEW_DISTANCE_M[v] ?? VIEW_RADIUS_M);
      for (const l of VIEW_LAYERS[v]?.layers ?? []) {
        const url = LAYER_URLS[l.texture];
        if (url) addLayer(url, l.distance, l.crop.topDeg, v);
      }
      viewLoader.load(street, (t) => {
        if (windowKind !== v) { t.dispose(); return; }
        viewMat.map?.dispose();
        viewMat.map = viewTexture(t, renderer);
        viewMat.needsUpdate = true;
        spillFrom(t.image as CanvasImageSource, VIEW_LEVEL);
      });
    } else if (v === 'frosted') {
      viewLoader.load(FROSTED_VIEW, (t) => {
        if (!frostMat.map) {
          frostMat.map = frostFrom(t.image as CanvasImageSource & { width: number; height: number });
          frostMat.needsUpdate = true;
        }
        if (windowKind === v) spillFrom(t.image as CanvasImageSource, WIN_FROST_LEVEL);
        t.dispose();
      });
    }
  };
  viewOn(look.window);
  const roomBox = new THREE.Box3(new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, CEILING, maxZ));
  const seenFrom = (eye: THREE.Vector3): void => {
    inRoom = roomBox.containsPoint(eye);
    backdrop.visible = layers.visible = inRoom && !!VIEWS[windowKind];
  };
  const captureWindow = (r: THREE.WebGLRenderer, scene: THREE.Scene): void => {
    if (sw.winEnv === false || !win.visible || !glass.visible) return;
    winEnv ??= new WindowEnv();
    win.updateMatrixWorld(true);
    const at = new THREE.Vector3(0, winY, 0.25).applyMatrix4(win.matrixWorld);
    winEnv.capture(r, scene, at, [glass, frost]);
    glassMat.uniforms.envMap.value = winEnv.target.texture;
    glassMat.uniforms.envOn.value = 1;
    glassMat.uniforms.level.value = glassLevel;
  };

  const doorX = doorAt ?? cx + Math.max(0, Math.min(W * 0.28, W / 2 - DOOR_CORNER_M));
  const frontPool = lowers[1].pool;
  const doorway = buildDoorway(renderer, look, doorX, maxZ, Math.PI,
    frontPool ? { pool: frontPool, u: (cx - doorX) / W + 0.5, w: (DOOR_LEAF_W * 2 + ARCHITRAVE_W * 2) / W } : null);
  group.add(doorway.group);
  doorway.group.updateMatrixWorld(true);
  const door = { box: new THREE.Box3().setFromObject(doorway.group), stand: { x: doorX, z: maxZ - DOOR_STAND_M } };

  const doorHalf = DOOR_LEAF_W + ARCHITRAVE_W + WALL_LIGHT_CLEAR_M;
  const wallRuns = (l: RoomLook): WallRun[] => {
    const winHalf = windowWidth(D) / 2 + WALL_LIGHT_CLEAR_M;
    return [
      { x: cx, z: minZ, rotY: 0, len: W, keepOut: [] },
      { x: cx, z: maxZ, rotY: Math.PI, len: W, keepOut: [{ u0: cx - doorX - doorHalf, u1: cx - doorX + doorHalf, only: 'sconces' }] },
      { x: minX, z: cz, rotY: Math.PI / 2, len: D, keepOut: l.window === 'none' ? [] : [{ u0: -winHalf, u1: winHalf }] },
      { x: maxX, z: cz, rotY: -Math.PI / 2, len: D, keepOut: [] },
    ];
  };
  const lightsKey = (l: RoomLook): string =>
    `${l.ceiling}|${l.wallLights}|${l.window === 'none'}|${l.sconceShade}|${l.sconceMetal}|${l.wallLightStrength}`;
  let fixtures: ReturnType<typeof buildWallLights> | null = null;
  let lights = 0;
  const hangLights = (l: RoomLook): void => {
    const kind = wallFixture(l.ceiling, l.wallLights);
    const runs = wallRuns(l);
    const placed = placeWallLights(kind, { W, D, cx, cz }, CEILING, runs);
    if (fixtures) { group.remove(fixtures.group); fixtures.dispose(); }
    fixtures = buildWallLights(kind, placed, runs, CEILING, { shade: l.sconceShade, metal: l.sconceMetal, strength: l.wallLightStrength });
    group.add(fixtures.group);
    for (const [i, p] of placed.slice(0, Math.min(WASH_MAX, sw.lights)).entries()) {
      const r = runs[p.wall];
      const at = new THREE.Group();
      at.position.set(r.x, 0, r.z);
      at.rotation.y = r.rotY;
      const sl = new THREE.SpotLight(WASH_COLOUR, WASH_CANDELA, 7, WASH_ANGLE, 0.85, 2);
      sl.position.set(p.u, p.y, Math.max(p.off, 0.2));
      sl.target.position.set(p.u, 0.9, 0);
      at.add(sl, sl.target);
      fixtures.group.add(at);
      lights = i + 1;
    }
    const panelWash = !kind && l.ceiling === 'tiles';
    for (const t of ceilingShades) t.visible = !panelWash;
    pools.forEach((pl, i) => paintPool(pl.c, pl.w, kind, placed.filter((p) => p.wall === i), panelWash, l));
    const sources = new Set(pools.map((pl) => pl.tex.source));
    group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && !Array.isArray(m) && m.lightMap && sources.has(m.lightMap.source)) m.lightMap.needsUpdate = true;
    });
  };
  hangLights(look);

  const tubes: Tube[] = [];
  const tube = (len: number, col: string, x: number, z: number, rotY: number): void => {
    const mat = new THREE.MeshBasicMaterial({ color: col });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 8).rotateZ(Math.PI / 2), mat);
    m.position.set(x, CEILING - 0.25, z);
    m.rotation.y = rotY;
    group.add(m);
    m.visible = look.neonOn;
    tubes.push({ mat, len, base: new THREE.Color(col), chase: null, mesh: m, halo: null, haloMesh: null });
  };
  tube(W - 0.4, look.neon[0], cx, minZ + 0.04, 0);
  tube(W - 0.4, look.neon[1], cx, maxZ - 0.04, 0);
  tube(D - 0.4, look.neon[2], maxX - 0.04, cz, Math.PI / 2);
  const setChase = (on: boolean): void => {
    for (const t of tubes) {
      if (on && !t.chase) {
        t.chase = chasePattern().clone();
        t.chase.repeat.set(1, t.len / (CHASE_M * 2));
      }
      if (!on && t.chase) { t.chase.dispose(); t.chase = null; }
      if (t.mat.map !== t.chase) { t.mat.map = t.chase; t.mat.needsUpdate = true; }
    }
  };
  setChase(look.neonMotion === 'chase' || look.neonMotion === 'chase-back');

  let relief: THREE.DirectionalLight | null = null;
  if (sw.pools) {
    const down = new THREE.DirectionalLight(WASH_COLOUR, RELIEF_INTENSITY * ROOM_LIGHT);
    relief = down;
    down.position.set(cx + 0.01, CEILING + 6, cz + 0.02);
    down.target.position.set(cx, 0, cz);
    group.add(down, down.target);
  }

  group.add(new THREE.AmbientLight(0x6a5a66, 0.8 * ROOM_LIGHT));
  group.add(new THREE.HemisphereLight(0x3a4a80, 0x201014, 0.6 * ROOM_LIGHT));
  const key = new THREE.DirectionalLight(0xffe2c0, 0.8 * ROOM_LIGHT);
  key.position.set(cx + 2, CEILING + 2, maxZ);
  key.target.position.set(cx, 0, cz);
  group.add(key, key.target);

  let halosOn = false;
  let now = copyLook(look);
  const restyle = (next: RoomLook): void => {
    const wallPieces = (pieces: typeof lowers, kind: RoomLook['lower'] | RoomLook['upper'], was: string, tint: string, h: number, vOff: number): void => {
      for (const p of pieces) {
        const mat = p.m.material as THREE.MeshStandardMaterial;
        if (kind !== was) {
          p.m.material = surfaceMaterial(kind, p.w, h, renderer, tint, p.along, 0, vOff);
          poolOn(p);
          mat.dispose();
        } else {
          mat.color.set(tint);
          const phys = mat as THREE.MeshPhysicalMaterial;
          if (phys.isMeshPhysicalMaterial) phys.sheenColor.set(tint).multiplyScalar(0.6);
        }
      }
    };
    wallPieces(lowers, lowerKind(next), lowerKind(now), lowerTint(next), DADO, 0);
    wallPieces(uppers, next.upper, now.upper, next.upperColour, CEILING - DADO, DADO);
    for (const r of rails) r.visible = !fullHeight(next.upper);
    railMat.color.set(next.rail);
    for (const m of woods) { m.color.set(next.rail); m.emissive.copy(warmGlow(next.rail)); }
    const was = headMat;
    headMat = headMatOf(next);
    reveal.material = [leftUpper.material as THREE.Material, headMat, extMat];
    was.dispose();
    doorway.leafMat.color.set(next.rail);
    doorway.leafMat.emissive.set(next.rail);
    tubes.forEach((t, i) => { t.base.set(next.neon[i]); t.mat.color.copy(t.base); t.mesh.visible = next.neonOn; });
    if (halosOn) showHalos();
    if (next.window !== now.window) viewOn(next.window);
    if (lightsKey(next) !== lightsKey(now)) hangLights(next);
    if (ceilingKey(next) !== ceilingKey(now)) {
      group.remove(ceiling.group);
      ceiling.dispose();
      ceiling = buildCeiling(ceilingOf(next), W, D, cx, cz, CEILING, renderer);
      group.add(ceiling.group);
    }
    setChase(next.neonMotion === 'chase' || next.neonMotion === 'chase-back');
    if (next.carpet === 'neon' && (next.carpetGround !== now.carpetGround || next.carpetInks.join() !== now.carpetInks.join())) {
      tex.image = neonCanvas(next);
      tex.needsUpdate = true;
    }
    if (next.carpet !== now.carpet) {
      const was = carpet.material as THREE.Material;
      carpet.material = laid(next);
      if (was !== carpetMat) was.dispose();
    } else if (next.carpet !== 'neon') {
      const m = carpet.material as THREE.MeshStandardMaterial;
      m.color.set(next.carpetColour);
      m.emissive.set(next.carpetColour);
    }
    now = copyLook(next);
  };
  const dressing: Dressing = {
    group, box: { minX, maxX, minZ, maxZ, height: CEILING }, restyle, lights, door, motion: true, seenFrom, captureWindow,
    dispose(): void { winEnv?.dispose(); clearLayers(); headMat.dispose(); for (const t of extTextures.values()) t.dispose(); },
    backWall: { mesh: uppers[0].m, w: uppers[0].w, along: uppers[0].along, vOff: DADO, y0: DADO, h: CEILING - DADO },
    tick(t: number, eye?: THREE.Vector3): void {
      if (eye) seenFrom(eye);
      const mo = now.neonMotion;
      if (mo === 'still') return;
      const chasing = mo === 'chase' || mo === 'chase-back';
      if (!dressing.motion) {
        if (chasing && tubes.some((tb) => tb.chase)) setChase(false);
        for (const tb of tubes) tb.mat.color.copy(tb.base).multiplyScalar(dimK);
        return;
      }
      if (chasing && tubes.some((tb) => !tb.chase)) setChase(true);
      const ts = t * now.neonSpeed;
      tubes.forEach((tb, k) => {
        if (tb.chase) { tb.chase.offset.y = ((mo === 'chase' ? 1 : -1) * ts * CHASE_MPS) / (CHASE_M * 2); tb.mat.color.copy(tb.base).multiplyScalar(dimK); }
        else if (mo === 'pulse') tb.mat.color.copy(tb.base).multiplyScalar(dimK * (0.6 + 0.4 * Math.cos((ts / PULSE_S) * Math.PI * 2)));
        else if (mo === 'flicker') tb.mat.color.copy(tb.base).multiplyScalar(dimK * flickerAt(ts, k));
        else if (mo === 'cycle') {
          const hsl = { h: 0, s: 0, l: 0 };
          tb.base.getHSL(hsl);
          tb.mat.color.setHSL((hsl.h + ts / CYCLE_S) % 1, hsl.s, hsl.l).multiplyScalar(dimK);
        }
      });
      if (halosOn) showHalos();
    },
    dim(k: number): void {
      dimK = k;
      for (const l of lightsBase) l.light.intensity = l.base * k;
      dimMaterials(group, k);
      for (const tb of tubes) tb.mat.color.copy(tb.base).multiplyScalar(k);
      glassLevel = k;
      glassMat.uniforms.level.value = k;
      if (halosOn) showHalos();
    },
    setRealism,
    floor: carpet,
  };
  const lightsBase: { light: THREE.Light; base: number }[] = [];
  group.traverse((o) => { const l = o as THREE.Light; if (l.isLight) lightsBase.push({ light: l, base: l.intensity }); });
  let dimK = 1;
  return dressing;

  function showHalos(): void {
    for (const t of tubes) {
      if (!t.halo || !t.haloMesh) continue;
      t.halo.color.copy(t.mat.color).multiplyScalar(1 / Math.max(dimK, 1e-3));
      t.haloMesh.visible = t.mesh.visible;
    }
  }

  function makeHalos(): void {
    const ramp = haloRamp();
    tubes.forEach((t) => {
      const mat = new THREE.MeshBasicMaterial({
        map: ramp, transparent: true, opacity: HALO_LEVEL, depthWrite: false, blending: THREE.AdditiveBlending,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      });
      t.halo = mat;
      const yaw = t.mesh.rotation.y;
      const into = (cx - t.mesh.position.x) * Math.sin(yaw) + (cz - t.mesh.position.z) * Math.cos(yaw) > 0 ? 1 : -1;
      const at = new THREE.Group();
      at.position.copy(t.mesh.position);
      at.rotation.y = yaw;
      const h = HALO_WALL_M + 0.25;
      const wallStrip = new THREE.Mesh(new THREE.PlaneGeometry(t.len + 0.5, h), mat);
      wallStrip.position.set(0, 0.25 - h / 2, -into * 0.03);
      wallStrip.rotation.y = into > 0 ? 0 : Math.PI;
      at.add(wallStrip);
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(t.len + 0.5, HALO_CEILING_M), mat);
      ceil.rotation.order = 'YXZ';
      ceil.rotation.y = into > 0 ? Math.PI : 0;
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(0, 0.25 - 0.006, into * (HALO_CEILING_M / 2 - 0.04));
      at.add(ceil);
      group.add(at);
      t.haloMesh = at;
    });
    dimMaterials(group, dimK);
  }

  function setRealism(o: { shadow: boolean; halos: boolean; picture?: boolean }): void {
    const caster = relief ?? key;
    const casting = caster.castShadow;
    const lean = o.shadow && !o.picture;
    const up = caster.position.y - caster.target.position.y;
    if (caster === relief) {
      caster.position.x = caster.target.position.x + (lean ? REALISM_LEAN_X * up : 0.01);
      caster.position.z = caster.target.position.z + (lean ? REALISM_LEAN_Z * up : 0.02);
    }
    if (o.shadow && !casting) fitShadow(caster, { minX, maxX, minZ, maxZ });
    caster.castShadow = o.shadow;
    carpet.receiveShadow = o.shadow;
    caster.shadow.intensity = o.picture ? 0 : 1;
    if (!o.shadow && casting && caster.shadow.map) { caster.shadow.dispose(); caster.shadow.map = null; }
    if (o.halos && !tubes[0].halo) makeHalos();
    halosOn = o.halos && !o.picture;
    if (halosOn) showHalos();
    else for (const t of tubes) if (t.haloMesh) t.haloMesh.visible = false;
  }
}

let haloTex: THREE.Texture | null = null;
function haloRamp(): THREE.Texture {
  if (!haloTex) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    const v = g.createLinearGradient(0, 0, 0, 64);
    v.addColorStop(0, '#fff');
    v.addColorStop(0.25, '#777');
    v.addColorStop(0.6, '#1c1c1c');
    v.addColorStop(1, '#000');
    g.fillStyle = v;
    g.fillRect(0, 0, 64, 64);
    g.globalCompositeOperation = 'multiply';
    const h = g.createLinearGradient(0, 0, 64, 0);
    h.addColorStop(0, '#000');
    h.addColorStop(0.03, '#fff');
    h.addColorStop(0.97, '#fff');
    h.addColorStop(1, '#000');
    g.fillStyle = h;
    g.fillRect(0, 0, 64, 64);
    haloTex = new THREE.CanvasTexture(c);
    haloTex.colorSpace = THREE.SRGBColorSpace;
  }
  return haloTex;
}

function fitShadow(light: THREE.DirectionalLight, b: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
  const view = new THREE.Matrix4().lookAt(light.position, light.target.position, new THREE.Vector3(0, 1, 0)).setPosition(light.position).invert();
  const cam = light.shadow.camera;
  let l = Infinity, r = -Infinity, t = -Infinity, u = Infinity, near = Infinity, far = -Infinity;
  for (const x of [b.minX, b.maxX]) for (const y of [0, SHADOW_TOP_M]) for (const z of [b.minZ, b.maxZ]) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(view);
    l = Math.min(l, p.x); r = Math.max(r, p.x);
    u = Math.min(u, p.y); t = Math.max(t, p.y);
    near = Math.min(near, -p.z); far = Math.max(far, -p.z);
  }
  cam.left = l; cam.right = r; cam.top = t; cam.bottom = u;
  cam.near = Math.max(0.1, near - 0.5);
  cam.far = far + 0.5;
  cam.updateProjectionMatrix();
  light.shadow.mapSize.set(SHADOW_PX, SHADOW_PX);
  light.shadow.bias = -0.0006;
  light.shadow.normalBias = 0.015;
  light.shadow.radius = 4;
}

let poolTex: THREE.Texture | null = null;

export function lightPool(): THREE.Mesh {
  if (!poolTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,236,210,1)');
    r.addColorStop(0.5, 'rgba(255,236,210,0.35)');
    r.addColorStop(1, 'rgba(255,236,210,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    poolTex = new THREE.CanvasTexture(c);
    poolTex.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.0).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: poolTex, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  m.position.set(0, 0.004, 0.75);
  return m;
}

let shadeTex: THREE.Texture | null = null;
function shadeRamp(): THREE.Texture {
  if (!shadeTex) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 128, 0, 0);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      grad.addColorStop(t, `rgba(0,0,0,${(1 - t) ** 2.2})`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 128);
    shadeTex = new THREE.CanvasTexture(c);
  }
  return shadeTex;
}

function mouldingMaterial(tint: THREE.ColorRepresentation, upright: boolean): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8c8c8';
  g.fillRect(0, 0, c.width, c.height);
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const y = rnd() * c.height;
    const shade = Math.round(160 + rnd() * 70);
    g.strokeStyle = `rgba(${shade},${shade},${shade},0.35)`;
    g.lineWidth = 0.5 + rnd() * 1.5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 32; x <= c.width; x += 32) g.lineTo(x, y + (rnd() - 0.5) * 1.5);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.center.set(0.5, 0.5);
  if (upright) t.rotation = Math.PI / 2;
  return new THREE.MeshStandardMaterial({
    color: tint, map: t, roughness: 0.55, metalness: 0, emissive: tint, emissiveMap: t, emissiveIntensity: DOOR_GLOW,
  });
}

function blindSlats(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  const per = 32;
  c.width = 8;
  c.height = per * BLIND_SLATS_PER_TILE;
  const g = c.getContext('2d')!;
  for (let i = 0; i < BLIND_SLATS_PER_TILE; i++) {
    const y = i * per;
    const r = g.createLinearGradient(0, y, 0, y + per);
    r.addColorStop(0, '#ffffff');
    r.addColorStop(0.6, '#d6d6d6');
    r.addColorStop(0.92, '#9a9a9a');
    r.addColorStop(1, '#3a3a3a');
    g.fillStyle = r;
    g.fillRect(0, y, c.width, per);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function frostFrom(img: CanvasImageSource & { width: number; height: number }): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 12;
  c.height = 6;
  const g = c.getContext('2d')!;
  g.drawImage(img, img.width / 3, img.height * 0.36, img.width / 3, img.height * 0.28, 0, 0, c.width, c.height);
  g.fillStyle = 'rgba(205,212,222,0.28)';
  g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

function holedPlane(w: number, h: number, hole: { x: number; w: number; y0: number; y1: number }): THREE.BufferGeometry {
  const shape = new THREE.Shape([
    new THREE.Vector2(-w / 2, -h / 2), new THREE.Vector2(w / 2, -h / 2),
    new THREE.Vector2(w / 2, h / 2), new THREE.Vector2(-w / 2, h / 2),
  ]);
  const x0 = hole.x - hole.w / 2, x1 = hole.x + hole.w / 2;
  shape.holes.push(new THREE.Path([
    new THREE.Vector2(x0, hole.y0), new THREE.Vector2(x0, hole.y1),
    new THREE.Vector2(x1, hole.y1), new THREE.Vector2(x1, hole.y0),
  ]));
  const g = new THREE.ShapeGeometry(shape);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  uv.needsUpdate = true;
  return g;
}

function shadeStrip(len: number, reach: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(len, reach),
    new THREE.MeshBasicMaterial({
      map: shadeRamp(), transparent: true, opacity: SHADE_MAX, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  );
}

function shadeWall(group: THREE.Group, w: number, x: number, z: number, rotY: number, hole?: { x: number; w: number; y0: number; y1: number }): THREE.Object3D {
  const on = new THREE.Group();
  on.position.set(x, 0, z);
  on.rotation.y = rotY;
  on.translateZ(0.004);
  const top = shadeStrip(w, SHADE_CEILING_M);
  top.rotation.z = Math.PI;
  top.position.set(0, CEILING - SHADE_CEILING_M / 2, 0);
  const bottom = shadeStrip(w, SHADE_FLOOR_M);
  bottom.position.set(0, SHADE_FLOOR_M / 2, 0);
  const left = shadeStrip(CEILING, SHADE_CORNER_M);
  left.rotation.z = -Math.PI / 2;
  left.position.set(-w / 2 + SHADE_CORNER_M / 2, CEILING / 2, 0);
  const right = shadeStrip(CEILING, SHADE_CORNER_M);
  right.rotation.z = Math.PI / 2;
  right.position.set(w / 2 - SHADE_CORNER_M / 2, CEILING / 2, 0);
  if (hole) for (const m of [top, bottom, left, right]) cutStrip(m, hole);
  on.add(top, bottom, left, right);
  group.add(on);
  return top;
}

function cutStrip(m: THREE.Mesh, hole: { x: number; w: number; y0: number; y1: number }): void {
  const g = m.geometry as THREE.PlaneGeometry;
  const { width: sw, height: sh } = g.parameters;
  const c = Math.cos(-m.rotation.z), sn = Math.sin(-m.rotation.z);
  const local = (px: number, py: number): [number, number] => {
    const dx = px - m.position.x, dy = py - m.position.y;
    return [dx * c - dy * sn, dx * sn + dy * c];
  };
  const a = local(hole.x - hole.w / 2, hole.y0), b = local(hole.x + hole.w / 2, hole.y1);
  const x0 = Math.max(Math.min(a[0], b[0]), -sw / 2), x1 = Math.min(Math.max(a[0], b[0]), sw / 2);
  const y0 = Math.max(Math.min(a[1], b[1]), -sh / 2), y1 = Math.min(Math.max(a[1], b[1]), sh / 2);
  if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return;
  m.geometry = framedPlane(sw, sh, x0, x1, y0, y1);
  g.dispose();
}

function framedPlane(w: number, h: number, x0: number, x1: number, y0: number, y1: number): THREE.BufferGeometry {
  const L = -w / 2, R = w / 2, B = -h / 2, T = h / 2;
  const rects: [number, number, number, number][] = [[L, R, y1, T], [L, R, B, y0], [L, x0, y0, y1], [x1, R, y0, y1]];
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const [ax, bx, ay, by] of rects) {
    if (bx - ax < 1e-6 || by - ay < 1e-6) continue;
    const k = pos.length / 3;
    for (const [px, py] of [[ax, ay], [bx, ay], [bx, by], [ax, by]]) { pos.push(px, py, 0); uv.push(px / w + 0.5, py / h + 0.5); }
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function shadeFloor(group: THREE.Group, b: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
  const W = b.maxX - b.minX;
  const D = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const lay = (len: number, x: number, z: number, yaw: number): void => {
    const m = shadeStrip(len, SHADE_CARPET_M);
    m.rotation.order = 'YXZ';
    m.rotation.y = yaw;
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.003, z);
    group.add(m);
  };
  lay(W, cx, b.minZ + SHADE_CARPET_M / 2, Math.PI);
  lay(W, cx, b.maxZ - SHADE_CARPET_M / 2, 0);
  lay(D, b.minX + SHADE_CARPET_M / 2, cz, -Math.PI / 2);
  lay(D, b.maxX - SHADE_CARPET_M / 2, cz, Math.PI / 2);
}
