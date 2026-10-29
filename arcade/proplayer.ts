import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import barStool from './props/bar_chair_round_01.glb?url';
import metalStool from './props/metal_stool_01.glb?url';
import plantTall from './props/potted_plant_01.glb?url';
import plantWide from './props/potted_plant_02.glb?url';
import chalkboard from './props/standing_chalkboard_01.glb?url';
import wetFloor from './props/WetFloorSign_01.glb?url';
import bin from './props/trashcan_cylindric.glb?url';
import sofa from './props/sofa_02.glb?url';
import ottoman from './props/Ottoman_01.glb?url';
import armchair from './props/modern_arm_chair_01.glb?url';
import bench from './props/painted_wooden_bench.glb?url';
import posTable from './props/round_wooden_table_01.glb?url';
import coffeeTable from './props/coffee_table_round_01.glb?url';
import { surfaceMaterial } from './roomtextures';
import {
  CIG_MACHINE_D, CIG_MACHINE_H, CIG_MACHINE_W, CIG_MACHINE_Y0, footprintAt, posterArt, POSTER_FRAME, POSTER_H, POSTER_Y, PROP_WALL_GAP, propFootprint,
  propKind, propOnWall, type PosterArt, type Prop, type PropKind,
} from './proplist';
import { POSTER_URLS } from './posterurls';

type Modelled = Exclude<PropKind, 'poster' | 'cigMachine'>;
const URLS: Record<Modelled, string> = {
  barStool, metalStool, plantTall, plantWide, chalkboard, wetFloor, bin, sofa, ottoman, armchair, bench, posTable, coffeeTable,
};

const posterLoader = new THREE.TextureLoader();
const posterMaps = new Map<PosterArt, THREE.Texture>();
const POSTER_DEPTH = 0.025;
let posterFrameMat: THREE.MeshStandardMaterial | null = null;

export function posterUrl(a: PosterArt): string {
  return POSTER_URLS[a];
}

function posterObject(art: PosterArt): THREE.Object3D {
  const a = posterArt(art);
  const w = POSTER_H * a.aspect;
  let map = posterMaps.get(a.id);
  if (!map) {
    map = posterLoader.load(POSTER_URLS[a.id]);
    map.colorSpace = THREE.SRGBColorSpace;
    posterMaps.set(a.id, map);
  }
  posterFrameMat ??= new THREE.MeshStandardMaterial({ color: 0x1c140e, roughness: 0.55 });
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + POSTER_FRAME * 2, POSTER_H + POSTER_FRAME * 2, POSTER_DEPTH), posterFrameMat);
  frame.position.z = POSTER_DEPTH / 2;
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, POSTER_H), new THREE.MeshStandardMaterial({ map, roughness: 0.85 }));
  pic.position.z = POSTER_DEPTH + 0.001;
  g.add(frame, pic);
  return g;
}

let cigMats: {
  header: THREE.MeshStandardMaterial; backlight: THREE.MeshStandardMaterial; chrome: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial; slot: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial; coin: THREE.MeshStandardMaterial;
  lampOff: THREE.MeshStandardMaterial; lampOn: THREE.MeshStandardMaterial;
  packs: { front: THREE.MeshStandardMaterial; side: THREE.MeshStandardMaterial }[];
} | null = null;
let cigBodyMat: THREE.MeshStandardMaterial | null = null;
const CIG_WALNUT = 0x9a6640;

type PackMark = 'oval' | 'split' | 'pinstripe' | 'diamond' | 'deckchair' | 'wave' | 'glow' | 'sash' | 'star';
const PACK_BRANDS: { name: string; line: string; ground: string; mark: PackMark; markInk: string; ink: string }[] = [
  { name: 'GOLDEN LUNG', line: 'KING SIZE', ground: '#6e1f2c', mark: 'glow', markInk: '#f08a2a', ink: '#f6e6c8' },
  { name: 'LIT STREAK', line: 'FILTER', ground: '#4a5560', mark: 'sash', markInk: '#e9725e', ink: '#ffffff' },
  { name: 'TAR TRAIL', line: 'KING SIZE', ground: '#2e2b27', mark: 'wave', markInk: '#c9a95a', ink: '#efe6cc' },
  { name: 'REEL LUNGS', line: 'FILTER', ground: '#f2ead6', mark: 'deckchair', markInk: '#2a3f7a', ink: '#2a3f7a' },
  { name: 'CHERRY MILD', line: 'FILTER', ground: '#8a1a28', mark: 'oval', markInk: '#f3e6cc', ink: '#8a1a28' },
  { name: 'WIN SPINNER', line: 'KING SIZE', ground: '#4f74c4', mark: 'star', markInk: '#ffffff', ink: '#ffffff' },
  { name: 'CASH COUGH', line: 'KING SIZE', ground: '#1f6b3a', mark: 'pinstripe', markInk: '#d9c27a', ink: '#f6ecd8' },
  { name: 'BELL ENDS', line: 'MILD', ground: '#b9a77a', mark: 'diamond', markInk: '#5a3b1e', ink: '#5a3b1e' },
];

function packFront(b: (typeof PACK_BRANDS)[number]): THREE.Texture {
  const W = 128, H = 164;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = b.ground;
  g.fillRect(0, 0, W, H);
  g.fillStyle = b.markInk;
  g.strokeStyle = b.markInk;
  let nameY = 92;
  switch (b.mark) {
    case 'oval':
      g.beginPath(); g.ellipse(W / 2, 88, 54, 34, 0, 0, Math.PI * 2); g.fill();
      g.lineWidth = 3; g.beginPath(); g.ellipse(W / 2, 88, 60, 40, 0, 0, Math.PI * 2); g.stroke();
      break;
    case 'split':
      g.fillRect(0, 0, W, 104);
      g.fillRect(0, 110, W, 4);
      nameY = 84;
      break;
    case 'pinstripe':
      for (const y of [26, 34, 42, 128, 136, 144]) g.fillRect(0, y, W, 3);
      break;
    case 'diamond':
      g.beginPath(); g.moveTo(W / 2, 40); g.lineTo(W - 12, 90); g.lineTo(W / 2, 140); g.lineTo(12, 90); g.closePath();
      g.lineWidth = 4; g.stroke();
      break;
    case 'deckchair':
      for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 16, H);
      g.fillStyle = b.ground; g.fillRect(10, 64, W - 20, 52);
      break;
    case 'wave':
      g.lineWidth = 6;
      for (const y0 of [36, 132]) {
        g.beginPath();
        for (let x = 0; x <= W; x += 4) g.lineTo(x, y0 + Math.sin((x / W) * Math.PI * 3) * 7);
        g.stroke();
      }
      break;
    case 'glow': {
      const r = g.createRadialGradient(W / 2, 46, 4, W / 2, 46, 40);
      r.addColorStop(0, '#ffd27a'); r.addColorStop(0.6, b.markInk); r.addColorStop(1, b.ground);
      g.fillStyle = r; g.fillRect(0, 0, W, 96);
      nameY = 116;
      break;
    }
    case 'sash':
      g.beginPath(); g.moveTo(0, 30); g.lineTo(W, 70); g.lineTo(W, 98); g.lineTo(0, 58); g.closePath(); g.fill();
      nameY = 124;
      break;
    case 'star': {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? 9 : 22;
        g.lineTo(W / 2 + Math.cos(a) * rr, 44 + Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
      nameY = 104;
      break;
    }
  }
  g.fillStyle = b.ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const words = b.name.split(' ');
  let size = 24;
  const widest = (): number => Math.max(...words.map((w) => g.measureText(w).width));
  do { g.font = `bold ${size}px Georgia, 'Times New Roman', serif`; size--; } while (widest() > W - 30 && size > 10);
  const lead = size + 3;
  const top = nameY - ((words.length - 1) * lead) / 2;
  words.forEach((w, i) => g.fillText(w, W / 2, top + i * lead));
  g.font = "bold 11px 'Helvetica Neue', Arial, sans-serif";
  g.fillText(b.line, W / 2, top + (words.length - 1) * lead + 22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export type CigPart = { kind: 'coin' } | { kind: 'reject' } | { kind: 'knob'; knob: number } | { kind: 'body' };

interface CigRig {
  knobs: { mesh: THREE.Mesh; z: number }[];
  coin: THREE.Mesh;
  pack: THREE.Mesh;
  lamp: THREE.Mesh;
  credit: number;
  coinT0: number | null;
  vend: { t0: number; knob: number; brand: number; cued: number } | null;
}

const VEND_COIN_S = 0.35;
const VEND_PULL_S = 0.5;
const VEND_DROP_AT_S = 0.55;
const VEND_DROP_S = 0.4;
const VEND_TAKE_AT_S = 3.95;
const VEND_TAKE_S = 0.3;
const KNOB_PULL_M = 0.04;
const KNOB_DRY = 0.2;
const PACK_W = 0.055, PACK_H = 0.085, PACK_D = 0.022;

const CIG_HEADER = { x: -0.065, y: 0.765, w: 0.53, h: 0.19 };
const CIG_COIN_PLATE = { x: 0.275, y: 0.765, w: 0.11, h: 0.19 };
const CIG_WINDOW = { y: 0.52, h: 0.15, w: 0.67 };
const CIG_PITCH = 0.072;
const cigPackX = (i: number): number => (i - (PACK_BRANDS.length - 1) / 2) * CIG_PITCH;
const CIG_KNOB_Y = 0.38;
const CIG_CHUTE_Y = 0.27;
const CIG_TRAY_FLOOR = 0.06;
const CIG_TRAY_DEPTH = 0.1;
const CIG_TRAY_LIP = 0.03;
const COIN_SLOT_X = CIG_COIN_PLATE.x;
const COIN_SLOT_Y = CIG_COIN_PLATE.y + 0.035;
const COIN_R = 0.0123;

const CIG_HEADER_WORD = 'CIGARETTES';

function headerFront(): THREE.Texture {
  const W = 512, H = 184;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const ground = g.createLinearGradient(0, 0, 0, H);
  ground.addColorStop(0, '#5a1414');
  ground.addColorStop(0.5, '#7a1c1a');
  ground.addColorStop(1, '#4a1010');
  g.fillStyle = ground;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#d8b25a';
  g.lineWidth = 4;
  g.strokeRect(12, 12, W - 24, H - 24);
  g.lineWidth = 1.5;
  g.strokeRect(22, 22, W - 44, H - 44);
  g.fillStyle = '#f3e6c4';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 72;
  do { g.font = `bold ${size}px Georgia, 'Times New Roman', serif`; size--; } while (g.measureText(CIG_HEADER_WORD).width > W - 80 && size > 20);
  g.fillText(CIG_HEADER_WORD, W / 2, H / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function cigMachineObject(renderer?: THREE.WebGLRenderer): { root: THREE.Object3D; rig: CigRig } {
  const W = CIG_MACHINE_W, H = CIG_MACHINE_H, D = CIG_MACHINE_D;
  if (!cigMats) {
    const word = headerFront();
    cigMats = {
      header: new THREE.MeshStandardMaterial({ map: word, emissive: 0xffffff, emissiveMap: word, emissiveIntensity: 0.55, roughness: 0.4 }),
      backlight: new THREE.MeshStandardMaterial({ color: 0xf2ecdc, emissive: 0xfff3d6, emissiveIntensity: 0.45, roughness: 0.6 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xd8d8dc, roughness: 0.22, metalness: 0.9 }),
      plate: new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: 0.35, metalness: 0.85 }),
      slot: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.8 }),
      red: new THREE.MeshStandardMaterial({ color: 0xc0201c, roughness: 0.35 }),
      coin: new THREE.MeshStandardMaterial({ color: 0xc8c4bc, roughness: 0.3, metalness: 0.9 }),
      lampOff: new THREE.MeshStandardMaterial({ color: 0x3a2a10, roughness: 0.4 }),
      lampOn: new THREE.MeshStandardMaterial({ color: 0xffb030, emissive: 0xffa020, emissiveIntensity: 1.4, roughness: 0.4 }),
      packs: PACK_BRANDS.map((b) => {
        const front = packFront(b);
        return {
          front: new THREE.MeshStandardMaterial({ map: front, emissive: 0xffffff, emissiveMap: front, emissiveIntensity: 0.18, roughness: 0.45 }),
          side: new THREE.MeshStandardMaterial({ color: b.ground, roughness: 0.45 }),
        };
      }),
    };
  }
  cigBodyMat ??= renderer ? surfaceMaterial('veneer', W, H, renderer, CIG_WALNUT) : new THREE.MeshStandardMaterial({ color: CIG_WALNUT, roughness: 0.6 });
  const m = cigMats;
  const g = new THREE.Group();
  const box = (w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const face = D;
  box(W, H, D, cigBodyMat, 0, H / 2, D / 2);
  const rim = 0.012;
  box(W, rim, 0.006, m.chrome, 0, H - rim / 2, face + 0.003);
  box(W, rim, 0.006, m.chrome, 0, rim / 2, face + 0.003);
  for (const sx of [-1, 1]) box(rim, H, 0.006, m.chrome, sx * (W / 2 - rim / 2), H / 2, face + 0.003);

  const hd = CIG_HEADER;
  box(hd.w + 0.016, hd.h + 0.016, 0.008, m.chrome, hd.x, hd.y, face + 0.004);
  box(hd.w, hd.h, 0.004, [m.dark, m.dark, m.dark, m.dark, m.header, m.dark], hd.x, hd.y, face + 0.009);
  const cp = CIG_COIN_PLATE;
  box(cp.w, cp.h, 0.008, m.plate, cp.x, cp.y, face + 0.004).userData.cigPart = 'coin';
  box(0.004, 0.032, 0.002, m.slot, COIN_SLOT_X, COIN_SLOT_Y, face + 0.009).userData.cigPart = 'coin';
  const reject = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.01, 16), m.red);
  reject.rotation.x = Math.PI / 2;
  reject.position.set(cp.x, cp.y - 0.045, face + 0.012);
  reject.userData.cigPart = 'reject';
  g.add(reject);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), m.lampOff);
  lamp.position.set(cp.x, cp.y + 0.07, face + 0.009);
  lamp.userData.cigPart = 'coin';
  g.add(lamp);

  const wn = CIG_WINDOW;
  box(wn.w + 0.016, wn.h + 0.016, 0.008, m.chrome, 0, wn.y, face + 0.004);
  box(wn.w, wn.h, 0.004, m.backlight, 0, wn.y, face + 0.009);
  PACK_BRANDS.forEach((_, i) => {
    const p = m.packs[i];
    box(0.058, 0.08, 0.004, [p.side, p.side, p.side, p.side, p.front, p.side], cigPackX(i), wn.y, face + 0.013);
  });

  box(wn.w + 0.016, 0.05, 0.01, m.chrome, 0, CIG_KNOB_Y, face + 0.005);
  const knobGeo = (() => {
    const pts = [
      new THREE.Vector2(0, 0), new THREE.Vector2(0.006, 0), new THREE.Vector2(0.006, 0.02),
      new THREE.Vector2(0.013, 0.026), new THREE.Vector2(0.013, 0.036), new THREE.Vector2(0, 0.038),
    ];
    const lathe = new THREE.LatheGeometry(pts, 16);
    lathe.rotateX(Math.PI / 2);
    return lathe;
  })();
  const knobs: CigRig['knobs'] = [];
  PACK_BRANDS.forEach((_, i) => {
    const knob = new THREE.Mesh(knobGeo, m.chrome);
    knob.position.set(cigPackX(i), CIG_KNOB_Y, face + 0.01);
    knob.userData.cigPart = 'knob';
    knob.userData.knob = i;
    g.add(knob);
    knobs.push({ mesh: knob, z: knob.position.z });
  });

  box(wn.w, 0.03, 0.004, m.dark, 0, CIG_CHUTE_Y, face + 0.002);

  const tw = wn.w, td = CIG_TRAY_DEPTH, tl = CIG_TRAY_LIP, fl = CIG_TRAY_FLOOR;
  box(tw, 0.012, td, m.dark, 0, fl - 0.006, face + td / 2);
  box(tw, fl + 0.05, 0.004, m.dark, 0, (fl + 0.05) / 2, face + 0.002);
  for (const sx of [-1, 1]) box(0.008, tl + 0.02, td, m.chrome, sx * (tw / 2 - 0.004), fl + (tl + 0.02) / 2 - 0.012, face + td / 2);
  box(tw, tl, 0.008, m.chrome, 0, fl + tl / 2 - 0.006, face + td - 0.004);

  const coin = new THREE.Mesh(new THREE.CylinderGeometry(COIN_R, COIN_R, 0.002, 20), m.coin);
  coin.rotation.z = Math.PI / 2;
  coin.visible = false;
  g.add(coin);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(PACK_W, PACK_H, PACK_D), m.packs[0].side);
  pack.visible = false;
  g.add(pack);
  return { root: g, rig: { knobs, coin, pack, lamp, credit: 0, coinT0: null, vend: null } };
}

const ease = (t: number, a: number, d: number): number => {
  const u = Math.min(1, Math.max(0, (t - a) / d));
  return u * u * (3 - 2 * u);
};

export type VendCue = 'coin' | 'pull' | 'release';

function poseCoin(r: CigRig, t: number, motion: boolean): void {
  const s = t - r.coinT0!;
  r.coin.visible = motion && s < VEND_COIN_S;
  r.coin.position.set(COIN_SLOT_X, COIN_SLOT_Y, CIG_MACHINE_D + 0.01 + 0.03 * (1 - ease(s, 0, VEND_COIN_S)));
  if (s >= VEND_COIN_S) { r.coin.visible = false; r.coinT0 = null; }
}

function poseVend(r: CigRig, t: number, motion: boolean, cue: (c: VendCue) => void): boolean {
  const v = r.vend!;
  const s = t - v.t0;
  const cues: [number, VendCue][] = [[0, 'pull'], [VEND_PULL_S / 2, 'release']];
  while (v.cued < cues.length && s >= cues[v.cued][0]) cue(cues[v.cued++][1]);
  const face = CIG_MACHINE_D;
  const k = r.knobs[v.knob];
  const pull = motion ? Math.sin(Math.PI * Math.min(1, Math.max(0, s / VEND_PULL_S))) : 0;
  k.mesh.position.z = k.z + KNOB_PULL_M * pull * (v.brand < 0 ? KNOB_DRY : 1);
  if (v.brand < 0) {
    const done = s >= VEND_PULL_S;
    if (done) { k.mesh.position.z = k.z; r.vend = null; }
    return !done;
  }
  const p = r.pack;
  p.visible = s >= VEND_DROP_AT_S && s < VEND_TAKE_AT_S + VEND_TAKE_S;
  const u = motion ? Math.min(1, Math.max(0, (s - VEND_DROP_AT_S) / VEND_DROP_S)) : 1;
  const fall = u * u;
  const take = motion ? 1 - ease(s, VEND_TAKE_AT_S, VEND_TAKE_S) : 1;
  const top = CIG_CHUTE_Y, rest = CIG_TRAY_FLOOR + PACK_D / 2;
  p.position.set(k.mesh.position.x, top + (rest - top) * fall, face + 0.012 + (CIG_TRAY_DEPTH / 2 - 0.012) * u);
  p.rotation.x = -(Math.PI / 2) * fall;
  p.scale.setScalar(Math.max(0.001, take));
  const over = s >= VEND_TAKE_AT_S + VEND_TAKE_S;
  if (over) {
    k.mesh.position.z = k.z;
    p.visible = false;
    r.vend = null;
  }
  return !over;
}

const loader = new GLTFLoader();
const models = new Map<PropKind, Promise<THREE.Object3D | null>>();

function model(kind: Modelled, renderer?: THREE.WebGLRenderer): Promise<THREE.Object3D | null> {
  let m = models.get(kind);
  if (!m) {
    m = loader.loadAsync(URLS[kind]).then((g) => {
      const root = g.scene;
      const k = propKind(kind);
      if (k.fitH) {
        const b0 = new THREE.Box3().setFromObject(root);
        root.scale.multiplyScalar(k.fitH / Math.max(1e-6, b0.max.y - b0.min.y));
        root.updateMatrixWorld(true);
      }
      if (k.skin && renderer) skin(root, k.skin, renderer);
      const b = new THREE.Box3().setFromObject(root);
      const c = b.getCenter(new THREE.Vector3());
      root.position.sub(new THREE.Vector3(c.x, b.min.y, c.z));
      const wrap = new THREE.Group();
      wrap.add(root);
      return wrap as THREE.Object3D;
    }).catch((e) => { console.warn(`[arcade] the ${kind} prop's model could not be loaded`, e); return null; });
    models.set(kind, m);
  }
  return m;
}

function skin(root: THREE.Object3D, id: 'powder', renderer: THREE.WebGLRenderer): void {
  const b = new THREE.Box3().setFromObject(root);
  const c = b.getCenter(new THREE.Vector3());
  const r = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
  const height = b.max.y - b.min.y;
  const mat = surfaceMaterial(id, Math.PI * 2 * r, height, renderer);
  const p = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      uv[i * 2] = (Math.atan2(p.z - c.z, p.x - c.x) / (Math.PI * 2) + 0.5);
      uv[i * 2 + 1] = (p.y - b.min.y) / height;
    }
    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    mesh.material = mat;
  });
}

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };

export class PropLayer {
  readonly group = new THREE.Group();
  private readonly items = new Map<string, { prop: Prop; holder: THREE.Group; rig?: CigRig }>();
  private box: Box;
  onCue: ((c: VendCue) => void) | null = null;

  constructor(box: Box, private readonly renderer?: THREE.WebGLRenderer) {
    this.box = box;
  }

  get centre(): { x: number; z: number } {
    return { x: (this.box.minX + this.box.maxX) / 2, z: (this.box.minZ + this.box.maxZ) / 2 };
  }

  setBox(box: Box): void {
    this.box = box;
    for (const it of this.items.values()) this.place(it.prop, it.holder);
  }

  set(props: Prop[]): void {
    const keep = new Set(props.map((p) => p.id));
    for (const [id, it] of this.items) {
      if (keep.has(id)) continue;
      this.group.remove(it.holder);
      this.items.delete(id);
    }
    for (const p of props) {
      let it = this.items.get(p.id);
      if (!it || it.prop.kind !== p.kind || it.prop.art !== p.art) {
        if (it) this.group.remove(it.holder);
        const holder = new THREE.Group();
        holder.userData.prop = p.id;
        this.group.add(holder);
        it = { prop: p, holder };
        this.items.set(p.id, it);
        if (p.kind === 'poster') holder.add(posterObject(posterArt(p.art).id));
        else if (p.kind === 'cigMachine') {
          const c = cigMachineObject(this.renderer);
          holder.add(c.root);
          it.rig = c.rig;
        }
        else void model(p.kind, this.renderer).then((m) => { if (m && this.items.get(p.id)?.holder === holder) holder.add(m.clone(true)); });
      }
      it.prop = { ...p };
      this.place(it.prop, it.holder);
    }
  }

  private place(p: Prop, holder: THREE.Group): void {
    if (propKind(p.kind).wall) {
      const walls = propOnWall(p, this.box, this.centre);
      holder.position.set(walls.x, p.kind === 'poster' ? POSTER_Y : CIG_MACHINE_Y0, walls.z);
      holder.rotation.y = walls.yaw;
      return;
    }
    const c = this.centre;
    const f = propFootprint(p, { x: 0, z: 0 });
    const x = Math.min(this.box.maxX - PROP_WALL_GAP + f.minX, Math.max(this.box.minX + PROP_WALL_GAP + f.maxX, c.x + p.x));
    const z = Math.min(this.box.maxZ - PROP_WALL_GAP + f.minZ, Math.max(this.box.minZ + PROP_WALL_GAP + f.maxZ, c.z + p.z));
    holder.position.set(x, 0, z);
    holder.rotation.y = p.yaw;
  }

  standFor(id: string, reach: number): { x: number; z: number; at: THREE.Vector3 } | null {
    const it = this.items.get(id);
    if (!it) return null;
    const h = it.holder;
    const out = CIG_MACHINE_D + reach;
    return {
      x: h.position.x + Math.sin(h.rotation.y) * out,
      z: h.position.z + Math.cos(h.rotation.y) * out,
      at: new THREE.Vector3(h.position.x, h.position.y + CIG_MACHINE_H * 0.35, h.position.z),
    };
  }

  partAt(ray: THREE.Raycaster): { id: string; part: CigPart } | null {
    const usable = [...this.items.values()].filter((i) => i.rig).map((i) => i.holder);
    const hit = usable.length ? ray.intersectObjects(usable, true)[0] : undefined;
    let o: THREE.Object3D | null = hit?.object ?? null;
    let part: CigPart = { kind: 'body' };
    const u = o?.userData ?? {};
    if (u.cigPart === 'coin') part = { kind: 'coin' };
    else if (u.cigPart === 'reject') part = { kind: 'reject' };
    else if (u.cigPart === 'knob') part = { kind: 'knob', knob: u.knob as number };
    while (o && typeof o.userData.prop !== 'string') o = o.parent;
    return o ? { id: o.userData.prop as string, part } : null;
  }

  insertCoin(id: string, t: number): boolean {
    const r = this.items.get(id)?.rig;
    if (!r) return false;
    r.credit++;
    r.coinT0 = t;
    r.lamp.material = cigMats!.lampOn;
    this.onCue?.('coin');
    return true;
  }

  rejectCoins(id: string): boolean {
    const r = this.items.get(id)?.rig;
    if (!r || !r.credit) return false;
    r.credit = 0;
    r.lamp.material = cigMats!.lampOff;
    this.onCue?.('coin');
    return true;
  }

  pullKnob(id: string, knob: number, t: number): 'sold' | 'dry' | null {
    const r = this.items.get(id)?.rig;
    if (!r || r.vend || !r.knobs[knob]) return null;
    if (!r.credit) {
      r.vend = { t0: t, knob, brand: -1, cued: 0 };
      return 'dry';
    }
    r.credit--;
    if (!r.credit) r.lamp.material = cigMats!.lampOff;
    const p = cigMats!.packs[knob];
    r.pack.material = [p.side, p.side, p.side, p.side, p.front, p.side];
    r.vend = { t0: t, knob, brand: knob, cued: 0 };
    return 'sold';
  }

  tick(t: number, motion: boolean): void {
    for (const it of this.items.values()) {
      if (it.rig?.coinT0 != null) poseCoin(it.rig, t, motion);
      if (it.rig?.vend) poseVend(it.rig, t, motion, (c) => this.onCue?.(c));
    }
  }

  footprints(): Box[] {
    const out: Box[] = [];
    for (const i of this.items.values()) {
      const f = footprintAt(i.prop.kind, { x: i.holder.position.x, z: i.holder.position.z, yaw: i.holder.rotation.y });
      if (f) out.push(f);
    }
    return out;
  }
}
