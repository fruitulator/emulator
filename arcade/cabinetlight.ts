import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { sharedMaps, type SharedMaps } from './roomtextures';

export interface CabinetDress {
  skin: SharedMaps | null;
  env: THREE.Texture | null;
}

export const ENV_INTENSITY = 0.15;

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

export function cabinetDress(renderer: THREE.WebGLRenderer, env = true): CabinetDress {
  return { skin: sharedMaps('veneer', renderer), env: env ? cabinetEnvironment(renderer) : null };
}

export function dressShared(d: CabinetDress): Set<object> {
  const set = new Set<object>();
  if (d.skin) for (const t of [d.skin.map, d.skin.normalMap, d.skin.arm, d.skin.rough]) if (t) set.add(t);
  if (d.env) set.add(d.env);
  return set;
}
