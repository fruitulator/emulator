import * as THREE from 'three';
import type { CabinetShell } from './cabinets';
import type { Glass } from './glass';
import { applyH, faceToQuad, quadToFace, type Quad } from './quad';
import { MountRig } from './mountrig';
import type { CabLamp } from '../web/dat';

export interface GlassHit { x: number; y: number; scale: number; lamp?: CabLamp; coin?: boolean }

export function glassWorld(holder: THREE.Object3D, shell: CabinetShell): THREE.Vector3 {
  return holder.localToWorld(shell.glassCentre.clone());
}

export function glassPointAt(
  ndc: THREE.Vector2, camera: THREE.Camera, raycaster: THREE.Raycaster,
  holder: THREE.Object3D, shell: CabinetShell, glass: Glass, viewH: number,
): GlassHit | null {
  const cab = glass.cab;
  if (!cab) return null;
  raycaster.setFromCamera(ndc, camera);
  const rig = shell.rig;
  if (rig?.targets.length) {
    const hits = raycaster.intersectObjects([...shell.glassMeshes, ...rig.targets], true).filter((h) => shown(h.object));
    const box = new THREE.Box3();
    const into = new THREE.Vector3();
    const coinAt = rig.coin.reduce((d, n) => {
      const at = raycaster.ray.intersectBox(box.setFromObject(n), into);
      return at ? Math.min(d, raycaster.ray.origin.distanceTo(at)) : d;
    }, Infinity);
    const first = hits[0] && hits[0].distance <= coinAt ? hits[0].object : null;
    const on = first ? MountRig.hitOf(first) : coinAt < Infinity ? { coin: true as const } : null;
    if (on && 'coin' in on) return { x: 0, y: 0, scale: 0, coin: true };
    if (on) {
      const n = glass.mountLamps[on.mount];
      return n === null || n === undefined ? null : { x: 0, y: 0, scale: 0, lamp: cab.lamps[n] };
    }
  }
  const hit = raycaster.intersectObjects(shell.glassMeshes, false)[0];
  if (!hit?.uv) return null;
  const { left, top, width, height } = glass.column ?? cab.content;
  const p = facePoint(hit.object.userData.src as Quad | undefined, hit.uv.x, hit.uv.y);
  if (!p) return null;
  const x = left + p.x * width;
  const y = top + p.y * height;
  const c = glassWorld(holder, shell);
  const a = c.clone().add(new THREE.Vector3(0, shell.glassHeight / 2, 0)).project(camera);
  const b = c.clone().add(new THREE.Vector3(0, -shell.glassHeight / 2, 0)).project(camera);
  const px = Math.abs(a.y - b.y) / 2 * viewH;
  return { x, y, scale: px / height };
}

function shown(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

export function facePoint(src: Quad | undefined, u: number, v: number): { x: number; y: number } | null {
  if (!src) return null;
  const h = faceToQuad(src);
  return h ? applyH(h, u, 1 - v) : null;
}

export interface FaceFrame { world: THREE.Matrix4; w: number; h: number; name: string }

export function faceAt(
  ndc: THREE.Vector2, camera: THREE.Camera, raycaster: THREE.Raycaster, shell: CabinetShell,
): { frame: FaceFrame; at: { x: number; y: number } } | null {
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(shell.glassMeshes, false)[0];
  if (!hit?.uv) return null;
  const m = hit.object as THREE.Mesh;
  const p = (m.geometry as THREE.PlaneGeometry).parameters;
  m.updateMatrixWorld();
  return {
    frame: { world: m.matrixWorld.clone(), w: p.width, h: p.height, name: String(m.userData.face ?? '') },
    at: { x: hit.uv.x, y: 1 - hit.uv.y },
  };
}

export function facePlanePoint(
  ndc: THREE.Vector2, camera: THREE.Camera, raycaster: THREE.Raycaster, f: FaceFrame,
): { x: number; y: number } | null {
  raycaster.setFromCamera(ndc, camera);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(f.world);
  const origin = new THREE.Vector3().setFromMatrixPosition(f.world);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
  const p = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  if (!p) return null;
  const local = p.applyMatrix4(f.world.clone().invert());
  return { x: local.x / f.w + 0.5, y: 0.5 - local.y / f.h };
}

export function framingDistance(shell: CabinetShell, camera: THREE.PerspectiveCamera, fov = camera.fov): number {
  const halfFov = THREE.MathUtils.degToRad(fov / 2);
  const fitH = shell.frameHeight * 0.55;
  const fitW = (shell.size.W * 0.55) / camera.aspect;
  return Math.max(fitH, fitW) / Math.tan(halfFov);
}

export const TILT_DOWN = THREE.MathUtils.degToRad(45);
export const TILT_UP = THREE.MathUtils.degToRad(20);

export function walkUpView(c: THREE.Vector3, r: number, yaw: number, tilt: number, facing: number, aim = r):
  { pos: THREE.Vector3; look: THREE.Vector3 } {
  const t = Math.max(-TILT_UP, Math.min(TILT_DOWN, tilt));
  const pos = new THREE.Vector3(c.x + r * Math.sin(facing + yaw), c.y, c.z + r * Math.cos(facing + yaw));
  const look = c.clone();
  look.y -= Math.tan(t) * aim;
  return { pos, look };
}

export interface FloorRect { minX: number; maxX: number; minZ: number; maxZ: number }

export const BACK_CLEAR = 0.2;

export function backReach(c: { x: number; z: number }, facing: number, yaw: number,
  others: readonly FloorRect[], room: FloorRect): number {
  const dx = Math.sin(facing + yaw);
  const dz = Math.cos(facing + yaw);
  let far = Infinity;
  if (dx > 1e-9) far = Math.min(far, (room.maxX - c.x) / dx);
  if (dx < -1e-9) far = Math.min(far, (room.minX - c.x) / dx);
  if (dz > 1e-9) far = Math.min(far, (room.maxZ - c.z) / dz);
  if (dz < -1e-9) far = Math.min(far, (room.minZ - c.z) / dz);
  for (const b of others) {
    const t = slabEntry(c.x, dx, b.minX, b.maxX, c.z, dz, b.minZ, b.maxZ);
    if (t !== null) far = Math.min(far, t);
  }
  return Math.max(0, far - BACK_CLEAR);
}

function slabEntry(x: number, dx: number, minX: number, maxX: number,
  z: number, dz: number, minZ: number, maxZ: number): number | null {
  let lo = -Infinity;
  let hi = Infinity;
  for (const [p, d, a, b] of [[x, dx, minX, maxX], [z, dz, minZ, maxZ]] as const) {
    if (Math.abs(d) < 1e-9) {
      if (p < a || p > b) return null;
      continue;
    }
    const t1 = (a - p) / d;
    const t2 = (b - p) / d;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
  }
  return lo <= hi && lo > 0 ? lo : null;
}

export function glassWorldPoint(shell: CabinetShell, glass: Glass, x: number, y: number): THREE.Vector3 | null {
  const cab = glass.cab;
  if (!cab) return null;
  const { left, top, width, height } = glass.column ?? cab.content;
  const fx = (x - left) / width;
  const fy = (y - top) / height;
  for (const m of shell.glassMeshes) {
    if (!shown(m)) continue;
    const src = m.userData.src as Quad | undefined;
    const h = src ? quadToFace(src) : null;
    const f = h ? applyH(h, fx, fy) : null;
    if (!f || f.x < 0 || f.x > 1 || f.y < 0 || f.y > 1) continue;
    const local = meshPointAtUv(m.geometry, f.x, 1 - f.y);
    if (!local) continue;
    m.updateWorldMatrix(true, false);
    return local.applyMatrix4(m.matrixWorld);
  }
  return null;
}

export function meshPointAtUv(geo: THREE.BufferGeometry, u: number, v: number): THREE.Vector3 | null {
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  if (!pos || !uv) return null;
  const index = geo.getIndex();
  const n = index ? index.count : pos.count;
  const EPS = 1e-6;
  for (let t = 0; t + 2 < n; t += 3) {
    const [a, b, c] = [t, t + 1, t + 2].map((k) => (index ? index.getX(k) : k));
    const ax = uv.getX(a), ay = uv.getY(a);
    const bx = uv.getX(b) - ax, by = uv.getY(b) - ay;
    const cx = uv.getX(c) - ax, cy = uv.getY(c) - ay;
    const d = bx * cy - by * cx;
    if (Math.abs(d) < 1e-12) continue;
    const px = u - ax, py = v - ay;
    const s = (px * cy - py * cx) / d;
    const r = (bx * py - by * px) / d;
    if (s < -EPS || r < -EPS || s + r > 1 + EPS) continue;
    const pa = new THREE.Vector3().fromBufferAttribute(pos, a);
    const pb = new THREE.Vector3().fromBufferAttribute(pos, b).sub(pa);
    const pc = new THREE.Vector3().fromBufferAttribute(pos, c).sub(pa);
    return pa.add(pb.multiplyScalar(s)).add(pc.multiplyScalar(r));
  }
  return null;
}
