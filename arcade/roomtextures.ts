import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { cabinetEnvironment } from './cabinetlight';
import { wallSurface, type UpperWall } from './roomlook';
import brickDiff from './textures/red_brick/red_brick_diff_1k.ktx2?url';
import brickNor from './textures/red_brick/red_brick_nor_gl_1k.ktx2?url';
import brickArm from './textures/red_brick/red_brick_arm_1k.ktx2?url';
import stockDiff from './textures/yellow_brick/yellow_brick_diff_1k.ktx2?url';
import stockNor from './textures/yellow_brick/yellow_brick_nor_gl_1k.ktx2?url';
import stockArm from './textures/yellow_brick/yellow_brick_arm_1k.ktx2?url';
import paintBrickDiff from './textures/painted_brick/painted_brick_diff_1k.ktx2?url';
import paintBrickNor from './textures/painted_brick/painted_brick_nor_gl_1k.ktx2?url';
import paintBrickArm from './textures/painted_brick/painted_brick_arm_1k.ktx2?url';
import panellingDiff from './textures/wooden_panels/wooden_panels_diff_1k.ktx2?url';
import panellingNor from './textures/wooden_panels/wooden_panels_nor_gl_1k.ktx2?url';
import panellingArm from './textures/wooden_panels/wooden_panels_arm_1k.ktx2?url';
import glazedDiff from './textures/glazed_tiles/glazed_tiles_diff_1k.ktx2?url';
import glazedNor from './textures/glazed_tiles/glazed_tiles_nor_gl_1k.ktx2?url';
import glazedArm from './textures/glazed_tiles/glazed_tiles_arm_1k.ktx2?url';
import mirrorDiff from './textures/mirror_tiles/mirror_tiles_diff_1k.ktx2?url';
import mirrorNor from './textures/mirror_tiles/mirror_tiles_nor_gl_1k.ktx2?url';
import mirrorArm from './textures/mirror_tiles/mirror_tiles_arm_1k.ktx2?url';
import laminateDiff from './textures/laminate/laminate_diff_1k.ktx2?url';
import laminateNor from './textures/laminate/laminate_nor_gl_1k.ktx2?url';
import laminateArm from './textures/laminate/laminate_arm_1k.ktx2?url';
import flockDiff from './textures/flock/flock_diff_1k.ktx2?url';
import flockNor from './textures/flock/flock_nor_gl_1k.ktx2?url';
import flockArm from './textures/flock/flock_arm_1k.ktx2?url';
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
import boardsDiff from './textures/wood_floor/wood_floor_diff_1k.jpg?url';
import boardsNor from './textures/wood_floor/wood_floor_nor_gl_1k.jpg?url';
import boardsArm from './textures/wood_floor/wood_floor_arm_1k.jpg?url';
import linoDiff from './textures/old_linoleum_flooring_01/old_linoleum_flooring_01_diff_1k.jpg?url';
import linoNor from './textures/old_linoleum_flooring_01/old_linoleum_flooring_01_nor_gl_1k.jpg?url';
import linoArm from './textures/old_linoleum_flooring_01/old_linoleum_flooring_01_arm_1k.jpg?url';
import tileDiff from './textures/floor_tiles_06/floor_tiles_06_diff_1k.jpg?url';
import tileNor from './textures/floor_tiles_06/floor_tiles_06_nor_gl_1k.jpg?url';
import tileArm from './textures/floor_tiles_06/floor_tiles_06_arm_1k.jpg?url';
import powderColour from './textures/Metal027/Metal027_color_1k.jpg?url';
import powderNor from './textures/Metal027/Metal027_nor_gl_1k.jpg?url';
import powderRough from './textures/Metal027/Metal027_rough_1k.jpg?url';
import chipColour from './textures/Wallpaper001A/Wallpaper001A_color_1k.jpg?url';
import chipNor from './textures/Wallpaper001A/Wallpaper001A_nor_gl_1k.jpg?url';
import chipRough from './textures/Wallpaper001A/Wallpaper001A_rough_1k.jpg?url';
import veneerDiff from './textures/black_oak_veneer/black_oak_veneer_diff_1k.jpg?url';
import veneerNor from './textures/black_oak_veneer/black_oak_veneer_nor_gl_1k.jpg?url';
import veneerArm from './textures/black_oak_veneer/black_oak_veneer_arm_1k.jpg?url';

export type SurfaceId = 'wood' | 'planks' | 'plaster' | 'woodchip' | 'plush' | 'cord' | 'squares' | 'checker' | 'boards' | 'lino' | 'tile' | 'powder' | 'veneer'
  | 'brick' | 'stock' | 'paintbrick' | 'panelling' | 'glazed' | 'mirror' | 'laminate' | 'flock';

interface Surface {
  tileM: number;
  colour: string;
  normal: string;
  arm?: string;
  rough?: string;
  relief?: number;
  roughness?: number;
  env?: number;
  mirror?: boolean;
  sheen?: boolean;
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
  boards: { tileM: 1.7, colour: boardsDiff, normal: boardsNor, arm: boardsArm, roughness: 0.55 },
  lino: { tileM: 1.99, colour: linoDiff, normal: linoNor, arm: linoArm, roughness: 0.6 },
  tile: { tileM: 3.0, colour: tileDiff, normal: tileNor, arm: tileArm, roughness: 0.6 },
  powder: { tileM: 0.5, colour: powderColour, normal: powderNor, rough: powderRough },
  veneer: { tileM: 1.0, colour: veneerDiff, normal: veneerNor, arm: veneerArm, relief: 2.5 },
  brick: { tileM: 1.5, colour: brickDiff, normal: brickNor, arm: brickArm },
  stock: { tileM: 1.95, colour: stockDiff, normal: stockNor, arm: stockArm },
  paintbrick: { tileM: 0.83, colour: paintBrickDiff, normal: paintBrickNor, arm: paintBrickArm },
  panelling: { tileM: 2.1, colour: panellingDiff, normal: panellingNor, arm: panellingArm },
  glazed: { tileM: 1.216, colour: glazedDiff, normal: glazedNor, arm: glazedArm, env: 0.15 },
  mirror: { tileM: 1.2, colour: mirrorDiff, normal: mirrorNor, arm: mirrorArm, env: 0.15, mirror: true },
  laminate: { tileM: 1.22, colour: laminateDiff, normal: laminateNor, arm: laminateArm, env: 0.25 },
  flock: { tileM: 0.53, colour: flockDiff, normal: flockNor, arm: flockArm, sheen: true },
};

const loader = new THREE.TextureLoader();
let ktx2: KTX2Loader | null = null;
function ktx2Loader(renderer: THREE.WebGLRenderer): KTX2Loader {
  if (!ktx2) {
    ktx2 = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`);
    ktx2.detectSupport(renderer);
  }
  return ktx2;
}
const cache = new Map<string, THREE.Texture>();
const waiting = new Map<THREE.Texture, THREE.Texture[]>();

function adopt(into: THREE.Texture, from: THREE.CompressedTexture): void {
  const t = into as THREE.CompressedTexture;
  t.image = from.image;
  t.mipmaps = from.mipmaps;
  t.format = from.format;
  t.type = from.type;
  t.minFilter = from.minFilter;
  t.magFilter = from.magFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
}

let anisotropy = 8;
let plain = false;
export function setSurfaceOptions(o: { aniso: number; textures: boolean }): void {
  anisotropy = o.aniso;
  plain = !o.textures;
}

function map(url: string, colour: boolean, renderer: THREE.WebGLRenderer): THREE.Texture {
  const base = baseMap(url, colour, renderer);
  const c = base.clone();
  if (waiting.has(base)) {
    c.version = 0;
    waiting.get(base)!.push(c);
  }
  return c;
}

function baseMap(url: string, colour: boolean, renderer: THREE.WebGLRenderer): THREE.Texture {
  let t = cache.get(url);
  if (!t) {
    let loading: THREE.Texture;
    if (url.endsWith('.ktx2')) {
      const stand = new THREE.CompressedTexture([], 0, 0);
      loading = stand;
      ktx2Loader(renderer).load(url, (got) => {
        adopt(stand, got);
        for (const c of waiting.get(stand) ?? []) adopt(c, got);
        waiting.delete(stand);
      }, undefined, (e) => console.warn('[arcade] a wall texture did not load', url, e));
    } else {
      loading = loader.load(url, () => {
        for (const c of waiting.get(loading) ?? []) c.needsUpdate = true;
        waiting.delete(loading);
      });
    }
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
  kind: SurfaceId | UpperWall, w: number, h: number, renderer: THREE.WebGLRenderer, tint: THREE.ColorRepresentation = 0xffffff, uOffset = 0,
  glow = 0,
  vOffset = 0,
): THREE.MeshStandardMaterial {
  const s = SURFACES[kind in SURFACES ? kind as SurfaceId : wallSurface(kind as UpperWall)];
  if (plain) {
    const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.9, metalness: 0 });
    if (glow > 0) { m.emissive.set(tint); m.emissiveIntensity = glow * 0.5; }
    return m;
  }
  const fit = (t: THREE.Texture): THREE.Texture => {
    t.repeat.set(w / s.tileM, h / s.tileM);
    t.offset.set(uOffset / s.tileM, vOffset / s.tileM);
    return t;
  };
  const opts: THREE.MeshStandardMaterialParameters = {
    color: tint,
    map: fit(map(s.colour, true, renderer)),
    normalMap: fit(map(s.normal, false, renderer)),
    roughness: s.roughness ?? 1,
    metalness: 0,
  };
  const m = s.sheen
    ? new THREE.MeshPhysicalMaterial({ ...opts, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(tint).multiplyScalar(0.6) })
    : new THREE.MeshStandardMaterial(opts);
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
  if (s.env) {
    m.envMap = cabinetEnvironment(renderer);
    m.envMapIntensity = s.env;
  }
  if (s.mirror) {
    m.metalness = 1;
    m.metalnessMap = m.roughnessMap;
  }
  if (s.mirror || s.sheen) {
    const tiles = s.mirror ? MIRROR_TILES : 0;
    m.onBeforeCompile = (sh) => {
      if (s.mirror) {
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 cell = floor( vNormalMapUv * ${tiles.toFixed(1)} );
          vec2 tilt = fract( sin( vec2( dot( cell, vec2( 127.1, 311.7 ) ), dot( cell, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 ) - 0.5;
          normal = normalize( normal + ${(MIRROR_TILT * 2).toFixed(4)} * ( tilt.x * tbn[ 0 ] + tilt.y * tbn[ 1 ] ) );
        }`);
      } else {
        sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.sheenColor *= texture2D( roughnessMap, vRoughnessMapUv ).b;`);
      }
    };
    m.customProgramCacheKey = () => (s.mirror ? 'wall-mirror' : 'wall-flock');
  }
  return m;
}

const MIRROR_TILES = 4;
const MIRROR_TILT = 0.035;
