import * as THREE from 'three';
import { ENV_INTENSITY, type CabinetDress } from './cabinetlight';
import { projectiveUvs, projectiveUvsAt, type Quad } from './quad';
import { DERIVED } from './cabinetsize';

export { DERIVED };

const TRIM = 0x1b1e23;

const SKIN_ALBEDO = 0x6a6157;

function bodyTint(colour: string): THREE.Color {
  const c = new THREE.Color(colour), a = new THREE.Color(SKIN_ALBEDO);
  return new THREE.Color(c.r / a.r, c.g / a.g, c.b / a.b);
}

function bodyMaterial(colour: THREE.Color, dress: CabinetDress | null, gloss = 1): THREE.MeshStandardMaterial {
  const skin = dress?.skin ?? null;
  const m = new THREE.MeshStandardMaterial({
    color: skin ? colour : colour.clone().multiply(new THREE.Color(SKIN_ALBEDO)),
    roughness: (skin?.arm || skin?.rough ? 1 : 0.62) * gloss,
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

export interface FruitCabinetOptions {
  glassAspect: number;
  glassSrc: Quad;
  deckAspect: number | null;
  deckSrc: Quad;
  deckRake: number;
  buttonsAspect?: number | null;
  buttonsSrc?: Quad;
  buttonsRake?: number;
  dress?: CabinetDress | null;
  trim: THREE.ColorRepresentation;
  body?: string | null;
  plastic?: boolean;
  furniture: boolean;
  style?: CabinetStyle | null;
}

export interface CabinetStyle {
  id: string;
  W: number; H: number;
  lean: number; rake?: number;
  glassTop: number;
  head: number;
  cap: 'flat' | 'round' | 'hood' | 'box';
  crown?: boolean;
  under: 'step' | 'cove' | 'slope';
  lower: number;
  body: string;
  gloss: number;
  strip: 'trim' | 'chrome';
}

const STYLE_MIN_CHIN = 0.08;

export const BODY_BLACK = '#000000';
const BODY_WOOD = '#512f19';
const ASH_GLOSS = 0.55;
const PLASTIC_ROUGH = 0.3;

export const CABINET_STYLES: readonly CabinetStyle[] = [
  { id: 'slimline', W: 0.653, H: 1.724, lean: 10, glassTop: 0.035, head: 0.28, cap: 'round', under: 'step', lower: 0.44, body: BODY_BLACK, gloss: ASH_GLOSS, strip: 'trim' },
  { id: 'cove', W: 0.653, H: 1.74, lean: 9, glassTop: 0.04, head: 0.26, cap: 'round', under: 'cove', lower: 0.42, body: BODY_BLACK, gloss: ASH_GLOSS, strip: 'trim' },
  { id: 'topbox', W: 0.653, H: 1.86, lean: 4, glassTop: 0.20, head: 0.34, cap: 'box', under: 'cove', lower: 0.44, body: BODY_BLACK, gloss: ASH_GLOSS, strip: 'trim' },
  { id: 'wedge', W: 0.653, H: 1.724, lean: 14, glassTop: 0.035, head: 0.22, cap: 'flat', under: 'slope', lower: 0.40, body: BODY_BLACK, gloss: ASH_GLOSS, strip: 'trim' },
  { id: 'classic', W: 0.653, H: 1.72, lean: 6, rake: 40, glassTop: 0.10, head: 0.32, cap: 'hood', under: 'step', lower: 0.47, body: BODY_WOOD, gloss: 1, strip: 'chrome' },
  { id: 'arch', W: 0.56, H: 1.62, crown: true, lean: 8, glassTop: 0.03, head: 0.32, cap: 'flat', under: 'cove', lower: 0.43, body: BODY_BLACK, gloss: ASH_GLOSS, strip: 'trim' },
];

export const DEFAULT_STYLE: CabinetStyle = CABINET_STYLES[0];

export function styleBody(id: string | undefined | null): string {
  return (cabinetStyle(id) ?? DEFAULT_STYLE).body;
}

export function cabinetStyle(id: string | undefined | null): CabinetStyle | null {
  return CABINET_STYLES.find((s) => s.id === id) ?? null;
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
  size: { W: number; H: number; D: number; lowerFront?: number };
  glass: { w: number; h: number; top: number; bottom: number; z: number; zFront: number };
  trim: THREE.MeshStandardMaterial;
}

const TRIM_W = 0.032;
const DECK_LIP = 0;
const DECK_MAX = 0.41;
const BUTTONS_MAX = 0.22;

function extrudeBody(shape: THREE.Shape, w: number, curveSegments = 12): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments });
  g.rotateY(-Math.PI / 2);
  g.translate(w / 2, 0, 0);
  const cap = g.groups[0];
  const uv = g.attributes.uv as THREE.BufferAttribute;
  if (cap) for (let i = cap.start; i < cap.start + cap.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
  return g;
}

export function buildFruitCabinet(opts: FruitCabinetOptions): BuiltCabinet {
  const st = opts.style ?? DEFAULT_STYLE;
  const { W, H } = st;
  const { glassAspect, deckAspect } = opts;
  const deckRake = st.rake ?? opts.deckRake;
  const glassTop = st.glassTop;
  const dress = opts.dress ?? null;
  const buttonsAspect = opts.buttonsAspect ?? null;

  let gw = W - TRIM_W * 2;
  let gh = gw / glassAspect;
  const lean = THREE.MathUtils.degToRad(st.lean);
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

  const front = Math.max(
    st.head + Math.sin(lean) * gh + Math.sin(rake) * (deck.h + DECK_LIP) + Math.sin(brake) * btn.h,
    st.lower + STYLE_MIN_CHIN);
  const D = Math.max(front, st.lower + 0.08);
  const zBack = -D / 2;
  return styledCabinet(opts, st, { W, H, D, zBack, zFront: zBack + front, faceH: gh, gw, deck, btn, lean, rake, brake, glassTop, dress });
}

const STRIP_BAND = 0.035;
const STRIP_T = 0.008;

function frontZAt(pts: readonly THREE.Vector2[], y: number, fallback: number): number {
  let z = -Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.y === b.y || (a.y - y) * (b.y - y) > 0) continue;
    z = Math.max(z, a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
  }
  return Number.isFinite(z) ? z : fallback;
}

function styledCabinet(
  opts: FruitCabinetOptions, st: CabinetStyle,
  k: {
    W: number; H: number; D: number; zBack: number; zFront: number; faceH: number; gw: number;
    deck: { w: number; h: number }; btn: { w: number; h: number };
    lean: number; rake: number; brake: number; glassTop: number; dress: CabinetDress | null;
  },
): BuiltCabinet {
  const { W, H, D, zBack, zFront, faceH, gw, deck, btn, lean, rake, brake, glassTop, dress } = k;
  const deckD = deck.h + DECK_LIP;
  const yTop = H - glassTop;
  const zMid = zFront - Math.sin(brake) * btn.h;
  const zGlassBot = zMid - Math.sin(rake) * deckD;
  const zGlassTop = zGlassBot - Math.sin(lean) * faceH;
  const yGlassBot = yTop - Math.cos(lean) * faceH;
  const yMid = yGlassBot - Math.cos(rake) * deckD;
  const yDeckFront = yMid - Math.cos(brake) * btn.h;
  const yLip = yDeckFront - 0.045;
  const zLow = zBack + st.lower;

  const shape = new THREE.Shape();
  const edge: THREE.Vector2[] = [];
  let at = new THREE.Vector2(zBack, 0);
  shape.moveTo(at.x, at.y);
  const L = (z: number, y: number, onEdge = true): void => {
    shape.lineTo(z, y);
    at = new THREE.Vector2(z, y);
    if (onEdge) edge.push(at);
  };
  const Q = (cz: number, cy: number, z: number, y: number): void => {
    const c = new THREE.QuadraticBezierCurve(at.clone(), new THREE.Vector2(cz, cy), new THREE.Vector2(z, y));
    shape.quadraticCurveTo(cz, cy, z, y);
    edge.push(...c.getPoints(10).slice(1));
    at = new THREE.Vector2(z, y);
  };
  L(zBack, H, false);
  if (st.cap === 'round') {
    const r = 0.07;
    L(zGlassTop - r, H);
    Q(zGlassTop + 0.012, H, zGlassTop + 0.012, yTop + 0.004);
  } else if (st.cap === 'hood') {
    L(zGlassTop + 0.08, H);
    L(zGlassTop + 0.08, H - 0.035);
  } else if (st.cap === 'box') {
    const bz = zGlassTop + 0.035;
    L(bz - 0.04, H);
    Q(bz, H, bz, H - 0.04);
    L(bz, yTop + 0.012);
  } else {
    L(zGlassTop, H);
  }
  L(zGlassTop, yTop);
  L(zGlassBot, yGlassBot);
  if (btn.h > 0.0005) L(zMid, yMid);
  L(zFront, yDeckFront);
  L(zFront, yLip);
  if (st.under === 'cove') {
    Q(zLow, yLip, zLow, yLip - (zFront - zLow) * 1.15);
    L(zLow + 0.03, 0.10);
    L(zLow + 0.04, 0.10);
    L(zLow + 0.04, 0);
  } else if (st.under === 'slope') {
    L(zFront - 0.03, yLip - 0.02);
    L(zLow, yLip - 0.07);
    L(zLow - 0.06, 0.08);
    L(zLow - 0.05, 0);
  } else {
    L(zFront - 0.03, yLip - 0.02);
    L(zLow, yLip - 0.06);
    L(zLow, 0.09);
    L(zLow + 0.015, 0);
  }
  shape.closePath();

  const group = new THREE.Group();
  const trimColour = new THREE.Color(opts.trim);
  const bodyMat = opts.plastic
    ? lit(new THREE.MeshStandardMaterial({ color: opts.body ?? st.body, roughness: PLASTIC_ROUGH, metalness: 0 }), dress)
    : bodyMaterial(bodyTint(opts.body ?? st.body), dress, st.gloss);
  group.add(new THREE.Mesh(extrudeBody(shape, W, 16), bodyMat));

  const trim = lit(new THREE.MeshStandardMaterial({ color: opts.trim, roughness: 0.35, metalness: 0.25 }), dress);
  const stripMat = st.strip === 'chrome'
    ? lit(new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 0.85 }), dress)
    : trim;
  const inner = edge.map((q, i) => {
    const a = edge[Math.max(0, i - 1)], b = edge[Math.min(edge.length - 1, i + 1)];
    const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
    return new THREE.Vector2(q.x + (ty / l) * STRIP_BAND, Math.max(0, q.y - (tx / l) * STRIP_BAND));
  });
  const band = new THREE.Shape([...edge.map((q) => new THREE.Vector2(q.x + 0.004, q.y)), ...inner.reverse()]);
  for (const side of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(band, { depth: STRIP_T, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    g.translate(side < 0 ? -W / 2 + STRIP_T / 2 : W / 2 + STRIP_T / 2, 0, 0);
    group.add(new THREE.Mesh(g, stripMat));
  }
  const lipBar = new THREE.Mesh(new THREE.BoxGeometry(W, yDeckFront - yLip + 0.01, 0.014), trim);
  lipBar.position.set(0, (yDeckFront + yLip) / 2, zFront + 0.004);
  group.add(lipBar);

  if (st.cap === 'box') {
    const boxH = glassTop - 0.05;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(gw, boxH), new THREE.MeshBasicMaterial({ color: trimColour.clone().multiplyScalar(0.9) }));
    glow.position.set(0, H - 0.035 - boxH / 2, zGlassTop + 0.036);
    group.add(glow);
  }
  let crownH = 0;
  if (st.crown) {
    const r = W / 2, depth = zGlassTop - zBack;
    crownH = r + 0.008;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth, 40, 1, false, Math.PI / 2, Math.PI), bodyMat);
    crown.rotation.x = Math.PI / 2;
    crown.position.set(0, H, zBack + depth / 2);
    group.add(crown);
    const face = new THREE.Mesh(new THREE.CircleGeometry(r - 0.035, 40, 0, Math.PI), new THREE.MeshBasicMaterial({ color: trimColour.clone().multiplyScalar(0.85) }));
    face.position.set(0, H + 0.01, zGlassTop + 0.002);
    group.add(face);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r - 0.004, 0.012, 8, 40, Math.PI), trim);
    ring.position.set(0, H, zGlassTop - 0.004);
    group.add(ring);
  }

  const lowerAt = (y: number): number => frontZAt(edge.filter((q) => q.y <= yLip), y, zLow);
  if (opts.furniture) {
    const mat = (c: THREE.ColorRepresentation, r: number, m = 0.08) => lit(new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }), dress);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(W * 0.44, 0.10, 0.02), mat(0x0a0b0d, 0.9));
    tray.position.set(0, 0.30, lowerAt(0.30) + 0.002);
    group.add(tray);
    const trayLip = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, W * 0.46, 20, 1, false, 0, Math.PI), trim);
    trayLip.rotation.set(0, 0, Math.PI / 2);
    trayLip.position.set(0, 0.252, lowerAt(0.252) + 0.004);
    group.add(trayLip);
    const coin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.055, 0.012), mat(0xb9c0cc, 0.3, 0.6));
    coin.position.set(W * 0.5 - 0.05, yLip - 0.12, lowerAt(yLip - 0.12) + 0.006);
    group.add(coin);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.004, 0.06, 0.02), mat(TRIM, 0.6));
    plinth.position.set(0, 0.03, lowerAt(0.03) - 0.006);
    group.add(plinth);
  }

  const clear = 0.004;
  type Seg = Parameters<typeof profileFaces>[0][number];
  const segs: Seg[] = [{ name: 'glass', tilt: lean, from: [zGlassTop, yTop], to: [zGlassBot, yGlassBot], w: gw, src: opts.glassSrc }];
  if (deck.h > 0.0005) {
    segs.push({ name: 'buttons', tilt: rake, from: [zGlassBot, yGlassBot], to: [zGlassBot + Math.sin(rake) * deck.h, yGlassBot - Math.cos(rake) * deck.h], w: deck.w, src: opts.deckSrc });
  }
  if (btn.h > 0.0005 && opts.buttonsSrc) {
    segs.push({ name: 'deck', tilt: brake, from: [zMid, yMid], to: [zFront, yDeckFront], w: btn.w, src: opts.buttonsSrc });
  }
  let lowerFront = -Infinity;
  for (const q of edge) if (q.y <= yLip - 0.05) lowerFront = Math.max(lowerFront, q.x);
  return {
    group, faces: profileFaces(segs, clear),
    size: { W, H: H + crownH, D, lowerFront: Number.isFinite(lowerFront) ? lowerFront : zLow },
    glass: { w: gw, h: faceH, top: yTop, bottom: yDeckFront, z: zGlassBot, zFront },
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
