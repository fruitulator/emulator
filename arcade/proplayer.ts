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
import { surfaceMaterial } from './roomtextures';
import {
  CIG_MACHINE_D, CIG_MACHINE_H, CIG_MACHINE_W, CIG_MACHINE_Y0, footprintAt, posterArt, POSTER_FRAME, POSTER_H, POSTER_Y, PROP_WALL_GAP, propFootprint,
  propKind, propOnWall, type PosterArt, type Prop, type PropKind,
} from './proplist';
import posterBalloon from './posters/balloon.jpg?url';
import posterCirque from './posters/cirque.jpg?url';
import posterTrapeze from './posters/trapeze.jpg?url';
import posterShowmen from './posters/showmen.jpg?url';
import posterClowns from './posters/clowns.jpg?url';
import posterConey from './posters/coneyisland.jpg?url';
import posterWater from './posters/watercircus.jpg?url';
import posterLady from './posters/ladyclown.jpg?url';
import posterBicycles from './posters/bicycles.jpg?url';

type Modelled = Exclude<PropKind, 'poster' | 'cigMachine'>;
const URLS: Record<Modelled, string> = { barStool, metalStool, plantTall, plantWide, chalkboard, wetFloor, bin, sofa };

const POSTER_URLS: Record<PosterArt, string> = {
  balloon: posterBalloon, cirque: posterCirque, trapeze: posterTrapeze, showmen: posterShowmen, clowns: posterClowns,
  coneyisland: posterConey, watercircus: posterWater, ladyclown: posterLady, bicycles: posterBicycles,
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
  header: THREE.MeshStandardMaterial; chrome: THREE.MeshStandardMaterial; plate: THREE.MeshStandardMaterial; slot: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial; pack: THREE.MeshStandardMaterial; trough: THREE.MeshStandardMaterial; knob: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial; tray: THREE.MeshStandardMaterial;
} | null = null;
let cigBodyMat: THREE.MeshStandardMaterial | null = null;
const CIG_WALNUT = 0x9a6640;

function cigMachineObject(renderer?: THREE.WebGLRenderer): THREE.Object3D {
  const W = CIG_MACHINE_W, H = CIG_MACHINE_H, D = CIG_MACHINE_D;
  cigMats ??= {
    header: new THREE.MeshStandardMaterial({ color: 0x1b4fa0, roughness: 0.45 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd8d8dc, roughness: 0.25, metalness: 0.9 }),
    plate: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5 }),
    slot: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.15, metalness: 0.1 }),
    pack: new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4 }),
    trough: new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.8 }),
    knob: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.35 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc0201c, roughness: 0.35 }),
    tray: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.4, metalness: 0.9 }),
  };
  cigBodyMat ??= renderer ? surfaceMaterial('veneer', W, H, renderer, CIG_WALNUT) : new THREE.MeshStandardMaterial({ color: CIG_WALNUT, roughness: 0.6 });
  const m = cigMats;
  const g = new THREE.Group();
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const face = D;
  box(W, H, D, cigBodyMat, 0, H / 2, D / 2);
  const headerY = H - 0.08 - 0.13;
  box(0.62, 0.26, 0.005, m.header, 0, headerY, face + 0.0025);
  box(0.62, 0.006, 0.004, m.chrome, 0, headerY + 0.133, face + 0.002);
  box(0.62, 0.006, 0.004, m.chrome, 0, headerY - 0.133, face + 0.002);
  for (const sx of [-1, 1]) {
    box(0.11, 0.07, 0.006, m.plate, sx * 0.27, 0.49, face + 0.003);
    box(0.003, 0.03, 0.002, m.slot, sx * 0.27 + 0.02, 0.49, face + 0.007);
  }
  box(0.66, 0.09, 0.004, m.glass, 0, 0.36, face + 0.002);
  for (let i = 0; i < 9; i++) box(0.055, 0.07, 0.002, m.pack, -0.3 + i * 0.075, 0.36, face + 0.005);
  for (const sx of [-1, 1]) {
    box(0.30, 0.04, 0.004, m.trough, sx * 0.17, 0.22, face + 0.002);
    for (let j = 0; j < 5; j++) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12), j === 4 ? m.red : m.knob);
      knob.rotation.x = Math.PI / 2;
      knob.position.set(sx * 0.17 - 0.12 + j * 0.06, 0.22, face + 0.015);
      g.add(knob);
    }
  }
  box(0.66, 0.05, 0.04, m.tray, 0, 0.06, face + 0.02);
  return g;
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
  private readonly items = new Map<string, { prop: Prop; holder: THREE.Group }>();
  private box: Box;

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
        else if (p.kind === 'cigMachine') holder.add(cigMachineObject(this.renderer));
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

  footprints(): Box[] {
    const out: Box[] = [];
    for (const i of this.items.values()) {
      const f = footprintAt(i.prop.kind, { x: i.holder.position.x, z: i.holder.position.z, yaw: i.holder.rotation.y });
      if (f) out.push(f);
    }
    return out;
  }
}
