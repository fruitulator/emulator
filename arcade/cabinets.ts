import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildFruitCabinet, cabinetStyle, DERIVED, faceMaterial, makeFaceMesh, makeShapedMesh, type CabinetFace } from './cabinet-default';
import { dressShared, ENV_INTENSITY, type CabinetDress } from './cabinetlight';
import { fracAspect, type ShellFit } from './fit';
import { CoinEntry, reveal } from './coinentry';
import { findDeck, flipTris, insetQuad, joinSection, pickFace, planarFaces, shapedSurface, splitFoot, type CabinetQuad, type FacePick, type ShapedSurface } from './modelpanels';

export interface CabinetModel {
  id: string;
  file: string;
  url?: string;
  styles: string[];
  panels?: { glass?: PanelSpec; lower?: PanelSpec; buttons?: PanelSpec };
  glass?: CabinetQuad;
  buttonQuad?: CabinetQuad;
  hide?: string[];
  trim?: string[];
  coin?: string[];
  onTop?: { part: string; mat: string; level: number }[];
}

export type { CabinetQuad };

export interface PanelSpec {
  part: string; face?: FacePick; mat?: string; inset?: [number, number];
  shape?: boolean;
  back?: boolean;
}

export interface ModelPanel { quad: CabinetQuad; source: string; surface?: ShapedSurface }

export interface ModelPanels {
  glass: ModelPanel;
  lower: ModelPanel | null;
  buttons: ModelPanel | null;
  section: ModelPanel | null;
  old: { glass: CabinetQuad | null; lower: CabinetQuad | null };
}

export interface CabinetPanels {
  fixed: boolean;
  glass: number;
  buttons: number | null;
  deck: number | null;
}

export interface CabinetShell {
  group: THREE.Group;
  glassMeshes: THREE.Mesh[];
  size: { W: number; H: number; D: number; lowerFront?: number };
  glassCentre: THREE.Vector3;
  glassHeight: number;
  frameHeight: number;
  modelId: string;
  panels: CabinetPanels;
  coin: CoinEntry | null;
  shared?: ReadonlySet<object>;
}

export function disposeShell(s: CabinetShell, keep: THREE.Texture | null): void {
  const shared = s.shared;
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  s.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    geos.add(m.geometry);
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x);
  });
  for (const g of geos) if (!shared?.has(g)) g.dispose();
  for (const m of mats) {
    if (shared?.has(m)) continue;
    for (const t of texturesOf(m)) if (t !== keep && !shared?.has(t)) t.dispose();
    m.dispose();
  }
}

function texturesOf(m: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) out.push(v as THREE.Texture);
  return out;
}

const sharedCache = new WeakMap<THREE.Object3D, ReadonlySet<object>>();
function sharedOf(src: THREE.Object3D): ReadonlySet<object> {
  let set = sharedCache.get(src) as Set<object> | undefined;
  if (set) return set;
  set = new Set<object>();
  const s = set;
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    s.add(m.geometry);
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) {
      s.add(x);
      for (const t of texturesOf(x)) s.add(t);
    }
  });
  sharedCache.set(src, s);
  return s;
}

let registry: Promise<CabinetModel[]> | null = null;

export function cabinetModels(): Promise<CabinetModel[]> {
  if (!registry) {
    registry = Promise.resolve([]);
    if (import.meta.env.DEV) {
      registry = import('./devdata').then((d) => d.cabinetManifest()).catch((e: unknown) => {
        console.warn('[arcade] the cabinet models did not load; the default cabinet stands in', e);
        registry = null;
        return [];
      });
    }
  }
  return registry;
}

export async function modelFor(style: string | null, index = 0, chosen?: string): Promise<CabinetModel | null> {
  const models = await cabinetModels();
  if (chosen !== undefined) return chosen === 'default' ? null : models.find((m) => m.id === chosen) ?? null;
  const named = styleModel(models, style);
  if (named) return named;
  if (import.meta.env.DEV && models.length) {
    const pick = new URLSearchParams(location.search).get('cabinet');
    if (pick === 'mix') return models[index % models.length];
    if (pick) return models.find((m) => m.id === pick) ?? null;
  }
  return null;
}

export function styleModel<M extends Pick<CabinetModel, 'styles'>>(models: readonly M[], style: string | null): M | undefined {
  const want = style?.trim().toLowerCase();
  return want ? models.find((m) => m.styles.some((s) => s.toLowerCase() === want)) : undefined;
}

const gltfCache = new Map<string, Promise<THREE.Group>>();
function loadGltf(url: string): Promise<THREE.Group> {
  let p = gltfCache.get(url);
  if (!p) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    p = loader.loadAsync(url).then((g) => g.scene);
    gltfCache.set(url, p);
  }
  return p;
}

export interface ShellOptions {
  fit: ShellFit;
  trim: THREE.ColorRepresentation;
  body?: string;
  surface?: 'plastic';
  texture: THREE.Texture;
  model: CabinetModel | null;
  name: string;
  dress?: CabinetDress | null;
  cabinet?: string;
}

export async function buildShell(o: ShellOptions): Promise<CabinetShell> {
  if (o.model) {
    try {
      return await modelShell(o.model, o);
    } catch (e) {
      console.warn(`[arcade] cabinet model ${o.model.id} did not load; the default stands in`, e);
    }
  }
  return defaultShell(o);
}

function defaultShell(o: ShellOptions): CabinetShell {
  const f = o.fit;
  const glassSrc = f.noLower ? f.glassOnly : f.glass;
  const glassAspect = fracAspect(glassSrc, f.aspect);
  const deckAspect = f.noLower ? null : fracAspect(f.buttons, f.aspect);
  const buttonsAspect = f.deck && !f.noLower ? fracAspect(f.deck, f.aspect) : null;
  const built = buildFruitCabinet({
    glassAspect,
    glassSrc,
    deckAspect,
    deckSrc: f.buttons,
    deckRake: 46.3,
    buttonsAspect,
    buttonsSrc: f.deck ?? undefined,
    buttonsRake: 48.6,
    dress: o.dress,
    trim: o.trim,
    body: o.body,
    plastic: o.surface === 'plastic',
    furniture: true,
    style: cabinetStyle(o.cabinet),
  });
  const glassMeshes: THREE.Mesh[] = [];
  const mat = faceMaterial(o.texture);
  for (const f of built.faces) {
    if (f.h <= 0.0005) continue;
    const m = makeFaceMesh(f, null, mat);
    built.group.add(m);
    glassMeshes.push(m);
  }
  const g = built.glass;
  return {
    group: built.group,
    glassMeshes,
    size: built.size,
    glassCentre: new THREE.Vector3(0, (g.top + g.bottom) / 2, g.z + 0.05),
    glassHeight: g.top - g.bottom,
    frameHeight: g.top - g.bottom + (g.zFront - g.z) / 2,
    modelId: 'default',
    panels: { fixed: false, glass: glassAspect, buttons: deckAspect, deck: buttonsAspect },
    coin: null,
    shared: o.dress ? dressShared(o.dress) : undefined,
  };
}

const ONTOP_FACTOR = 0;
const ONTOP_UNITS = -2;

function partOf(o: THREE.Object3D): string {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name && !/^mesh_/.test(p.name)) return p.name;
  return '';
}

function liftOverlaps(group: THREE.Object3D, onTop: readonly { part: string; mat: string; level: number }[]): void {
  if (!onTop.length) return;
  const level = new Map(onTop.map((t) => [`${t.part}|${t.mat}`, t.level]));
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const part = partOf(mesh);
    const lift = (m: THREE.Material): THREE.Material => {
      const lv = level.get(`${part}|${m.name}`);
      if (!lv) return m;
      const c = m.clone();
      c.polygonOffset = true;
      c.polygonOffsetFactor = ONTOP_FACTOR * lv;
      c.polygonOffsetUnits = ONTOP_UNITS * lv;
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(lift) : lift(mesh.material);
  });
}

function reflectModel(group: THREE.Object3D, dress: CabinetDress | null | undefined): void {
  const env = dress?.env;
  if (!env) return;
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial || std.envMap === env) continue;
      std.envMap = env;
      std.envMapIntensity = ENV_INTENSITY;
      std.needsUpdate = true;
    }
  });
}

const panelCache = new Map<string, Promise<ModelPanels>>();
export function modelPanels(model: CabinetModel): Promise<ModelPanels> {
  let p = panelCache.get(model.id);
  if (!p) {
    p = loadGltf(model.url!).then((src) => {
      src.updateMatrixWorld(true);
      const named = (spec: PanelSpec | undefined, what: string): ModelPanel | null => {
        if (!spec) return null;
        const q = namedQuad(src, spec);
        if (!q) {
          console.warn(`[arcade] cabinet ${model.id}: its ${what} names the part "${spec.part}", which has no flat face; the fallback is used`);
          return null;
        }
        return { ...q, source: `its part "${spec.part}"${spec.face ? ` (${spec.face} face)` : ''}${spec.shape ? ' (shaped)' : ''}` };
      };
      const rc = new THREE.Raycaster();
      const from = new THREE.Vector3();
      const back = new THREE.Vector3(0, 0, -1);
      const frontZ = (x: number, y: number): number | null => {
        rc.set(from.set(x, y, 3), back);
        const hit = rc.intersectObject(src, true)[0];
        return hit ? hit.point.z : null;
      };
      const oldLower = model.glass ? findDeck(model.glass, frontZ) : null;
      const glass = named(model.panels?.glass, 'top glass')
        ?? (model.glass ? { quad: model.glass, source: 'the manifest (measured by hand)' } : null);
      if (!glass) throw new Error(`cabinet ${model.id} has no glass: no named part and no manifest quad`);
      let lower = named(model.panels?.lower, 'lower glass');
      if (!lower && !model.panels?.lower) {
        const d = findDeck(glass.quad, frontZ);
        if (d) lower = { quad: d, source: 'its side profile (no named part)' };
      }
      const buttons = named(model.panels?.buttons, 'button panel')
        ?? (model.buttonQuad ? { quad: model.buttonQuad, source: 'the manifest (measured by hand)' } : null);
      const joined = lower && buttons ? joinSection(lower.quad, buttons.quad) : null;
      const section = joined ? { quad: joined, source: `${lower!.source} and ${buttons!.source}, one plane` } : lower;
      console.info(`[arcade] cabinet ${model.id}: top glass from ${glass.source}; lower glass ${lower ? `from ${lower.source}` : 'none'}; button panel ${buttons ? `from ${buttons.source}` : 'none named'}${model.hide?.length ? `; not drawn: ${model.hide.join(', ')}` : ''}`);
      return { glass, lower, buttons, section, old: { glass: model.glass ?? null, lower: oldLower } };
    });
    panelCache.set(model.id, p);
  }
  return p;
}

function namedQuad(src: THREE.Object3D, spec: PanelSpec): { quad: CabinetQuad; surface?: ShapedSurface } | null {
  const tris: number[] = [];
  const v = new THREE.Vector3();
  const nodes: THREE.Object3D[] = [];
  src.traverse((o) => { if (o.name === spec.part) nodes.push(o); });
  for (const n of nodes) {
    n.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (spec.mat && !mats.some((m) => m.name === spec.mat)) return;
      const pos = mesh.geometry.attributes.position;
      const idx = mesh.geometry.index;
      const n3 = idx ? idx.count : pos.count;
      for (let i = 0; i < n3; i++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
        tris.push(v.x, v.y, v.z);
      }
    });
  }
  const own = spec.back ? flipTris(tris) : tris;
  if (spec.shape) {
    const surface = shapedSurface(own);
    return surface ? { quad: surface.quad, surface } : null;
  }
  const f = pickFace(planarFaces(own), spec.face);
  if (!f) return null;
  const q: CabinetQuad = { centre: f.centre, w: f.w, h: f.h, leanDeg: f.leanDeg };
  return { quad: spec.inset ? insetQuad(q, spec.inset) : q };
}

async function modelShell(model: CabinetModel, o: ShellOptions): Promise<CabinetShell> {
  if (!model.url) throw new Error('no URL for this model');
  const src = await loadGltf(model.url);
  const panels = await modelPanels(model);
  let deck = o.fit.noLower ? null : panels.section?.quad ?? null;
  let btns: CabinetQuad | null = null;
  if (o.fit.deck && deck) {
    if (panels.buttons && panels.lower) {
      deck = panels.lower.quad;
      btns = panels.buttons.quad;
    } else {
      const cut = splitFoot(deck, BUTTON_SHARE);
      deck = cut.above;
      btns = cut.strip;
      console.info(`[arcade] ${o.name}: the ${model.id} cabinet names no button panel; the Buttons box goes on the bottom ${Math.round(BUTTON_SHARE * 100)}% of its lower glass`);
    }
  }
  const group = new THREE.Group();
  group.add(src.clone(true));
  const hide = new Set(model.hide ?? []);
  if (hide.size) group.traverse((obj) => { if (hide.has(obj.name)) obj.visible = false; });
  const coin = model.coin?.length ? new CoinEntry(group, model.coin, model.id) : null;
  if (coin) reveal(group, coin.nodes);
  const trimNames = new Set(model.trim ?? []);
  if (trimNames.size) {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material): THREE.Material => {
        if (!trimNames.has(m.name) || !('color' in m)) return m;
        const c = m.clone() as THREE.MeshStandardMaterial;
        c.color.set(o.trim);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }
  liftOverlaps(group, model.onTop ?? []);
  reflectModel(group, o.dress);
  const box = new THREE.Box3().setFromObject(group);
  const s = box.getSize(new THREE.Vector3());
  const { fit, texture } = o;
  if (!deck) {
    console.info(`[arcade] ${o.name}: the ${model.id} cabinet has no button deck; its buttons stay on the glass`);
  }
  const { centre, w, h, leanDeg } = panels.glass.quad;
  const lean = THREE.MathUtils.degToRad(leanDeg);
  const out = new THREE.Vector3(0, Math.sin(lean), Math.cos(lean));
  const gc = new THREE.Vector3(...centre);
  const glassFace: CabinetFace = {
    name: 'glass', w, h,
    position: gc.clone().addScaledVector(out, 0.004),
    rotation: new THREE.Euler(-lean, 0, 0),
    src: deck ? fit.glass : fit.glassOnly,
  };
  const mat = faceMaterial(texture);
  const surfaceOf = (q: CabinetQuad): ShapedSurface | undefined =>
    [panels.glass, panels.lower, panels.buttons].find((p) => p?.surface && p.quad === q)?.surface;
  const faceMesh = (face: CabinetFace, q: CabinetQuad, lift: number): THREE.Mesh => {
    const sf = surfaceOf(q);
    return sf ? makeShapedMesh(face.name, sf, face.src, lift, mat) : makeFaceMesh(face, null, mat);
  };
  const glassMeshes = [faceMesh(glassFace, panels.glass.quad, 0.004)];
  if (deck) {
    const dl = THREE.MathUtils.degToRad(deck.leanDeg);
    const dout = new THREE.Vector3(0, Math.sin(dl), Math.cos(dl));
    glassMeshes.push(faceMesh({
      name: 'buttons', w: deck.w, h: deck.h,
      position: new THREE.Vector3(...deck.centre).addScaledVector(dout, 0.005),
      rotation: new THREE.Euler(-dl, 0, 0),
      src: fit.buttons,
    }, deck, 0.005));
  }
  if (btns && fit.deck) {
    const bl = THREE.MathUtils.degToRad(btns.leanDeg);
    const bout = new THREE.Vector3(0, Math.sin(bl), Math.cos(bl));
    const fitted = (): { w: number; h: number } => {
      if (surfaceOf(btns)) return { w: btns.w, h: btns.h };
      const box = fracAspect(fit.deck!, fit.aspect);
      if (!(box > 0)) return { w: btns.w, h: btns.h };
      return box >= btns.w / btns.h ? { w: btns.w, h: btns.w / box } : { w: btns.h * box, h: btns.h };
    };
    const { w: dw, h: dh } = fitted();
    glassMeshes.push(faceMesh({
      name: 'deck', w: dw, h: dh,
      position: new THREE.Vector3(...btns.centre).addScaledVector(bout, 0.005),
      rotation: new THREE.Euler(-bl, 0, 0),
      src: fit.deck,
    }, btns, 0.005));
  }
  for (const m of glassMeshes) group.add(m);
  return {
    group,
    glassMeshes,
    size: { W: s.x, H: s.y, D: s.z },
    ...framedOn(gc, h, lean, btns ?? deck),
    modelId: model.id,
    panels: { fixed: true, glass: w / h, buttons: deck ? deck.w / deck.h : null, deck: btns ? btns.w / btns.h : null },
    coin,
    shared: o.dress ? new Set([...sharedOf(src), ...dressShared(o.dress)]) : sharedOf(src),
  };
}

const BUTTON_SHARE = 0.245;

function framedOn(gc: THREE.Vector3, h: number, lean: number, deck: CabinetQuad | null): { glassCentre: THREE.Vector3; glassHeight: number; frameHeight: number } {
  const top = gc.y + (Math.cos(lean) * h) / 2;
  if (!deck) return { glassCentre: gc.clone().setZ(gc.z + 0.05), glassHeight: h, frameHeight: h };
  const dl = THREE.MathUtils.degToRad(deck.leanDeg);
  const bottom = deck.centre[1] - (Math.cos(dl) * deck.h) / 2;
  const z = (gc.z + deck.centre[2]) / 2 + 0.05;
  const front = deck.centre[2] + (Math.sin(dl) * deck.h) / 2;
  return { glassCentre: new THREE.Vector3(0, (top + bottom) / 2, z), glassHeight: top - bottom, frameHeight: top - bottom + (front - gc.z) / 2 };
}

export { DERIVED };
