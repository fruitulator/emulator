import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WallFixture } from './roomlook';
import { SPOT_DROP_M, TRACK_DROP_M, TRACK_OFF_M, type WallLight, type WallRun } from './walllayout';
import { buildSconces, type SconceLook } from './sconce';

const LENS_COLOUR = 0xfff0d8;
const CAN_R = 0.075;
const LENS_R = 0.05;
const HEAD_R = 0.032;
const HEAD_L = 0.1;
const HEAD_TILT = 0.55;
const TRACK_W = 0.035;
const TRACK_H = 0.025;

export interface WallLightBuild { group: THREE.Group; dispose(): void }

export function buildWallLights(
  kind: WallFixture | null, lights: WallLight[], walls: WallRun[], top: number, sconce: SconceLook,
): WallLightBuild {
  if (kind === 'sconces' && lights.length) return buildSconces(lights, walls, sconce);
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  if (!kind || !lights.length) return { group, dispose() {} };
  const body: THREE.BufferGeometry[] = [];
  const lens: THREE.BufferGeometry[] = [];
  const frame = (i: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationY(walls[i].rotY).setPosition(walls[i].x, 0, walls[i].z);
  const put = (into: THREE.BufferGeometry[], g: THREE.BufferGeometry, i: number, local: THREE.Matrix4): void => {
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(frame(i), local));
    into.push(g.index ? g.toNonIndexed() : g);
    if (g.index) g.dispose();
  };
  const at = (x: number, y: number, z: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(x, y, z);
  const spot = (i: number, x: number, yMount: number, z: number, drop: number): void => {
    put(body, new THREE.CylinderGeometry(0.008, 0.008, drop, 6).translate(0, -drop / 2, 0), i, at(x, yMount, z));
    const lean = new THREE.Matrix4().makeRotationX(HEAD_TILT);
    const m = at(x, yMount - drop, z).multiply(lean);
    put(body, new THREE.CylinderGeometry(HEAD_R, HEAD_R * 0.85, HEAD_L, 14).translate(0, -HEAD_L / 2 + 0.01, 0), i, m);
    put(lens, new THREE.CircleGeometry(HEAD_R * 0.8, 14).rotateX(Math.PI / 2).translate(0, -HEAD_L + 0.009, 0), i, m.clone());
  };
  for (const l of lights) {
    if (kind === 'cans') {
      put(body, new THREE.CylinderGeometry(CAN_R, CAN_R, 0.008, 20), l.wall, at(l.u, top - 0.004, l.off));
      put(lens, new THREE.CircleGeometry(LENS_R, 20).rotateX(Math.PI / 2), l.wall, at(l.u, top - 0.0085, l.off));
    } else if (kind === 'spots') {
      spot(l.wall, l.u, l.y + SPOT_DROP_M, l.off, SPOT_DROP_M);
    } else {
      spot(l.wall, l.u, top - TRACK_H, TRACK_OFF_M, TRACK_DROP_M - TRACK_H);
    }
  }
  if (kind === 'track') {
    for (let i = 0; i < walls.length; i++) {
      const us = lights.filter((l) => l.wall === i).map((l) => l.u);
      if (!us.length) continue;
      const u0 = Math.max(-walls[i].len / 2 + 0.3, Math.min(...us) - 0.6), u1 = Math.min(walls[i].len / 2 - 0.3, Math.max(...us) + 0.6);
      put(body, new THREE.BoxGeometry(u1 - u0, TRACK_H, TRACK_W), i, at((u0 + u1) / 2, top - TRACK_H / 2, TRACK_OFF_M));
    }
  }
  const add = (parts: THREE.BufferGeometry[], mat: THREE.Material): void => {
    for (const p of parts) p.deleteAttribute('uv');
    const g = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    if (!g) return;
    geos.push(g);
    mats.push(mat);
    const m = new THREE.Mesh(g, mat);
    m.raycast = () => {};
    group.add(m);
  };
  const finish = kind === 'cans'
      ? new THREE.MeshStandardMaterial({ color: 0xd8d8d4, metalness: 0.3, roughness: 0.5, emissive: 0x605c58, emissiveIntensity: 0.5 })
      : new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.4, roughness: 0.5, emissive: 0x1a1a1a, emissiveIntensity: 0.5 });
  add(body, finish);
  add(lens, new THREE.MeshBasicMaterial({ color: LENS_COLOUR, side: THREE.DoubleSide }));
  return {
    group,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
