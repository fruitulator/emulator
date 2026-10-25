import { windowWidth } from './floor';
import * as THREE from 'three';
import { surfaceMaterial } from './roomtextures';
import viewHarbour from './views/harbour.jpg?url';
import viewSquare from './views/square.jpg?url';
import viewOldtown from './views/oldtown.jpg?url';
import { copyLook, HOUSE_LOOK, type RoomLook } from './roomlook';
import { VIEW_EYE_DEFAULT, viewParallax } from './windowview';
import { str } from '../web/i18n';

const CEILING = 3.1;
const MARGIN_SIDE = 2.4;
const MARGIN_BACK = 0.35;
const MARGIN_FRONT = 2.6;
const DADO = 1.0;
const RAIL_H = 0.06;
const RAIL_D = 0.03;
const SHADE_CORNER_M = 0.7;
const SHADE_CEILING_M = 0.9;
const SHADE_FLOOR_M = 0.35;
const SHADE_CARPET_M = 0.6;
const SHADE_MAX = 0.55;

const POOL_PX_M = 48;
const POOL_INTENSITY = 4;
const RELIEF_INTENSITY = 1.6;
const POOL_FOOT_M = 0.75;

function poolMap(w: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = Math.max(16, Math.round(w * POOL_PX_M));
  c.height = Math.round(CEILING * POOL_PX_M);
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'lighter';
  const col = new THREE.Color(WASH_COLOUR).lerp(new THREE.Color(0xffffff), 0.35);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  const n = Math.max(1, Math.round(w / WASH_EVERY_M));
  const blob = (x: number, y: number, rx: number, ry: number, a: number): void => {
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    r.addColorStop(0, `rgba(${rgb},${a})`);
    r.addColorStop(0.45, `rgba(${rgb},${a * 0.45})`);
    r.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = r;
    g.fillRect(-rx, -rx, rx * 2, rx * 2);
    g.restore();
  };
  const m = POOL_PX_M;
  const foot = (CEILING - POOL_FOOT_M) * m;
  g.filter = `blur(${Math.round(0.06 * m)}px)`;
  const bell = (x: number, k: number, a: number): void => {
    const half = (y: number): number => (0.18 + 0.8 * Math.pow(Math.sin(Math.min(1, Math.max(0, y) / foot) * Math.PI / 2), 0.75)) * m * k;
    g.beginPath();
    g.moveTo(x, 0.05 * m);
    for (let y = 0.05 * m; y <= foot; y += 2) g.lineTo(x + half(y), y);
    g.ellipse(x, foot, half(foot), 0.4 * m * k, 0, 0, Math.PI);
    for (let y = foot; y >= 0.05 * m; y -= 2) g.lineTo(x - half(y), y);
    g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, foot + 0.4 * m);
    grad.addColorStop(0, `rgba(${rgb},${a})`);
    grad.addColorStop(0.35, `rgba(${rgb},${a * 0.75})`);
    grad.addColorStop(1, `rgba(${rgb},${a * 0.4})`);
    g.fillStyle = grad;
    g.fill();
  };
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * c.width;
    for (const [k, a] of [[1, 0.28], [0.8, 0.28], [0.6, 0.28], [0.4, 0.25]] as const) bell(x, k, a);
  }
  g.filter = 'none';
  for (let i = 0; i < n; i++) blob(((i + 0.5) / n) * c.width, 0.25 * m, 0.35 * m, 0.4 * m, 0.7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const WASH_EVERY_M = 3.2;
const WASH_OFF_M = 0.45;
const WASH_MAX = 12;
const WASH_COLOUR = 0xffd2a0;
const WASH_CANDELA = 9;
const WASH_ANGLE = 0.8;

const CARPET_GLOW = 0.35;

const CARPET_TILE_M = 2.0;

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

const VIEWS: Record<RoomLook['window'], string> = { harbour: viewHarbour, square: viewSquare, oldtown: viewOldtown };
const viewLoader = new THREE.TextureLoader();

export interface Dressing {
  group: THREE.Group;
  box: { minX: number; maxX: number; minZ: number; maxZ: number; height: number };
  restyle(look: RoomLook): void;
  lights: number;
  door: { box: THREE.Box3; stand: { x: number; z: number } };
  tick(t: number, eye?: THREE.Vector3): void;
  motion: boolean;
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

interface Tube { mat: THREE.MeshBasicMaterial; len: number; base: THREE.Color; chase: THREE.Texture | null; mesh: THREE.Mesh }

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
    grad.addColorStop(0.62, '#4a4a4a');
    grad.addColorStop(1, '#262626');
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
      m.lightMapIntensity = POOL_INTENSITY;
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
  sw: { lights: number; shade: boolean; pools: boolean } = { lights: 0, shade: true, pools: true },
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
    : surfaceMaterial(l.carpet, W, D, renderer, l.carpetColour, 0, CARPET_GLOW));
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), laid(look));
  carpet.position.set(cx, 0, cz);
  group.add(carpet);

  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.7 });
  const railMat = surfaceMaterial('wood', 4, 0.06, renderer, look.rail);
  type Piece = { m: THREE.Mesh; w: number; along: number; pool: THREE.Texture | null; v0: number; v1: number };
  const lowers: Piece[] = [];
  const uppers: Piece[] = [];
  const poolOn = (p: Piece): void => {
    if (!p.pool) return;
    const t = p.pool.clone();
    t.repeat.set(1, p.v1 - p.v0);
    t.offset.set(0, p.v0);
    const mat = p.m.material as THREE.MeshStandardMaterial;
    mat.lightMap = t;
    mat.lightMapIntensity = POOL_INTENSITY;
    mat.needsUpdate = true;
  };
  let along = 0;
  let lights = 0;
  const wall = (w: number, x: number, z: number, rotY: number): void => {
    const piece = (h: number, y: number, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      group.add(m);
      return m;
    };
    const pool = sw.pools ? poolMap(w) : null;
    const low: Piece = { m: piece(DADO, DADO / 2, surfaceMaterial(look.lower, w, DADO, renderer, look.lowerColour, along)), w, along, pool, v0: 0, v1: DADO / CEILING };
    const up: Piece = {
      m: piece(CEILING - DADO, (CEILING + DADO) / 2, surfaceMaterial(look.upper, w, CEILING - DADO, renderer, look.upperColour, along)),
      w, along, pool, v0: DADO / CEILING, v1: 1,
    };
    poolOn(low);
    poolOn(up);
    lowers.push(low);
    uppers.push(up);
    along += w;
    const ledge = (h: number, d: number, y: number, mat: THREE.Material): void => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      s.position.set(x, y, z);
      s.rotation.y = rotY;
      s.translateZ(d / 2);
      group.add(s);
    };
    ledge(0.12, 0.02, 0.06, skirtMat);
    ledge(RAIL_H, RAIL_D, DADO, railMat);
    if (sw.shade) shadeWall(group, w, x, z, rotY);
    const n = Math.max(1, Math.round(w / WASH_EVERY_M));
    for (let i = 0; i < n && lights < Math.min(WASH_MAX, sw.lights); i++, lights++) {
      const u = -w / 2 + (w * (i + 0.5)) / n;
      const at = new THREE.Group();
      at.position.set(x, 0, z);
      at.rotation.y = rotY;
      group.add(at);
      const l = new THREE.SpotLight(WASH_COLOUR, WASH_CANDELA, 7, WASH_ANGLE, 0.85, 2);
      l.position.set(u, CEILING - 0.08, WASH_OFF_M);
      l.target.position.set(u, 0.9, 0);
      at.add(l, l.target);
    }
  };
  wall(W, cx, minZ, 0);
  wall(W, cx, maxZ, Math.PI);
  wall(D, minX, cz, Math.PI / 2);
  wall(D, maxX, cz, -Math.PI / 2);
  if (sw.shade) shadeFloor(group, box);

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0c0b0d, roughness: 1 }),
  );
  ceil.position.set(cx, CEILING, cz);
  group.add(ceil);

  const winW = windowWidth(D);
  const winH = 1.2;
  const winY = 1.55;
  const winZ = cz;
  const paneMat = new THREE.MeshBasicMaterial({ color: 0x0a0c14 });
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), paneMat);
  pane.position.set(minX + 0.01, winY, winZ);
  pane.rotation.y = Math.PI / 2;
  group.add(pane);
  const viewEye = new THREE.Vector3(VIEW_EYE_DEFAULT.x, VIEW_EYE_DEFAULT.y, VIEW_EYE_DEFAULT.z);
  const aimView = (): void => {
    const t = paneMat.map;
    if (!t) return;
    const img = t.image as { width: number; height: number };
    const p = viewParallax(viewEye, { w: winW, h: winH }, img.width / img.height);
    t.repeat.set(p.repeat[0], p.repeat[1]);
    t.offset.set(p.offset[0], p.offset[1]);
  };
  const viewOn = (v: RoomLook['window']): void => {
    viewLoader.load(VIEWS[v], (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      paneMat.map?.dispose();
      paneMat.map = t;
      paneMat.color.set(0xffffff);
      paneMat.needsUpdate = true;
      aimView();
    });
  };
  viewOn(look.window);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.6 });
  const bar = (w: number, h: number, y: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, w), frameMat);
    m.position.set(minX + 0.03, y, z);
    group.add(m);
  };
  bar(winW + 0.12, 0.06, winY + winH / 2, winZ);
  bar(winW + 0.12, 0.08, winY - winH / 2, winZ);
  bar(0.06, winH, winY, winZ - winW / 2);
  bar(0.06, winH, winY, winZ + winW / 2);
  bar(0.04, winH, winY, winZ);
  bar(winW, 0.04, winY + winH * 0.1, winZ);

  const doorX = doorAt ?? cx + Math.max(0, Math.min(W * 0.28, W / 2 - DOOR_CORNER_M));
  const frontPool = lowers[1].pool;
  const doorway = buildDoorway(renderer, look, doorX, maxZ, Math.PI,
    frontPool ? { pool: frontPool, u: (cx - doorX) / W + 0.5, w: (DOOR_LEAF_W * 2 + ARCHITRAVE_W * 2) / W } : null);
  group.add(doorway.group);
  doorway.group.updateMatrixWorld(true);
  const door = { box: new THREE.Box3().setFromObject(doorway.group), stand: { x: doorX, z: maxZ - DOOR_STAND_M } };

  const tubes: Tube[] = [];
  const tube = (len: number, col: string, x: number, z: number, rotY: number): void => {
    const mat = new THREE.MeshBasicMaterial({ color: col });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 8).rotateZ(Math.PI / 2), mat);
    m.position.set(x, CEILING - 0.25, z);
    m.rotation.y = rotY;
    group.add(m);
    m.visible = look.neonOn;
    tubes.push({ mat, len, base: new THREE.Color(col), chase: null, mesh: m });
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

  if (sw.pools) {
    const down = new THREE.DirectionalLight(WASH_COLOUR, RELIEF_INTENSITY);
    down.position.set(cx + 0.01, CEILING + 6, cz + 0.02);
    down.target.position.set(cx, 0, cz);
    group.add(down, down.target);
  }

  group.add(new THREE.AmbientLight(0x6a5a66, 0.8));
  group.add(new THREE.HemisphereLight(0x3a4a80, 0x201014, 0.6));
  const key = new THREE.DirectionalLight(0xffe2c0, 0.8);
  key.position.set(cx + 2, CEILING + 2, maxZ);
  key.target.position.set(cx, 0, cz);
  group.add(key, key.target);

  let now = copyLook(look);
  const restyle = (next: RoomLook): void => {
    const wallPieces = (pieces: typeof lowers, kind: RoomLook['lower'] | RoomLook['upper'], was: string, tint: string, h: number): void => {
      for (const p of pieces) {
        const mat = p.m.material as THREE.MeshStandardMaterial;
        if (kind !== was) {
          p.m.material = surfaceMaterial(kind, p.w, h, renderer, tint, p.along);
          poolOn(p);
          mat.dispose();
        } else mat.color.set(tint);
      }
    };
    wallPieces(lowers, next.lower, now.lower, next.lowerColour, DADO);
    wallPieces(uppers, next.upper, now.upper, next.upperColour, CEILING - DADO);
    railMat.color.set(next.rail);
    doorway.leafMat.color.set(next.rail);
    doorway.leafMat.emissive.set(next.rail);
    tubes.forEach((t, i) => { t.base.set(next.neon[i]); t.mat.color.copy(t.base); t.mesh.visible = next.neonOn; });
    if (next.window !== now.window) viewOn(next.window);
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
    group, box: { minX, maxX, minZ, maxZ, height: CEILING }, restyle, lights, door, motion: true,
    tick(t: number, eye?: THREE.Vector3): void {
      if (eye) {
        pane.updateWorldMatrix(true, false);
        pane.worldToLocal(viewEye.copy(eye));
        aimView();
      }
      const mo = now.neonMotion;
      if (mo === 'still') return;
      if (!dressing.motion) {
        for (const tb of tubes) tb.mat.color.copy(tb.base).multiplyScalar(dimK);
        return;
      }
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
    },
    dim(k: number): void {
      dimK = k;
      for (const l of lightsBase) l.light.intensity = l.base * k;
      dimMaterials(group, k);
      for (const tb of tubes) tb.mat.color.copy(tb.base).multiplyScalar(k);
    },
  };
  const lightsBase: { light: THREE.Light; base: number }[] = [];
  group.traverse((o) => { const l = o as THREE.Light; if (l.isLight) lightsBase.push({ light: l, base: l.intensity }); });
  let dimK = 1;
  return dressing;
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

function shadeStrip(len: number, reach: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(len, reach),
    new THREE.MeshBasicMaterial({
      map: shadeRamp(), transparent: true, opacity: SHADE_MAX, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  );
}

function shadeWall(group: THREE.Group, w: number, x: number, z: number, rotY: number): void {
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
  on.add(top, bottom, left, right);
  group.add(on);
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
