import * as THREE from 'three';
import { ENV_INTENSITY, type CabinetDress } from './cabinetlight';
import { projectiveUvs, projectiveUvsAt, type Quad } from './quad';
import { DERIVED } from './cabinetsize';

export { DERIVED };

const BODY = 0x34383f, TRIM = 0x1b1e23;

const BODY_BASE = 0x34363c;
const BODY_TRIM_SHARE = 0.2;
export function bodyTint(trim: THREE.ColorRepresentation): THREE.Color {
  return new THREE.Color(BODY_BASE).lerp(new THREE.Color(trim), BODY_TRIM_SHARE);
}
const SKIN_ALBEDO = 0x6a6157;

function bodyMaterial(colour: THREE.Color, dress: CabinetDress | null): THREE.MeshStandardMaterial {
  const skin = dress?.skin ?? null;
  const m = new THREE.MeshStandardMaterial({
    color: skin ? colour : colour.clone().multiply(new THREE.Color(SKIN_ALBEDO)),
    roughness: skin?.arm || skin?.rough ? 1 : 0.62,
    metalness: 0.06,
  });
  if (skin) {
    m.map = skin.map;
    m.normalMap = skin.normalMap;
    m.normalScale.setScalar(skin.relief);
    if (skin.arm) { m.roughnessMap = skin.arm; m.aoMap = skin.arm; m.aoMapIntensity = 1; }
    else if (skin.rough) m.roughnessMap = skin.rough;
  }
  return lit(m, dress);
}

function lit<M extends THREE.MeshStandardMaterial>(m: M, dress: CabinetDress | null): M {
  if (dress?.env) { m.envMap = dress.env; m.envMapIntensity = ENV_INTENSITY; }
  return m;
}

function addFurniture(group: THREE.Group, W: number, zLower: number, yShelfBot: number, yPanelTop: number, tint: THREE.Color, dress: CabinetDress | null): void {
  const mat = (c: THREE.ColorRepresentation, r: number) => lit(new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.08 }), dress);
  const trim = mat(TRIM, 0.35);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); group.add(mesh); return mesh;
  };
  add(new THREE.BoxGeometry(W + 0.006, 0.022, 0.03), trim, 0, yShelfBot - 0.012, zLower + 0.004);
  add(new THREE.BoxGeometry(W + 0.006, 0.075, 0.035), trim, 0, 0.042, zLower + 0.006);
  const trayTop = 0.36;
  const panelH = Math.max(0, (yPanelTop - trayTop - 0.02) * 0.85);
  if (panelH > 0.05) {
    add(new THREE.BoxGeometry(W * 0.88, panelH, 0.012), mat(tint.clone().multiplyScalar(0.16), 0.7),
        0, yPanelTop - 0.01 - panelH / 2, zLower + 0.008);
  }
  const trayY = 0.30;
  add(new THREE.BoxGeometry(W * 0.44, 0.10, 0.02), mat(0x0a0b0d, 0.9), 0, trayY, zLower + 0.010);
  const lip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.052, W * 0.46, 20, 1, false, 0, Math.PI),
    mat(TRIM, 0.4));
  lip.rotation.set(0, 0, Math.PI / 2);
  lip.position.set(0, trayY - 0.048, zLower + 0.012);
  group.add(lip);
  add(new THREE.BoxGeometry(0.012, 0.055, 0.012), mat(0xb9c0cc, 0.3),
      W * 0.5 - 0.02, yShelfBot - 0.055, zLower + 0.014);
}

export interface FruitCabinetOptions {
  glassAspect: number;
  glassSrc: Quad;
  glassLean: number;
  deckAspect: number | null;
  deckSrc: Quad;
  deckRake: number;
  buttonsAspect?: number | null;
  buttonsSrc?: Quad;
  buttonsRake?: number;
  glassTop: number;
  tint: THREE.Color | null;
  dress?: CabinetDress | null;
  trim: THREE.ColorRepresentation;
  furniture: boolean;
}

export interface CabinetFace {
  name: string;
  w: number;
  h: number;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  src: Quad;
}

export interface BuiltCabinet {
  group: THREE.Group;
  faces: CabinetFace[];
  size: { W: number; H: number; D: number };
  glass: { w: number; h: number; top: number; bottom: number; z: number; zFront: number };
  trim: THREE.MeshStandardMaterial;
}

const TRIM_W = 0.032;
const DECK_LIP = 0;
const DECK_MAX = 0.41;
const BUTTONS_MAX = 0.22;

export function buildFruitCabinet(opts: FruitCabinetOptions): BuiltCabinet {
  const { width: W, height: H, depth: D } = DERIVED;
  const { glassAspect, deckAspect, glassLean, deckRake, glassTop, tint, furniture } = opts;
  const dress = opts.dress ?? null;
  const buttonsAspect = opts.buttonsAspect ?? null;

  let gw = W - TRIM_W * 2;
  let gh = gw / glassAspect;
  const lean = THREE.MathUtils.degToRad(glassLean);
  const rake = THREE.MathUtils.degToRad(deckRake);
  const brake = THREE.MathUtils.degToRad(opts.buttonsRake ?? deckRake);

  const deckOf = (width: number): { w: number; h: number } => {
    let h = deckAspect ? width / deckAspect : 0;
    let w = width;
    if (h > DECK_MAX) { h = DECK_MAX; w = h * deckAspect!; }
    return { w, h };
  };
  let deck = deckOf(gw);
  const btnOf = (width: number): { w: number; h: number } => {
    let h = buttonsAspect ? width / buttonsAspect : 0;
    let w = width;
    if (h > BUTTONS_MAX) { h = BUTTONS_MAX; w = h * buttonsAspect!; }
    return { w, h };
  };
  let btn = btnOf(gw);
  const FOOT_ROOM = 0.5;
  const maxGh = (H - glassTop - FOOT_ROOM - Math.cos(rake) * deck.h - Math.cos(brake) * btn.h) / Math.cos(lean);
  if (gh > maxGh) { gh = maxGh; gw = gh * glassAspect; deck = deckOf(gw); btn = btnOf(gw); }

  const faceH = gh;
  const deckW = deck.w;
  const bandH = deck.h;
  const deckD = bandH + DECK_LIP;

  const zBack = -D / 2, zFront = D / 2;
  const yTop = H - glassTop;
  const btnH = btn.h;
  const zDeckFront = zFront;
  const zMid = zDeckFront - Math.sin(brake) * btnH;
  const zGlassBot = zMid - Math.sin(rake) * deckD;
  const zGlassTop = zGlassBot - Math.sin(lean) * faceH;
  const yGlassBot = yTop - Math.cos(lean) * faceH;
  const yMid = yGlassBot - Math.cos(rake) * deckD;
  const yDeckFront = yMid - Math.cos(brake) * btnH;
  const yLip = yDeckFront - 0.045;
  const zLower = zDeckFront - D * 0.12;

  const shape = new THREE.Shape();
  shape.moveTo(zBack, 0);
  shape.lineTo(zBack, H);
  shape.lineTo(zGlassTop, H);
  shape.lineTo(zGlassTop, yTop);
  shape.lineTo(zGlassBot, yGlassBot);
  if (btnH > 0.0005) shape.lineTo(zMid, yMid);
  shape.lineTo(zDeckFront, yDeckFront);
  shape.lineTo(zDeckFront, yLip);
  shape.lineTo(zLower, yLip - 0.03);
  shape.lineTo(zLower, 0.09);
  shape.lineTo(zLower + 0.02, 0);
  shape.closePath();

  const extrude = (w: number) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    g.translate(w / 2, 0, 0);
    const cap = g.groups[0];
    const uv = g.attributes.uv as THREE.BufferAttribute;
    if (cap) for (let i = cap.start; i < cap.start + cap.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
    return g;
  };
  const group = new THREE.Group();
  const bodyColour = tint ?? new THREE.Color(BODY_BASE);
  group.add(new THREE.Mesh(extrude(W), bodyMaterial(bodyColour, dress)));

  const trim = lit(new THREE.MeshStandardMaterial({ color: opts.trim, roughness: 0.35, metalness: 0.25 }), dress);
  const tw = (W - gw) / 2;
  const edge = new THREE.Shape();
  const t = 0.018;
  edge.moveTo(zGlassTop - 0.02, yTop + 0.01);
  edge.lineTo(zGlassTop + t, yTop + 0.01);
  edge.lineTo(zGlassBot + t, yGlassBot + 0.004);
  if (btnH > 0.0005) edge.lineTo(zMid + 0.01, yMid + 0.008);
  edge.lineTo(zDeckFront + 0.008, yDeckFront + 0.012);
  edge.lineTo(zDeckFront + 0.008, yLip);
  edge.lineTo(zDeckFront - 0.05, yLip);
  edge.lineTo(zGlassBot - 0.05, yGlassBot - 0.04);
  edge.lineTo(zGlassTop - 0.05, yTop - 0.02);
  edge.closePath();
  for (const side of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(edge, { depth: tw, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 });
    g.rotateY(-Math.PI / 2);
    g.translate(side < 0 ? -W / 2 + tw : W / 2, 0, 0);
    group.add(new THREE.Mesh(g, trim));
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(W, 0.022, 0.03), trim);
  bar.position.set(0, yTop + 0.006, zGlassTop + 0.002);
  bar.rotation.x = -lean;
  group.add(bar);
  const lipBar = new THREE.Mesh(new THREE.BoxGeometry(W, yDeckFront - yLip + 0.01, 0.014), trim);
  lipBar.position.set(0, (yDeckFront + yLip) / 2, zDeckFront + 0.004);
  group.add(lipBar);

  if (furniture) addFurniture(group, W, zLower, yLip - 0.03, yLip - 0.07, tint ?? new THREE.Color(BODY), dress);

  const clear = 0.004;
  type Seg = { name: string; tilt: number; from: [number, number]; to: [number, number]; w: number; src: CabinetFace['src'] };
  const segs: Seg[] = [{ name: 'glass', tilt: lean, from: [zGlassTop, yTop], to: [zGlassBot, yGlassBot], w: gw, src: opts.glassSrc }];
  if (bandH > 0.0005) {
    const yb = yGlassBot - Math.cos(rake) * bandH;
    const zb = zGlassBot + Math.sin(rake) * bandH;
    segs.push({ name: 'buttons', tilt: rake, from: [zGlassBot, yGlassBot], to: [zb, yb], w: deckW, src: opts.deckSrc });
  }
  if (btnH > 0.0005 && opts.buttonsSrc) {
    segs.push({ name: 'deck', tilt: brake, from: [zMid, yMid], to: [zDeckFront, yDeckFront], w: btn.w, src: opts.buttonsSrc });
  }
  const faces = profileFaces(segs, clear);
  return {
    group, faces, size: { W, H, D },
    glass: { w: gw, h: gh, top: yTop, bottom: yDeckFront, z: zGlassBot, zFront: zDeckFront },
    trim,
  };
}

export function profileFaces(
  segs: { name: string; tilt: number; from: [number, number]; to: [number, number]; w: number; src: CabinetFace['src'] }[],
  clear: number,
): CabinetFace[] {
  const t0 = segs[0]?.tilt ?? 0;
  const v: [number, number] = [Math.cos(t0) * clear, Math.sin(t0) * clear];
  return segs.map((sg) => ({
    name: sg.name,
    w: sg.w, h: Math.hypot(sg.to[0] - sg.from[0], sg.to[1] - sg.from[1]),
    position: new THREE.Vector3(0, (sg.from[1] + sg.to[1]) / 2 + v[1], (sg.from[0] + sg.to[0]) / 2 + v[0]),
    rotation: new THREE.Euler(-sg.tilt, 0, 0),
    src: sg.src,
  }));
}

export function faceMaterial(texture: THREE.Texture | null): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map: texture });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 uvq;\nvarying vec3 vUvq;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvUvq = uvq;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vUvq;')
      .replace('#include <map_fragment>', [
        '#ifdef USE_MAP',
        'diffuseColor *= texture2D( map, vUvq.xy / vUvq.z );',
        '#endif',
      ].join('\n'));
  };
  m.customProgramCacheKey = () => 'fruitulator-face-uvq';
  return m;
}

export function makeFaceMesh(face: CabinetFace, texture: THREE.Texture | null, material?: THREE.Material): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(face.w, face.h);
  const q = projectiveUvs(face.src) ?? [0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1];
  geo.setAttribute('uvq', new THREE.Float32BufferAttribute(q, 3));
  const m = new THREE.Mesh(geo, material ?? faceMaterial(texture));
  m.position.copy(face.position);
  m.rotation.copy(face.rotation);
  m.userData.src = face.src;
  m.userData.face = face.name;
  return m;
}

export function makeShapedMesh(
  name: string,
  surface: { tris: ArrayLike<number>; frac: ArrayLike<number>; quad: { leanDeg: number } },
  src: Quad, lift: number, material: THREE.Material,
): THREE.Mesh {
  const l = THREE.MathUtils.degToRad(surface.quad.leanDeg);
  const oy = Math.sin(l) * lift;
  const oz = Math.cos(l) * lift;
  const n = surface.tris.length / 3;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = surface.tris[i * 3];
    pos[i * 3 + 1] = surface.tris[i * 3 + 1] + oy;
    pos[i * 3 + 2] = surface.tris[i * 3 + 2] + oz;
    uv[i * 2] = surface.frac[i * 2];
    uv[i * 2 + 1] = 1 - surface.frac[i * 2 + 1];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const q = projectiveUvsAt(surface.frac, src) ?? Array.from(uv, (v, i) => (i % 2 ? [v, 1] : [v])).flat();
  geo.setAttribute('uvq', new THREE.Float32BufferAttribute(q, 3));
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, material);
  m.userData.src = src;
  m.userData.face = name;
  m.userData.shaped = true;
  return m;
}
