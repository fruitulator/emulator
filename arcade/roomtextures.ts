import * as THREE from 'three';
import woodDiff from './textures/synthetic_wood/synthetic_wood_diff_1k.jpg?url';
import woodNor from './textures/synthetic_wood/synthetic_wood_nor_gl_1k.jpg?url';
import woodArm from './textures/synthetic_wood/synthetic_wood_arm_1k.jpg?url';
import planksDiff from './textures/white_planks_clean/white_planks_clean_diff_1k.jpg?url';
import planksNor from './textures/white_planks_clean/white_planks_clean_nor_gl_1k.jpg?url';
import planksArm from './textures/white_planks_clean/white_planks_clean_arm_1k.jpg?url';
import plasterDiff from './textures/white_stucco/white_stucco_diff_1k.jpg?url';
import plasterNor from './textures/white_stucco/white_stucco_nor_gl_1k.jpg?url';
import plasterArm from './textures/white_stucco/white_stucco_arm_1k.jpg?url';
import plushColour from './textures/Carpet016/Carpet016_color_1k.jpg?url';
import plushNor from './textures/Carpet016/Carpet016_nor_gl_1k.jpg?url';
import plushRough from './textures/Carpet016/Carpet016_rough_1k.jpg?url';
import cordColour from './textures/Fabric026/Fabric026_color_1k.jpg?url';
import cordNor from './textures/Fabric026/Fabric026_nor_gl_1k.jpg?url';
import cordRough from './textures/Fabric026/Fabric026_rough_1k.jpg?url';
import squaresColour from './textures/Carpet005/Carpet005_color_1k.jpg?url';
import squaresNor from './textures/Carpet005/Carpet005_nor_gl_1k.jpg?url';
import squaresRough from './textures/Carpet005/Carpet005_rough_1k.jpg?url';
import checkerColour from './textures/Carpet006/Carpet006_color_1k.jpg?url';
import checkerNor from './textures/Carpet006/Carpet006_nor_gl_1k.jpg?url';
import checkerRough from './textures/Carpet006/Carpet006_rough_1k.jpg?url';
import powderColour from './textures/Metal027/Metal027_color_1k.jpg?url';
import powderNor from './textures/Metal027/Metal027_nor_gl_1k.jpg?url';
import powderRough from './textures/Metal027/Metal027_rough_1k.jpg?url';
import chipColour from './textures/Wallpaper001A/Wallpaper001A_color_1k.jpg?url';
import chipNor from './textures/Wallpaper001A/Wallpaper001A_nor_gl_1k.jpg?url';
import chipRough from './textures/Wallpaper001A/Wallpaper001A_rough_1k.jpg?url';
import veneerDiff from './textures/black_oak_veneer/black_oak_veneer_diff_1k.jpg?url';
import veneerNor from './textures/black_oak_veneer/black_oak_veneer_nor_gl_1k.jpg?url';
import veneerArm from './textures/black_oak_veneer/black_oak_veneer_arm_1k.jpg?url';

export type SurfaceId = 'wood' | 'planks' | 'plaster' | 'woodchip' | 'plush' | 'cord' | 'squares' | 'checker' | 'powder' | 'veneer';

interface Surface {
  tileM: number;
  colour: string;
  normal: string;
  arm?: string;
  rough?: string;
  relief?: number;
}

const SURFACES: Record<SurfaceId, Surface> = {
  wood: { tileM: 2.0, colour: woodDiff, normal: woodNor, arm: woodArm },
  planks: { tileM: 1.8, colour: planksDiff, normal: planksNor, arm: planksArm },
  plaster: { tileM: 2.0, colour: plasterDiff, normal: plasterNor, arm: plasterArm },
  woodchip: { tileM: 1.2, colour: chipColour, normal: chipNor, rough: chipRough, relief: 2.5 },
  plush: { tileM: 0.8, colour: plushColour, normal: plushNor, rough: plushRough },
  cord: { tileM: 0.8, colour: cordColour, normal: cordNor, rough: cordRough },
  squares: { tileM: 1.6, colour: squaresColour, normal: squaresNor, rough: squaresRough },
  checker: { tileM: 1.6, colour: checkerColour, normal: checkerNor, rough: checkerRough },
  powder: { tileM: 0.5, colour: powderColour, normal: powderNor, rough: powderRough },
  veneer: { tileM: 1.0, colour: veneerDiff, normal: veneerNor, arm: veneerArm, relief: 2.5 },
};

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
const waiting = new Map<THREE.Texture, THREE.Texture[]>();

let anisotropy = 8;
let plain = false;
export function setSurfaceOptions(o: { aniso: number; textures: boolean }): void {
  anisotropy = o.aniso;
  plain = !o.textures;
}

function map(url: string, colour: boolean, renderer: THREE.WebGLRenderer): THREE.Texture {
  const base = baseMap(url, colour, renderer);
  const c = base.clone();
  if (base.image === null) {
    c.version = 0;
    waiting.get(base)!.push(c);
  }
  return c;
}

function baseMap(url: string, colour: boolean, renderer: THREE.WebGLRenderer): THREE.Texture {
  let t = cache.get(url);
  if (!t) {
    const loading = loader.load(url, () => {
      for (const c of waiting.get(loading) ?? []) c.needsUpdate = true;
      waiting.delete(loading);
    });
    waiting.set(loading, []);
    t = loading;
    if (colour) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(anisotropy, renderer.capabilities.getMaxAnisotropy());
    cache.set(url, t);
  }
  return t;
}

export interface SharedMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  arm: THREE.Texture | null;
  rough: THREE.Texture | null;
  relief: number;
}

export function sharedMaps(id: SurfaceId, renderer: THREE.WebGLRenderer): SharedMaps | null {
  if (plain) return null;
  const s = SURFACES[id];
  const life = (t: THREE.Texture): THREE.Texture => { t.repeat.set(1 / s.tileM, 1 / s.tileM); return t; };
  return {
    map: life(baseMap(s.colour, true, renderer)),
    normalMap: life(baseMap(s.normal, false, renderer)),
    arm: s.arm ? life(baseMap(s.arm, false, renderer)) : null,
    rough: s.rough ? life(baseMap(s.rough, false, renderer)) : null,
    relief: s.relief ?? 1,
  };
}

export function surfaceMaterial(
  id: SurfaceId, w: number, h: number, renderer: THREE.WebGLRenderer, tint: THREE.ColorRepresentation = 0xffffff, uOffset = 0,
  glow = 0,
): THREE.MeshStandardMaterial {
  const s = SURFACES[id];
  if (plain) {
    const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.9, metalness: 0 });
    if (glow > 0) { m.emissive.set(tint); m.emissiveIntensity = glow * 0.5; }
    return m;
  }
  const fit = (t: THREE.Texture): THREE.Texture => {
    t.repeat.set(w / s.tileM, h / s.tileM);
    t.offset.set(uOffset / s.tileM, 0);
    return t;
  };
  const m = new THREE.MeshStandardMaterial({
    color: tint,
    map: fit(map(s.colour, true, renderer)),
    normalMap: fit(map(s.normal, false, renderer)),
    roughness: 1,
    metalness: 0,
  });
  m.normalScale.setScalar(s.relief ?? 1);
  if (glow > 0) {
    m.emissive.set(tint);
    m.emissiveMap = m.map;
    m.emissiveIntensity = glow;
  }
  if (s.arm) {
    const arm = fit(map(s.arm, false, renderer));
    m.roughnessMap = arm;
    m.aoMap = arm;
    m.aoMapIntensity = 1;
  } else if (s.rough) {
    m.roughnessMap = fit(map(s.rough, false, renderer));
  }
  return m;
}
