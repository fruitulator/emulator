import * as THREE from 'three';

const PRESS_DEPTH = 0.005;
const ART_W = 128;
export const DARK_INSERT = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.55, metalness: 0 });

interface Mount {
  node: THREE.Object3D;
  moving: { obj: THREE.Object3D; rest: THREE.Vector3; push: THREE.Vector3 }[];
  inlays: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }[];
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  material: THREE.MeshBasicMaterial;
  pressed: boolean;
  key: string;
  centre: THREE.Vector3;
  axis: THREE.Vector3;
}

export interface MountArt { left: number; top: number; width: number; height: number; fill: string }

export class MountRig {
  private readonly mounts: Mount[] = [];
  readonly coin: THREE.Object3D[] = [];
  readonly targets: THREE.Object3D[] = [];
  private art: (MountArt | null)[] = [];

  constructor(private readonly root: THREE.Object3D, mounts: readonly string[], coin: readonly string[], id: string) {
    root.updateMatrixWorld(true);
    const byName = (n: string): THREE.Object3D | null => root.getObjectByName(n) ?? null;
    const mountNamed = (n: string): THREE.Object3D | null => {
      let hit: THREE.Object3D | null = null;
      root.traverse((o) => { if (!hit && o.name === n && o.children.some((c) => /^inlay/i.test(c.name))) hit = o; });
      return hit;
    };
    const missing: string[] = [];
    for (const name of mounts) {
      const node = mountNamed(name);
      if (!node) { missing.push(name); continue; }
      const m = this.buildMount(node);
      if (!m) { missing.push(name); continue; }
      node.userData.mount = this.mounts.length;
      this.mounts.push(m);
      this.targets.push(node);
    }
    for (const name of coin) {
      const node = byName(name);
      if (!node) { missing.push(name); continue; }
      node.userData.coin = true;
      this.coin.push(node);
      this.targets.push(node);
    }
    if (missing.length) console.warn(`[arcade] cabinet ${id}: the manifest names mount or coin parts the model does not have (or with no cap insert): ${missing.join(', ')}`);
    this.art = this.mounts.map(() => null);
  }

  get count(): number { return this.mounts.length; }

  get nodes(): THREE.Object3D[] { return this.targets; }

  private buildMount(node: THREE.Object3D): Mount | null {
    const kids = node.children;
    const inlayNodes = kids.filter((c) => /^inlay/i.test(c.name));
    const capNodes = kids.filter((c) => /^button/i.test(c.name));
    const meshes: THREE.Mesh[] = [];
    for (const n of inlayNodes) n.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    if (!meshes.length) return null;
    const n = new THREE.Vector3();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const tri = (mesh: THREE.Mesh, f: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => void): void => {
      const pos = mesh.geometry.attributes.position;
      const idx = mesh.geometry.index;
      const count = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const at = (k: number, v: THREE.Vector3): THREE.Vector3 => v.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(mesh.matrixWorld);
        f(at(i, a), at(i + 1, b), at(i + 2, c));
      }
    };
    for (const m of meshes) {
      tri(m, (a, b, c) => {
        e1.subVectors(b, a);
        e2.subVectors(c, a);
        const cr = e1.cross(e2);
        if (cr.z > 0) n.add(cr);
      });
    }
    if (n.lengthSq() === 0) return null;
    n.normalize();
    const u = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize();
    const v = new THREE.Vector3().crossVectors(n, u);
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    const p = new THREE.Vector3();
    for (const m of meshes) {
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const s = p.dot(u), t = p.dot(v);
        s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
      }
    }
    const sw = s1 - s0 || 1, th = t1 - t0 || 1;
    const canvas = document.createElement('canvas');
    canvas.width = ART_W;
    canvas.height = Math.max(16, Math.min(ART_W * 2, Math.round(ART_W * (th / sw))));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const inlays = meshes.map((mesh) => {
      const g = mesh.geometry.clone();
      const pos = g.attributes.position;
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        uv[i * 2] = (p.dot(u) - s0) / sw;
        uv[i * 2 + 1] = (p.dot(v) - t0) / th;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      mesh.geometry = g;
      const original = mesh.material;
      mesh.material = DARK_INSERT;
      return { mesh, original };
    });
    const moving = [...capNodes, ...inlayNodes].map((obj) => {
      const parent = obj.parent!;
      const w = obj.getWorldPosition(new THREE.Vector3());
      const to = parent.worldToLocal(w.clone().addScaledVector(n, -PRESS_DEPTH));
      const from = parent.worldToLocal(w.clone());
      return { obj, rest: obj.position.clone(), push: to.sub(from) };
    });
    const centre = u.clone().multiplyScalar((s0 + s1) / 2).addScaledVector(v, (t0 + t1) / 2);
    let f1 = -Infinity;
    for (const m of meshes) {
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) f1 = Math.max(f1, p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).dot(n));
    }
    centre.addScaledVector(n, f1);
    return { node, moving, inlays, canvas, texture, material, pressed: false, key: '', centre, axis: n.clone() };
  }

  assign(art: (MountArt | null)[]): void {
    this.art = this.mounts.map((_, i) => art[i] ?? null);
    this.mounts.forEach((m, i) => {
      m.key = '';
      const mat = this.art[i] ? m.material : DARK_INSERT;
      for (const l of m.inlays) l.mesh.material = mat;
      if (!this.art[i]) this.press(m, false);
    });
  }

  version = 0;

  update(src: HTMLCanvasElement, origin: { left: number; top: number }, key: (i: number) => string, held: (i: number) => boolean): void {
    this.mounts.forEach((m, i) => {
      const art = this.art[i];
      if (!art) return;
      this.press(m, held(i));
      const k = key(i);
      if (k === m.key) return;
      m.key = k;
      const g = m.canvas.getContext('2d')!;
      const W = m.canvas.width, H = m.canvas.height;
      g.fillStyle = art.fill;
      g.fillRect(0, 0, W, H);
      const k2 = Math.min(W / art.width, H / art.height);
      const dw = art.width * k2, dh = art.height * k2;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, art.left - origin.left, art.top - origin.top, art.width, art.height, (W - dw) / 2, (H - dh) / 2, dw, dh);
      m.texture.needsUpdate = true;
      this.version++;
    });
  }

  private press(m: Mount, down: boolean): void {
    if (m.pressed === down) return;
    m.pressed = down;
    this.version++;
    for (const p of m.moving) {
      p.obj.position.copy(p.rest);
      if (down) p.obj.position.add(p.push);
    }
  }

  static hitOf(o: THREE.Object3D | null): { mount: number } | { coin: true } | null {
    for (let x = o; x; x = x.parent) {
      if (typeof x.userData.mount === 'number') return { mount: x.userData.mount };
      if (x.userData.coin) return { coin: true };
    }
    return null;
  }

  markOf(i: number): { at: THREE.Vector3; axis: THREE.Vector3 } | null {
    const m = this.mounts[i];
    if (!m) return null;
    this.root.updateWorldMatrix(true, false);
    return {
      at: m.centre.clone().applyMatrix4(this.root.matrixWorld),
      axis: m.axis.clone().transformDirection(this.root.matrixWorld),
    };
  }

  mapped(i: number): boolean { return !!this.art[i]; }

  dispose(): void {
    for (const m of this.mounts) {
      m.texture.dispose();
      m.material.dispose();
      for (const l of m.inlays) l.mesh.geometry.dispose();
    }
  }
}

export function reveal(root: THREE.Object3D, used: readonly THREE.Object3D[]): void {
  const keep = new Set<THREE.Object3D>();
  for (const u of used) for (let x: THREE.Object3D | null = u; x && x !== root; x = x.parent) keep.add(x);
  const usedSet = new Set(used);
  for (const x of keep) {
    if (x.visible) continue;
    x.visible = true;
    if (usedSet.has(x)) continue;
    for (const c of x.children) if (!keep.has(c)) c.visible = false;
  }
}
