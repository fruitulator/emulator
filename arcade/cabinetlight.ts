import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { sharedMaps, type SharedMaps } from './roomtextures';

export interface CabinetDress {
  skin: SharedMaps | null;
  env: THREE.Texture | null;
}

export const ENV_INTENSITY = 0.15;

export const REALISM_ENV_INTENSITY = 1.1;

const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

export function cabinetEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  let t = envCache.get(renderer);
  if (!t) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const scene = new RoomEnvironment();
    t = pmrem.fromScene(scene, 0.04).texture;
    pmrem.dispose();
    envCache.set(renderer, t);
  }
  return t;
}

export function captureRoomEnv(renderer: THREE.WebGLRenderer, scene: THREE.Scene, at: THREE.Vector3): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02, 0.05, 60, { position: at });
  pmrem.dispose();
  return target;
}

export function swapEnvironment(group: THREE.Object3D, shared: Set<object> | undefined, env: THREE.Texture, level: number): void {
  shared?.add(env);
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial || !std.envMap) continue;
      std.envMapIntensity = level;
      if (std.envMap !== env) { std.envMap = env; std.needsUpdate = true; }
    }
  });
}

export function cabinetDress(renderer: THREE.WebGLRenderer, env = true): CabinetDress {
  return { skin: sharedMaps('veneer', renderer), env: env ? cabinetEnvironment(renderer) : null };
}

export function dressShared(d: CabinetDress): Set<object> {
  const set = new Set<object>();
  if (d.skin) for (const t of [d.skin.map, d.skin.normalMap, d.skin.arm, d.skin.rough]) if (t) set.add(t);
  if (d.env) set.add(d.env);
  return set;
}
