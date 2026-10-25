import * as THREE from 'three';
import { buildShell, DERIVED, modelFor, type CabinetShell } from './cabinets';
import { cabinetDress, ENV_INTENSITY } from './cabinetlight';
import { releaseStand, retireShell } from './slotgpu';
import { backReach, framingDistance, glassPointAt, glassWorld, glassWorldPoint, TILT_DOWN, TILT_UP, walkUpView, type GlassHit } from './glasshit';
import { CANVAS_OVER_GLASS_Z, GlassOverlay, glassPieces, holeGlass } from './glassflat';
import { PlayPointer } from '../web/play/pointer';
import { KeyHintLayer, type HintPlace } from '../web/keyhints';
import type { CabLamp } from '../web/dat';
import { Glass, glassCost, glassTotals, TEX_LIVE } from './glass';
import { Live } from './live';
import { str } from '../web/i18n';
import { UI_ICONS } from '../web/ui/icons';
import { displayTitle } from '../web/gamelist';
import type { ArcadeMachine } from './machines';
import { banksPlan, gridPlan, type RoomPlan, type Stand } from './floor';
import type { Place } from './doc';
import { BANK_MARGINS, buildRoom, dimMaterials, lightPool, type Dressing } from './dressing';
import { glowPlan, makeGlow, type GlassGlow } from './glassglow';
import { copyLook, lookOf as roomLook, neonMotionOn, REDUCED_MOTION, type RoomLook } from './roomlook';
import { DPR_CAP, glassSaid, roomSwitches, switchesSaid, type RoomSwitches } from './roomperf';
import { PropLayer } from './proplayer';
import type { Prop } from './proplist';
import { GpuTimer } from './roombench';
import { setSurfaceOptions } from './roomtextures';
import { BuildOnce } from './buildonce';
import { WalkGrid, type Pt, type Rect } from './walkpath';
import { aisleClick, AT_MACHINE_TAU_S, easeShare, GLIDE_TAU_S, letGoOnFocusLoss, ORBIT_SPRING_TAU_S, walkIntent, walkMove } from './walkkeys';
import { arcadeSign } from './sign';
import { reelAt } from '../web/play/peek';
import { reelPeekOn } from '../web/peekpref';

const DEV_ROOM = import.meta.env.DEV;

const ARRIVED_M = 0.02;
const ASK_BY_MS = 1500;
const NAME_NOTE_MS = 2500;
const READY_WAIT_MS = 60_000;
const EYE = 1.6;
const AISLE_Z = 2.3;
const REST_SLOPE = (1.1 - EYE) / AISLE_Z;
const SIGN_Y_M = 2.5;
const NEAR_M = Math.hypot(AISLE_Z, 1.6);
const MID_M = Math.hypot(AISLE_Z, 4.0);
const MID_MS = 200;
const FOCUS_ROOM_DIM = 0.05;
const FROZEN_GLASS_DIM = Math.pow(0.15, 2.2);
const FOCUS_LAMP_COLOUR = 0xffe2c0;
const FOCUS_LAMP_CANDELA = 14;
const FOCUS_LAMP_ANGLE = 0.7;
const FOCUS_LAMP_ABOVE_M = 0.7;
const FOCUS_LAMP_FORWARD_M = 0.6;
const FOCUS_DIM_MS = 450;
const FOCUS_LIFT = 1.6;
const VIEW_FOV = 50;
const VIEW_DIR = { x: 0.3, y: 1.1, z: 1 };
const VIEW_LOOK_Y = 0.9;
const CAB_TOP_M = 1.9;
const VIEW_FILL = 0.92;

export interface CameraModes { look: boolean; orbit: boolean }

const LOOK_UP = THREE.MathUtils.degToRad(20);
const LOOK_DOWN = THREE.MathUtils.degToRad(25);
const FOV_MIN = 25;
const FOV_MAX = 70;
const ORBIT_YAW = THREE.MathUtils.degToRad(60);
const ORBIT_BACK_MAX = 2.5;
const ORBIT_IN_MIN = 0.35;
const ROOM_FOV = 50;
const AT_MACHINE_FOV_MAX = 90;
const WALK_SPEED = 3.0;
const TURN_SPEED = 1.8;
const AUTO_TURN_SPEED = 6;
const BODY_R = 0.3;
const WALL_STAND_M = 1.0;
const FACE_NEAR_M = 3.2;
const DOOR_AT_M = 0.6;
const AHEAD_CONE = 0.45;
const AHEAD_M = 8;

const ALIVE_GAP_MS = 50;

function lookOf(g: Glass): string {
  return JSON.stringify([g.shellFit(), g.cabinetStyle, g.trim]);
}

interface Slot {
  glass: Glass;
  x: number;
  spot: Stand;
  shell: CabinetShell | null;
  holder: THREE.Group;
  loaded: boolean;
  shown: boolean;
  shellSeq: number;
  shellLook: string;
  bounds: THREE.Sphere | null;
  glow: GlassGlow | null;
  glowFrom: { left: number | null; right: number | null };
  box: THREE.Box3 | null;
}

export interface RoomStats {
  fps: number;
  frameMs: number;
  paints: number;
  cabinets: number;
  loaded: number;
  attract: number;
  live: string;
}

export class Room {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(ROOM_FOV, 1, 0.05, 60);
  private lookFov = ROOM_FOV;
  readonly live = (() => {
    const l = new Live();
    l.onWalkAway = () => this.stepBack();
    return l;
  })();
  readonly slots: Slot[] = [];
  plan: RoomPlan & { doorX?: number };
  room: Dressing;
  private readonly pos = { x: 0, z: 0 };
  private walk: WalkGrid;
  private route: Pt[] = [];
  private arriveFace: number | null = null;
  private turnTo: number | null = null;
  private arrivePitch: number | null = null;
  private focus: Slot | null = null;
  get playedGlassSaid(): string {
    if (!import.meta.env.DEV) return '';
    const f = this.focus;
    const ov = f ? this.overlays.get(f) : undefined;
    return glassSaid(ov?.showing ? ov.shownSaid : '-');
  }
  private readonly camPos = new THREE.Vector3(0, EYE, AISLE_Z);
  private readonly camLook = new THREE.Vector3(0, 1.1, 0);
  private readonly raycaster = new THREE.Raycaster();
  private readonly frustum = new THREE.Frustum();
  private readonly t0 = performance.now();
  private readonly keys = new Set<string>();
  walkHeld: -1 | 0 | 1 = 0;
  turnHeld: -1 | 0 | 1 = 0;
  private drag: { x: number; y: number; yaw: number; pitch: number; moved: boolean; id: number } | null = null;
  readonly modes: CameraModes = { look: true, orbit: true };
  private readonly head = { yaw: Math.PI, pitch: 0 };
  private readonly pinch = new Map<number, { x: number; y: number }>();
  private pinchStart: { d: number; fov: number } | null = null;
  private readonly orbit = { yaw: 0, pitch: 0, back: 1 };
  private orbitDrag: { id: number; x: number; y: number; yaw: number; pitch: number } | null = null;
  private readonly orbitPinch = new Map<number, { x: number; y: number }>();
  private orbitPinchStart: { d: number; back: number } | null = null;
  private peeking: { id: number; glass: Glass } | null = null;
  private readonly caps = new PlayPointer<GlassHit>({
    at: (e) => (this.focus && this.live.glass === this.focus.glass ? this.glassPoint(e) : null),
    press: (hit, id) => { this.live.pressHit(id, hit); },
    release: (id) => this.live.release(id),
    capture: (id) => this.renderer.domElement.setPointerCapture(id),
  });
  private lastFrameAt = 0;
  private readonly frameTimes: number[] = [];
  private readonly glassTimes: number[] = [];
  private readonly renderTimes: number[] = [];
  private paintsThisSecond = 0;
  private paintsLastSecond = 0;
  private secondAt = 0;
  private shot: { slot?: Slot; wide?: boolean; three?: Slot } | null = null;
  private snap = false;
  private glide = false;
  locked = false;
  get paused(): boolean { return this.pausedBy; }
  set paused(v: boolean) {
    this.pausedBy = v;
    if (v) this.releaseHeld();
  }
  private pausedBy = false;
  onFocus?: (slot: { machine: ArcadeMachine; mode: string } | null) => void;
  onLeave?: () => void;
  private sayWhenArrived: { s: Slot; show: () => void; by: number } | null = null;

  constructor(readonly host: HTMLElement, machines: ArcadeMachine[], opts: { name?: string | null; look?: RoomLook; props?: Prop[] } = {}) {
    this.switches = roomSwitches();
    setSurfaceOptions(this.switches);
    this.renderer = new THREE.WebGLRenderer({ antialias: this.switches.aa, powerPreference: 'high-performance', alpha: true });
    this.renderer.setPixelRatio(this.switches.dpr ?? Math.min(devicePixelRatio, DPR_CAP));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.setClearColor(0x000000, 0);
    host.style.background = '#020203';
    const cs = this.renderer.domElement.style;
    cs.position = 'relative';
    cs.zIndex = String(CANVAS_OVER_GLASS_Z);
    const size = { width: DERIVED.width, depth: DERIVED.depth };
    this.plan = machines.length && machines.every((m) => m.place)
      ? gridPlan(machines.map((m) => m.place!), size)
      : banksPlan(machines.length, size, BANK_MARGINS);
    this.look = opts.look ?? roomLook(null);
    this.name = opts.name ?? null;
    this.room = buildRoom(this.plan.box, this.renderer, this.look, this.switches, this.plan.doorX);
    this.room.motion = neonMotionOn();
    if (typeof matchMedia === 'function') {
      matchMedia(REDUCED_MOTION).addEventListener('change', () => { this.room.motion = neonMotionOn(); });
    }
    this.props = new PropLayer(this.plan.box, this.renderer);
    this.props.set(opts.props ?? []);
    this.scene.add(this.props.group);
    this.walk = this.walkGrid();
    this.scene.add(this.room.group);
    void this.hangSign();
    machines.forEach((m, i) => this.slots.push(this.makeSlot(m, this.plan.spots[i])));
    this.rebuildGlows();
    for (const s of this.slots) void this.placeShell(s);
    const first = [...this.slots].sort((a, b) => a.spot.z - b.spot.z || a.spot.x - b.spot.x)[0];
    if (first) this.standBefore(first);
    else {
      const b = this.plan.box;
      this.pos.x = (b.minX + b.maxX) / 2;
      this.pos.z = (b.minZ + b.maxZ) / 2;
      this.head.yaw = Math.PI;
    }
    this.camPos.set(this.pos.x, EYE, this.pos.z);
    this.snap = true;
    this.bindInput();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.live.keys.layer = new KeyHintLayer(host);
    this.live.hintPlace = () => this.hintPlace();
  }

  private paintTokens = 2;
  private lastPaintTick = 0;
  private gpuTimer: GpuTimer | null = null;
  startGpuTimer(): GpuTimer | null {
    const gl = this.renderer.getContext();
    this.gpuTimer = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? new GpuTimer(gl) : null;
    return this.gpuTimer;
  }
  stopGpuTimer(): void { this.gpuTimer = null; }
  currentGpuTimer(): GpuTimer | null { return this.gpuTimer; }
  readonly props: PropLayer;
  private walkGrid(): WalkGrid {
    return new WalkGrid(this.plan.box, [...this.plan.spots.map(footprintOf), ...this.props.footprints()], BODY_R);
  }

  setProps(props: Prop[]): void {
    this.props.set(props);
    this.walk = this.walkGrid();
    if (!this.walk.free(this.pos.x, this.pos.z)) {
      const p = this.walk.nearestFree(this.pos);
      this.pos.x = p.x;
      this.pos.z = p.z;
    }
    const had = this.route.length > 0;
    this.route = this.walk.replan(this.pos, this.route);
    if (had && !this.route.length) {
      this.turnTo = null;
      this.arrivePitch = null;
    }
  }

  readonly switches: RoomSwitches;
  private readonly intervals: number[] = [];
  private gpuName: string | null = null;

  perf(): { fps: number; intervalMs: number; calls: number; triangles: number; textures: number; lights: number;
    px: string; dpr: number; gpu: string; switches: string;
    paints: number; patches: number; wholes: number; layoutMs: number; copyMs: number; renderMs: number } {
    const iv = this.intervals;
    const mean = iv.length ? iv.reduce((a, b) => a + b, 0) / iv.length : 0;
    if (this.gpuName === null) {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpuName = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    }
    const c = this.renderer.domElement;
    const info = this.renderer.info;
    const g = { ...glassCost };
    glassCost.layoutMs = glassCost.copyMs = glassCost.n = glassCost.patches = glassCost.wholes = 0;
    const rt = this.renderTimes.slice(-60);
    const renderMs = rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : 0;
    return {
      fps: mean ? Math.round(1000 / mean) : 0,
      intervalMs: +mean.toFixed(1),
      calls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      lights: this.room.lights,
      px: `${c.width}x${c.height}`,
      dpr: +this.renderer.getPixelRatio().toFixed(2),
      gpu: this.gpuName,
      switches: import.meta.env.DEV ? `${switchesSaid(this.switches)} ${this.playedGlassSaid}` : '',
      paints: g.n,
      patches: g.patches,
      wholes: g.wholes,
      layoutMs: g.n ? +(g.layoutMs / g.n).toFixed(1) : 0,
      copyMs: g.n ? +(g.copyMs / g.n).toFixed(1) : 0,
      renderMs: +renderMs.toFixed(1),
    };
  }

  rearrange(places: Map<string, Place>): void {
    if (!this.slots.length) return;
    const cells = this.slots.map((s) => places.get(s.glass.machine.id) ?? null);
    if (cells.some((c) => !c)) return;
    const plan = gridPlan(cells as Place[], { width: DERIVED.width, depth: DERIVED.depth });
    const a = this.plan.box;
    const b = plan.box;
    if (a.minX !== b.minX || a.maxX !== b.maxX || a.minZ !== b.minZ || a.maxZ !== b.maxZ) {
      this.scene.remove(this.room.group);
      if (this.sign) { this.room.group.remove(this.sign); disposeSign(this.sign); this.sign = null; }
      this.room.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const m of mats) m.dispose();
      });
      this.room = buildRoom(b, this.renderer, this.look, this.switches, plan.doorX);
      this.room.motion = neonMotionOn();
      this.scene.add(this.room.group);
      void this.hangSign();
    }
    this.plan = plan;
    this.props.setBox(b);
    this.walk = this.walkGrid();
    this.slots.forEach((s, i) => {
      const spot = plan.spots[i];
      s.spot = spot;
      s.x = spot.x;
      s.holder.position.set(spot.x, 0, spot.z);
      s.holder.rotation.y = spot.yaw;
      s.holder.updateMatrixWorld(true);
      if (s.shell) {
        s.bounds = new THREE.Box3().setFromObject(s.holder).getBoundingSphere(new THREE.Sphere());
        s.box = new THREE.Box3().setFromObject(s.shell.group);
      }
    });
    if (!this.walk.free(this.pos.x, this.pos.z)) {
      const p = this.walk.nearestFree(this.pos);
      this.pos.x = p.x;
      this.pos.z = p.z;
    }
    this.route = [];
    this.rebuildGlows();
  }

  private makeSlot(m: ArcadeMachine, spot: Stand): Slot {
    const holder = new THREE.Group();
    holder.position.set(spot.x, 0, spot.z);
    holder.rotation.y = spot.yaw;
    this.scene.add(holder);
    if (m.held && !this.switches.glow) holder.add(lightPool());
    return { glass: new Glass(m), x: spot.x, spot, shell: null, holder, loaded: false, shown: false, shellSeq: 0, shellLook: '', bounds: null, box: null, glow: null, glowFrom: { left: null, right: null } };
  }

  private static machineKey(m: ArcadeMachine): string {
    return JSON.stringify({ ...m, place: undefined });
  }

  private dropSlot(s: Slot): void {
    this.forgetSlot(s);
    if (s.glow) { s.holder.remove(s.glow.group); s.glow.dispose(); s.glow = null; }
    releaseStand(s.holder, s.shell, s.glass.texture);
    s.shell = null;
    this.scene.remove(s.holder);
  }

  private forgetSlot(s: Slot): void {
    if (this.focus === s) this.stepBack();
    const ov = this.overlays.get(s);
    if (ov) { ov.dispose(); this.overlays.delete(s); }
    s.glass.overlaid = false;
    this.builds.forget(s);
    s.shellSeq++;
  }

  sync(machines: ArcadeMachine[]): boolean {
    if (!machines.length || !this.slots.length || machines.some((m) => !m.place)) return false;
    const old = new Map(this.slots.map((s) => [s.glass.machine.id, s]));
    const next: Slot[] = [];
    const fresh: Slot[] = [];
    for (const m of machines) {
      const s = old.get(m.id);
      if (s && Room.machineKey(s.glass.machine) === Room.machineKey(m)) { old.delete(m.id); next.push(s); continue; }
      const n = this.makeSlot(m, this.plan.spots[0]);
      next.push(n);
      fresh.push(n);
    }
    for (const s of old.values()) this.dropSlot(s);
    this.slots.splice(0, this.slots.length, ...next);
    this.rearrange(new Map(machines.map((m) => [m.id, m.place!])));
    for (const s of fresh) void this.standFresh(s);
    return true;
  }

  private async standFresh(s: Slot): Promise<void> {
    await this.placeShell(s);
    const gone = (): boolean => !this.slots.includes(s);
    if (!s.glass.machine.held || gone()) return;
    if (await s.glass.restore()) {
      s.shown = true;
      if (gone()) return;
      await this.placeShell(s);
    }
    if (!gone()) await this.buildQuietly(s);
  }

  private look: RoomLook;
  private readonly name: string | null;
  private sign: THREE.Mesh | null = null;
  private signSeq = 0;

  private async hangSign(): Promise<void> {
    const seq = ++this.signSeq;
    if (!this.name || !this.look.signOn) {
      if (this.sign) { this.room.group.remove(this.sign); disposeSign(this.sign); this.sign = null; }
      return;
    }
    const b = this.room.box;
    const sign = await arcadeSign(this.name, this.renderer, this.look.sign);
    if (seq !== this.signSeq) { disposeSign(sign.mesh); return; }
    sign.mesh.position.set((b.minX + b.maxX) / 2, SIGN_Y_M - sign.nameUp, b.minZ + 0.02);
    if (this.sign) { this.room.group.remove(this.sign); disposeSign(this.sign); }
    this.sign = sign.mesh;
    this.room.group.add(sign.mesh);
  }

  restyle(look: RoomLook): void {
    const signChanged = look.sign !== this.look.sign || look.signOn !== this.look.signOn;
    this.look = copyLook(look);
    this.room.restyle(this.look);
    if (signChanged) void this.hangSign();
  }

  private hintView = '';

  private hintPlace(): HintPlace | null {
    const s = this.focus;
    const g = s?.glass;
    if (!s?.shell || !g?.cab || this.live.glass !== g) return null;
    const shell = s.shell;
    const cab = g.cab;
    const rig = shell.rig;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const onScreen = (w: THREE.Vector3): { x: number; y: number } | null => {
      const v = w.clone().project(this.camera);
      if (v.z > 1 || v.z < -1) return null;
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    };
    let coinAt: THREE.Vector3 | null | undefined;
    return (h) => {
      if (rig) {
        const i = g.mountLamps.findIndex((n) => n !== null && cab.lamps[n]?.button !== undefined && h.id === `btn:${cab.lamps[n].button}`);
        const mark = i >= 0 ? rig.markOf(i) : null;
        if (mark) return onScreen(mark.at);
        if (h.lamp && g.replaced.has(h.lamp as CabLamp) && rig.coin.length) {
          if (coinAt === undefined) {
            const box = new THREE.Box3();
            for (const n of rig.coin) box.expandByObject(n);
            coinAt = box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
          }
          return coinAt ? onScreen(coinAt) : null;
        }
      }
      if (!h.at || (h.lamp && g.replaced.has(h.lamp as CabLamp))) return null;
      const w = glassWorldPoint(shell, g, h.at.x, h.at.y);
      return w ? onScreen(w) : null;
    };
  }

  async loadAll(parallel = 2): Promise<void> {
    this.openTimes.start = performance.now();
    const kept: Slot[] = [];
    await Promise.all(this.slots.map(async (s) => {
      if (!(await s.glass.restore())) return;
      s.shown = true;
      kept.push(s);
      await this.placeShell(s);
    }));
    this.openTimes.fronts = performance.now();
    const far = (s: Slot): number => Math.hypot(s.x - this.camPos.x, s.spot.z - this.camPos.z);
    const order = this.slots.filter((s) => !s.shown).sort((a, b) => far(a) - far(b));
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < order.length) await this.buildQuietly(order[next++]);
    };
    await Promise.all(Array.from({ length: parallel }, worker));
    this.openTimes.built = performance.now();
    void this.bringAlive(kept).then(() => { this.openTimes.loaded = performance.now(); });
  }

  private readonly builds = new BuildOnce<Slot>((s) => this.slots.includes(s));

  build(s: Slot): Promise<void> {
    return this.builds.run(s, (live) => this.buildNow(s, live));
  }

  private buildQuietly(s: Slot): Promise<void> {
    return this.build(s).catch((e: unknown) => {
      console.info(`[arcade] ${s.glass.machine.name}: not built (${(e as Error)?.message ?? e}); walking up to it tries again`);
    });
  }

  private async buildNow(s: Slot, live: () => boolean): Promise<void> {
    const t0 = performance.now();
    await s.glass.load();
    if (!live()) return;
    if (s.glass.mode === 'failed') throw new Error(s.glass.note || 'the game could not be opened');
    const t1 = performance.now();
    if (s.glass.playAttract(0, this.switches.glassTex)) {
      s.glass.lastPaint = performance.now();
      this.renderer.initTexture(s.glass.texture);
    }
    const t2 = performance.now();
    void s.glass.save();
    s.loaded = true;
    s.shown = true;
    if (s.shellLook !== lookOf(s.glass)) await this.placeShell(s);
    const t3 = performance.now();
    const T = s.glass.times;
    T.paint += t2 - t1;
    T.shell += t3 - t2;
    T.total += t3 - t0;
  }

  private async bringAlive(kept: Slot[]): Promise<void> {
    const left = new Set(kept);
    const cam = this.camera.position;
    while (left.size) {
      let best: Slot | null = null;
      let bestD = Infinity;
      for (const s of left) {
        const d = Math.hypot(s.x - cam.x, s.spot.z - cam.z);
        if (d < bestD) { bestD = d; best = s; }
      }
      left.delete(best!);
      if (!this.slots.includes(best!)) continue;
      await this.buildQuietly(best!);
      await new Promise((r) => setTimeout(r, ALIVE_GAP_MS));
      while (this.focus && this.live.glass && !this.live.running) await new Promise((r) => setTimeout(r, 200));
    }
  }

  readonly openTimes = { start: 0, fronts: 0, built: 0, loaded: 0, ready: 0 };

  loadTimings(): { name: string; mode: string; times: Glass['times'] }[] {
    return this.slots.map((s) => ({ name: s.glass.machine.name, mode: s.glass.mode, times: { ...s.glass.times } }));
  }

  private async placeShell(s: Slot): Promise<void> {
    const seq = ++s.shellSeq;
    const model = await modelFor(s.glass.cabinetStyle, this.slots.indexOf(s), s.glass.machine.setup.cabinet);
    const shell = await buildShell({
      fit: s.glass.shellFit(), texture: s.glass.texture, model,
      trim: s.glass.trim, name: s.glass.machine.name,
      dress: cabinetDress(this.renderer, this.switches.env),
    });
    if (seq !== s.shellSeq) { retireShell(s.holder, shell, s.glass.texture); return; }
    s.shellLook = lookOf(s.glass);
    if (s.shell) retireShell(s.holder, s.shell, s.glass.texture);
    s.shell = shell;
    s.holder.add(shell.group);
    this.freezeOthers();
    s.glass.attachRig(shell.rig, shell.modelId);
    s.holder.updateMatrixWorld(true);
    s.bounds = new THREE.Box3().setFromObject(s.holder).getBoundingSphere(new THREE.Sphere());
    s.box = new THREE.Box3().setFromObject(shell.group);
  }

  private before(s: Slot): Pt {
    const at = (d: number): Pt => ({ x: s.spot.x + Math.sin(s.spot.yaw) * d, z: s.spot.z + Math.cos(s.spot.yaw) * d });
    for (let d = AISLE_Z; d >= 0.9; d -= 0.1) {
      const p = at(d);
      if (this.walk.free(p.x, p.z)) return p;
    }
    return this.walk.nearestFree(at(AISLE_Z));
  }

  private standBefore(s: Slot): void {
    const p = this.before(s);
    this.pos.x = p.x;
    this.pos.z = p.z;
    this.head.yaw = Math.atan2(s.spot.x - p.x, s.spot.z - p.z);
    this.head.pitch = 0;
    this.route = [];
    this.turnTo = null;
    this.arrivePitch = null;
  }

  goTo(p: Pt): void {
    const r = this.walk.route(this.pos, p);
    if (!r) return;
    this.route = r;
    this.turnTo = null;
    this.arrivePitch = null;
    const end = r.length ? r[r.length - 1] : { x: this.pos.x, z: this.pos.z };
    let best: Slot | null = null;
    let bestD = FACE_NEAR_M;
    for (const s of this.slots) {
      const dx = end.x - s.spot.x;
      const dz = end.z - s.spot.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD && dx * Math.sin(s.spot.yaw) + dz * Math.cos(s.spot.yaw) > 0.3) { best = s; bestD = d; }
    }
    this.arriveFace = best ? Math.atan2(best.spot.x - end.x, best.spot.z - end.z) : null;
    if (!r.length && this.arriveFace !== null) this.turnTo = this.arriveFace;
  }

  private walkStep(dt: number): void {
    const { fwd, side, turn } = walkIntent(this.keys, { walk: this.walkHeld, turn: this.turnHeld });
    if (fwd || side || turn) {
      this.route = [];
      this.turnTo = null;
      this.arrivePitch = null;
      this.head.yaw = wrap(this.head.yaw + turn * TURN_SPEED * dt);
      if (fwd || side) {
        const m = walkMove(this.head.yaw, fwd, side, WALK_SPEED * dt);
        const nx = this.pos.x + m.dx;
        const nz = this.pos.z + m.dz;
        if (this.walk.free(nx, this.pos.z)) this.pos.x = nx;
        if (this.walk.free(this.pos.x, nz)) this.pos.z = nz;
      }
      return;
    }
    if (this.route.length) {
      const next = this.route[0];
      const dx = next.x - this.pos.x;
      const dz = next.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const step = WALK_SPEED * dt;
      if (d > 1e-4) this.turnHead(Math.atan2(dx, dz), dt);
      if (d <= step) {
        this.pos.x = next.x;
        this.pos.z = next.z;
        this.route.shift();
        if (!this.route.length && this.arriveFace !== null) this.turnTo = this.arriveFace;
      } else {
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
      }
      return;
    }
    if (this.turnTo !== null && this.turnHead(this.turnTo, dt)) this.turnTo = null;
  }

  private turnHead(to: number, dt: number): boolean {
    const d = wrap(to - this.head.yaw);
    const max = AUTO_TURN_SPEED * dt;
    this.head.yaw = wrap(this.head.yaw + Math.max(-max, Math.min(max, d)));
    this.head.pitch += ((this.arrivePitch ?? 0) - this.head.pitch) * 0.1;
    return Math.abs(d) <= max;
  }

  private doorAtNdc(p: THREE.Vector2): boolean {
    this.raycaster.setFromCamera(p, this.camera);
    return this.raycaster.ray.intersectsBox(this.room.door.box);
  }

  leaveByDoor(): void {
    const stand = this.room.door.stand;
    if (Math.hypot(this.pos.x - stand.x, this.pos.z - stand.z) <= DOOR_AT_M) {
      this.onLeave?.();
      return;
    }
    this.goTo(stand);
    const c = this.room.door.box.getCenter(new THREE.Vector3());
    this.arriveFace = Math.atan2(c.x - stand.x, c.z - stand.z);
    if (!this.route.length) this.turnTo = this.arriveFace;
  }

  private floorAtNdc(p: THREE.Vector2): Pt | null {
    this.raycaster.setFromCamera(p, this.camera);
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (!hit) return null;
    const b = this.plan.box;
    const m = Math.min(WALL_STAND_M, (b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2);
    return {
      x: Math.max(b.minX + m, Math.min(b.maxX - m, hit.x)),
      z: Math.max(b.minZ + m, Math.min(b.maxZ - m, hit.z)),
    };
  }

  private straighten(): void {
    this.orbit.yaw = 0;
    this.orbit.pitch = 0;
    this.orbit.back = 1;
  }

  private resize(): void {
    const w = this.host.clientWidth || innerWidth;
    const h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.lookFov > this.fovMax()) this.zoom(this.lookFov);
  }

  private fovMax(): number {
    const a = this.camera.aspect;
    if (!(a > 0) || a >= 1) return FOV_MAX;
    const t = Math.tan(THREE.MathUtils.degToRad(FOV_MAX / 2)) / a;
    return THREE.MathUtils.radToDeg(2 * Math.atan(t));
  }

  releaseHeld(): void {
    this.keys.clear();
    this.walkHeld = 0;
    this.turnHeld = 0;
    this.live.keys.focusLost();
  }

  private bindInput(): void {
    const el = this.renderer.domElement;
    addEventListener('keydown', (e) => {
      if (this.locked || this.paused) return;
      if (e.key === 'Escape') { this.stepBack(); return; }
      if (this.focus) {
        if (!this.live.keys.keyDown(e) && this.modes.orbit && e.key === 'Home') this.straighten();
        return;
      }
      if ((e.target as Element | null)?.closest?.('input, select, textarea, [role="listbox"], .ui-dock')) return;
      if (e.key === ' ' && (e.target as Element | null)?.closest?.('button, a, input')) return;
      if (e.key === 't' || e.key === ' ') { e.preventDefault(); this.turn(); return; }
      if (e.key.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.key);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.key);
      this.live.keys.keyUp(e);
    });
    letGoOnFocusLoss(window, () => this.releaseHeld());
    el.addEventListener('wheel', (e) => {
      if (this.focus) {
        if (!this.modes.orbit) return;
        e.preventDefault();
        this.orbit.back = this.clampBack(this.orbit.back * (1 + e.deltaY * 0.001));
        return;
      }
      e.preventDefault();
      this.zoom(this.lookFov * (1 + e.deltaY * 0.001));
    }, { passive: false });
    el.addEventListener('pointerdown', (e) => {
      if (this.focus && this.modes.orbit) {
        this.orbitPinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
        el.setPointerCapture(e.pointerId);
        if (this.orbitPinch.size === 2) {
          const [a, b] = [...this.orbitPinch.values()];
          this.orbitPinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, back: this.orbit.back };
          this.caps.drop();
          this.orbitDrag = null;
          this.peekEnd();
          return;
        }
        if (this.orbitPinch.size > 2) return;
        if (this.peekBegin(e)) return;
        this.caps.begin(e);
        el.setPointerCapture(e.pointerId);
        return;
      }
      if (this.caps.down(e)) return;
      if (this.peekBegin(e)) { el.setPointerCapture(e.pointerId); return; }
      if (this.modes.look) {
        this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pinch.size === 2) {
          const [a, b] = [...this.pinch.values()];
          this.pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, fov: this.lookFov };
          if (this.drag) this.drag.moved = true;
        }
      }
      this.drag = { x: e.clientX, y: e.clientY, yaw: this.head.yaw, pitch: this.head.pitch, moved: false, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.peeking?.id === e.pointerId) {
        if (this.peeking.glass.peek.drag(e.clientX, e.clientY)) e.preventDefault();
        return;
      }
      const turned = this.caps.move(e);
      if (turned && turned !== 'held') {
        this.orbitDrag = { id: e.pointerId, x: turned.x, y: turned.y, yaw: this.orbit.yaw, pitch: this.orbit.pitch };
      }
      if (this.orbitPinch.has(e.pointerId)) {
        this.orbitPinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.orbitPinch.size === 2 && this.orbitPinchStart) {
          const [a, b] = [...this.orbitPinch.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          this.orbit.back = this.clampBack(this.orbitPinchStart.back * (this.orbitPinchStart.d / d));
          return;
        }
      }
      const o = this.orbitDrag;
      if (o && o.id === e.pointerId) {
        const k = Math.PI / (this.renderer.domElement.clientWidth || 1);
        this.orbit.yaw = Math.max(-ORBIT_YAW, Math.min(ORBIT_YAW, o.yaw - (e.clientX - o.x) * k));
        this.orbit.pitch = Math.max(-TILT_UP, Math.min(TILT_DOWN, o.pitch + (e.clientY - o.y) * k));
        return;
      }
      if (this.modes.look && this.pinch.has(e.pointerId)) {
        this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pinch.size === 2 && this.pinchStart) {
          const [a, b] = [...this.pinch.values()];
          this.zoom(this.pinchStart.fov * (this.pinchStart.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1)));
          return;
        }
      }
      const d = this.drag;
      if (!d || d.id !== e.pointerId || this.focus) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > 6) d.moved = true;
      if (!d.moved) return;
      const k = THREE.MathUtils.degToRad(this.camera.fov) / (this.renderer.domElement.clientHeight || 1);
      this.turnTo = null;
      this.arrivePitch = null;
      this.head.yaw = wrap(d.yaw + dx * k);
      this.head.pitch = Math.max(-LOOK_DOWN, Math.min(LOOK_UP, d.pitch + dy * k));
    });
    const up = (e: PointerEvent): void => {
      if (this.orbitPinch.delete(e.pointerId) && this.orbitPinch.size < 2) this.orbitPinchStart = null;
      if (this.peeking?.id === e.pointerId) { this.peekEnd(); return; }
      if (this.caps.up(e)) return;
      if (this.orbitDrag?.id === e.pointerId) {
        this.orbitDrag = null;
        return;
      }
      this.pinch.delete(e.pointerId);
      if (this.pinch.size < 2) this.pinchStart = null;
      const d = this.drag;
      this.drag = null;
      if (!aisleClick(d, e)) return;
      if (!this.focus) {
        const at = this.ndc(e);
        const s = this.slotAtNdc(at);
        if (s) this.walkUp(s);
        else if (this.onLeave && this.doorAtNdc(at)) this.leaveByDoor();
        else {
          const p = this.floorAtNdc(at);
          if (p) this.goTo(p);
        }
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', (e) => {
      if (this.peeking?.id === e.pointerId) this.peekEnd();
      this.caps.up(e);
    });
  }

  private peekBegin(e: PointerEvent): boolean {
    if (this.peeking || !reelPeekOn()) return false;
    const glass = this.focus?.glass;
    if (!glass?.cab || this.live.glass !== glass) return false;
    const hit = this.glassPoint(e);
    if (!hit || hit.lamp || hit.coin || !(hit.scale > 0)) return false;
    const at = reelAt(glass.cab.reels, hit.x, hit.y);
    if (!at) return false;
    this.peeking = { id: e.pointerId, glass };
    glass.peek.begin(e.clientX, e.clientY, at.pitch * hit.scale, at.reel.angle ?? 0);
    return true;
  }

  private peekEnd(): void {
    const p = this.peeking;
    this.peeking = null;
    p?.glass.peek.release();
  }

  private zoom(fov: number): void {
    this.lookFov = Math.max(FOV_MIN, Math.min(this.fovMax(), fov));
    if (!this.focus) this.setFov(this.lookFov);
  }

  private setFov(fov: number): void {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  turn(): void {
    if (this.focus) return;
    this.route = [];
    this.turnTo = wrap((this.turnTo ?? this.head.yaw) + Math.PI);
  }

  private glassWorld(s: Slot): THREE.Vector3 {
    return glassWorld(s.holder, s.shell!);
  }

  private orbitBackMax(s: Slot, dist: number): number {
    const others = this.slots.filter((o) => o !== s).map((o) => (o.box
      ? { minX: o.box.min.x, maxX: o.box.max.x, minZ: o.box.min.z, maxZ: o.box.max.z }
      : footprintOf(o.spot)));
    const reach = backReach(this.glassWorld(s), s.spot.yaw, this.orbit.yaw, [...others, ...this.props.footprints()], this.room.box);
    return Math.min(ORBIT_BACK_MAX, reach / dist);
  }

  private clampBack(back: number): number {
    const f = this.focus;
    const lens = Math.tan(THREE.MathUtils.degToRad(AT_MACHINE_FOV_MAX / 2)) / Math.tan(THREE.MathUtils.degToRad(ROOM_FOV / 2));
    const max = f?.shell
      ? Math.min(ORBIT_BACK_MAX, this.orbitBackMax(f, framingDistance(f.shell, this.camera, ROOM_FOV)) * lens)
      : ORBIT_BACK_MAX;
    return Math.max(Math.min(ORBIT_IN_MIN, max), Math.min(max, back));
  }

  private ndc(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private slotAtNdc(p: THREE.Vector2): Slot | null {
    this.raycaster.setFromCamera(p, this.camera);
    const hits = this.raycaster.intersectObjects(this.slots.map((s) => s.holder), true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !this.slots.some((s) => s.holder === o)) o = o.parent;
    return this.slots.find((s) => s.holder === o) ?? null;
  }

  private glassPoint(e: { clientX: number; clientY: number }): GlassHit | null {
    const s = this.focus;
    if (!s?.shell || !s.glass.cab) return null;
    return glassPointAt(this.ndc(e), this.camera, this.raycaster, s.holder, s.shell, s.glass,
      this.renderer.domElement.clientHeight);
  }

  ahead(): Slot | null {
    const looked = this.slotAtNdc(new THREE.Vector2(0, 0));
    if (looked) return looked;
    let best: Slot | null = null;
    let bestD = AHEAD_M;
    for (const s of this.slots) {
      const dx = s.spot.x - this.pos.x;
      const dz = s.spot.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= bestD || d < 1e-3) continue;
      if (Math.abs(wrap(Math.atan2(dx, dz) - this.head.yaw)) > AHEAD_CONE) continue;
      if (-dx * Math.sin(s.spot.yaw) - dz * Math.cos(s.spot.yaw) <= 0) continue;
      best = s;
      bestD = d;
    }
    return best;
  }

  goToMachine(ids: readonly string[]): boolean {
    if (this.focus || this.locked || this.paused) return false;
    let best: Slot | null = null;
    let bestD = Infinity;
    for (const s of this.slots) {
      if (!ids.includes(s.glass.machine.id)) continue;
      const d = Math.hypot(s.spot.x - this.pos.x, s.spot.z - this.pos.z);
      if (d < bestD) { best = s; bestD = d; }
    }
    if (!best) return false;
    this.walkUp(best);
    return true;
  }

  walkUp(s: Slot): void {
    this.walkHeld = 0;
    this.turnHeld = 0;
    this.focus = s;
    this.glide = true;
    this.freezeOthers();
    this.straighten();
    this.standBefore(s);
    this.onFocus?.({ machine: s.glass.machine, mode: s.glass.mode });
    const note = this.live.stopNote;
    const held = s.glass.machine.held;
    if (!held) {
      const m = s.glass.machine;
      const text = m.installing ? str('arcade.room.not_installed_yet', { 0: m.name })
        : m.otherVersion ? str('arcade.room.different_version', { 0: m.name })
        : str('arcade.room.not_in_library', { 0: m.name });
      if (note) this.sayWhenArrived = { s, show: () => note.notice(text, undefined, undefined, NAME_NOTE_MS), by: performance.now() + ASK_BY_MS };
      return;
    }
    const built = s.glass.game && s.glass.cab ? Promise.resolve() : s.loaded ? null : this.build(s);
    if (!built) return;
    note?.clear();
    this.live.startSound();
    let onReady: () => void = () => undefined;
    let onFailed: () => void = () => undefined;
    const t0 = performance.now();
    let arrivedAt = 0;
    void built.then(async () => {
      if (this.focus !== s || !s.glass.game || !s.glass.cab) return;
      await this.live.start(s.glass);
      this.onFocus?.({ machine: s.glass.machine, mode: s.glass.mode });
    }).then(() => onReady(), (e: unknown) => { onFailed(); throw e; });
    if (!note) return;
    const name = displayTitle(held);
    const connecting = str('arcade.room.connecting', { 0: name });
    const readyText = str('arcade.room.ready', { 0: name });
    const notReadyText = str('arcade.room.n_is_not_ready_the', { 0: name });
    const hourglass = { paths: UI_ICONS.hourglass, label: str('arcade.room.getting_ready') };
    let ready = false;
    const show = (): void => {
      arrivedAt = performance.now() - t0;
      if (note.visible) return;
      if (ready) note.notice(readyText, undefined, undefined, NAME_NOTE_MS);
      else note.notice(connecting, undefined, undefined, READY_WAIT_MS, hourglass);
    };
    const settle = (why: string): void => {
      ready = true;
      const ms = Math.round(performance.now() - t0);
      console.log(`[arcade] walk-up: arrived +${Math.round(arrivedAt)} ms, ${why} +${ms} ms`);
      if (this.focus !== s || !note.visible || note.text !== connecting) return;
      if (why === 'failed') note.dismiss();
      else if (!this.live.takesCoins()) note.notice(notReadyText, undefined, undefined, NAME_NOTE_MS);
      else note.notice(readyText, undefined, undefined, NAME_NOTE_MS);
    };
    let poll: ReturnType<typeof setInterval> | null = null;
    onFailed = (): void => settle('failed');
    onReady = (): void => {
      if (this.live.error) { settle('failed'); return; }
      if (this.live.coinDoorOpen) { settle('ready'); return; }
      poll = setInterval(() => {
        const ours = this.focus === s && note.visible && note.text === connecting;
        if (!ours || this.live.coinDoorOpen) {
          if (poll !== null) clearInterval(poll);
          poll = null;
          if (ours) settle('booted');
        }
      }, 200);
    };
    this.sayWhenArrived = { s, show, by: performance.now() + ASK_BY_MS };
  }

  stepBack(): void {
    if (!this.focus) return;
    this.orbitDrag = null;
    this.straighten();
    this.sayWhenArrived = null;
    const note = this.live.stopNote;
    if (note?.passing) note.dismiss();
    this.live.stop();
    this.focus = null;
    this.glide = true;
    this.freezeOthers();
    this.onFocus?.(null);
  }

  private freezeOthers(): void {
    const frozen = this.switches.focusFreeze && this.focus !== null;
    const dim = frozen && this.switches.dim;
    for (const s of this.slots) this.shadeGlass(s);
    this.dimTarget = dim ? FOCUS_ROOM_DIM : 1;
    if (!this.room.motion) this.applyDim(this.dimTarget);
    this.hangFocusLamp(frozen);
  }

  private dimK = 1;
  private dimTarget = 1;

  private rebuildGlows(): void {
    for (const s of this.slots) {
      if (s.glow) { s.holder.remove(s.glow.group); s.glow.dispose(); s.glow = null; }
    }
    if (!this.switches.glow) return;
    const size = { W: DERIVED.width, H: DERIVED.height, D: DERIVED.depth };
    this.slots.forEach((s, i) => {
      const plan = glowPlan(this.plan.spots, i, this.plan.box, size.W, size.D);
      const tex = (j: number | null): THREE.Texture | null => (j === null ? null : this.slots[j].glass.texture);
      s.glow = makeGlow(s.shell?.size ?? size, s.glass.texture, tex(plan.left), tex(plan.right), plan.wall);
      s.glowFrom = { left: plan.left, right: plan.right };
      s.holder.add(s.glow.group);
    });
    this.applyDim(this.dimK);
  }

  private readonly focusLamp = (() => {
    const l = new THREE.SpotLight(FOCUS_LAMP_COLOUR, FOCUS_LAMP_CANDELA, 5, FOCUS_LAMP_ANGLE, 0.6, 2);
    l.add(l.target);
    l.target.position.set(0, -FOCUS_LAMP_ABOVE_M - 0.6, -FOCUS_LAMP_FORWARD_M + 0.2);
    return l;
  })();

  private lampWanted = false;

  private overlays = new Map<Slot, GlassOverlay>();

  private glassShade(s: Slot): number {
    const dim = this.switches.focusFreeze && this.focus !== null && this.switches.dim;
    return dim && s !== this.focus ? FROZEN_GLASS_DIM : 1;
  }

  private shadeGlass(s: Slot): void {
    const k = this.glassShade(s);
    const ov = s.glass.overlaid ? this.overlays.get(s) : null;
    ov?.setDim(k);
    for (const m of s.shell?.glassMeshes ?? []) {
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat.color.r !== k) mat.color.setScalar(k);
    }
    if (s.shell) holeGlass(s.shell, !!ov);
  }

  private overlaySlot(s: Slot, on: boolean): GlassOverlay | null {
    const g = s.glass;
    if (!on) {
      if (!g.overlaid) return null;
      g.overlaid = false;
      this.overlays.get(s)?.hide();
      g.texture.needsUpdate = true;
      this.shadeGlass(s);
      return null;
    }
    let ov = this.overlays.get(s);
    if (!ov) { ov = new GlassOverlay(this.host); this.overlays.set(s, ov); }
    if (!g.overlaid) { g.overlaid = true; this.shadeGlass(s); }
    return ov;
  }

  private placeOverlays(): void {
    const el = this.renderer.domElement;
    const W = el.clientWidth, H = el.clientHeight;
    for (const s of this.slots) {
      const g = s.glass;
      const col = g.shown;
      let canvas: HTMLCanvasElement | null = null;
      let cw = 0, ch = 0, ox = 0, oy = 0;
      if (s === this.focus && g.mode === 'live' && s.shell && col && g.cab && g.layoutCanvas) {
        canvas = g.layoutCanvas;
        cw = col.width; ch = col.height;
        ox = col.left - g.cab.content.left; oy = col.top - g.cab.content.top;
      } else if (g.mode === 'attract' && s.shell && col && g.cab && g.lastPaint > -Infinity && s.bounds
        && this.frustum.intersectsSphere(s.bounds)
        && (this.camPos.x - s.spot.x) * Math.sin(s.spot.yaw) + (this.camPos.z - s.spot.z) * Math.cos(s.spot.yaw) > 0) {
        canvas = g.texCanvas;
        cw = canvas.width; ch = canvas.height;
      }
      const pieces = canvas && s.shell ? glassPieces(s.shell, cw, ch, ox, oy, this.camera, W, H) : [];
      const ov = this.overlaySlot(s, pieces.length > 0);
      if (!ov || !canvas) continue;
      const played = canvas === g.layoutCanvas && !!g.cab;
      ov.show(canvas, played && this.switches.glassPresent);
      ov.place(pieces);
    }
    const on = this.slots.filter((s) => s.glass.overlaid && this.overlays.has(s))
      .map((s) => ({ s, d: Math.hypot(s.spot.x - this.camPos.x, s.spot.z - this.camPos.z) }))
      .sort((a, b) => b.d - a.d);
    on.forEach(({ s }, i) => this.overlays.get(s)!.setOrder(i));
  }

  private hangFocusLamp(frozen: boolean): void {
    this.lampWanted = frozen;
    const s = frozen && this.switches.lamp ? this.focus : null;
    this.focusLamp.removeFromParent();
    if (!s) return;
    const h = s.shell?.size.H ?? DERIVED.height;
    this.focusLamp.position.set(0, h + FOCUS_LAMP_ABOVE_M, FOCUS_LAMP_FORWARD_M);
    s.holder.add(this.focusLamp);
  }

  private applyDim(k: number): void {
    this.dimK = k;
    this.room.dim(k);
    dimMaterials(this.props.group, k);
    const kOf = (i: number | null): number => (i !== null && this.slots[i] === this.focus && k < 1 ? 1 : k);
    for (const s of this.slots) {
      const mine = s === this.focus && k < 1;
      s.glow?.setDim(mine ? 1 : k, kOf(s.glowFrom.left), kOf(s.glowFrom.right));
      for (const c of s.holder.children) {
        const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (m?.isMeshBasicMaterial && m.blending === THREE.AdditiveBlending) m.opacity = 0.16 * (mine ? 1 : k);
      }
      if (!s.shell || s.shell.modelId !== 'default') continue;
      const env = ENV_INTENSITY * (mine ? 1 + (1 - k) * (FOCUS_LIFT - 1) : k);
      s.shell.group.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (mat?.isMeshStandardMaterial && mat.envMap) mat.envMapIntensity = env;
      });
    }
  }

  get othersFrozen(): boolean { return this.switches.focusFreeze && this.focus !== null; }

  frame(now: number): void {
    if (this.paused) { this.lastFrameAt = 0; return; }
    const t0 = performance.now();
    const dt = this.lastFrameAt ? Math.min(0.1, (now - this.lastFrameAt) / 1000) : 0;
    if (this.lastFrameAt) {
      this.intervals.push(now - this.lastFrameAt);
      if (this.intervals.length > 60) this.intervals.shift();
    }
    this.lastFrameAt = now;
    if (!this.focus && !this.shot && !this.locked) this.walkStep(dt);
    if (!this.orbitDrag && this.orbit.yaw) {
      this.orbit.yaw *= 1 - easeShare(dt, ORBIT_SPRING_TAU_S);
      if (Math.abs(this.orbit.yaw) < 1e-3) this.orbit.yaw = 0;
    }

    const want = new THREE.Vector3();
    const look = new THREE.Vector3();
    const f = this.focus ?? this.shot?.slot ?? null;
    if (this.shot?.three) {
      const h = this.shot.three.holder;
      want.copy(h.localToWorld(new THREE.Vector3(0.38, 1.55, 1.05)));
      look.copy(h.localToWorld(new THREE.Vector3(0, 1.02, 0.1)));
    } else if (this.shot?.wide) {
      const r = this.room.box;
      const cx = (r.minX + r.maxX) / 2;
      want.set(r.maxX - 0.4, r.height - 0.2, r.maxZ - 0.4);
      look.set(cx, 0.6, (r.minZ + r.maxZ) / 2);
    } else if (f?.shell) {
      const c = this.glassWorld(f);
      const dist = framingDistance(f.shell, this.camera, ROOM_FOV);
      const back = Math.min(this.orbit.back, this.orbitBackMax(f, dist));
      this.setFov(machineFov(this.orbit.back, back));
      const v = walkUpView(c, dist * back, this.orbit.yaw, this.orbit.pitch, f.spot.yaw, dist);
      want.copy(v.pos);
      look.copy(v.look);
    } else {
      this.setFov(this.lookFov);
      want.set(this.pos.x, EYE, this.pos.z);
      look.set(
        this.pos.x + Math.sin(this.head.yaw),
        EYE + REST_SLOPE + Math.tan(this.head.pitch),
        this.pos.z + Math.cos(this.head.yaw),
      );
    }
    const onFeet = !f && !this.shot;
    if (this.glide && this.camPos.distanceTo(want) < ARRIVED_M && this.camLook.distanceTo(look) < ARRIVED_M) this.glide = false;
    const k = this.snap ? 1 : this.glide ? easeShare(dt, GLIDE_TAU_S) : onFeet ? 1 : easeShare(dt, AT_MACHINE_TAU_S);
    this.snap = false;
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    const say = this.sayWhenArrived;
    if (say && say.s !== this.focus) this.sayWhenArrived = null;
    else if (say && ((this.camPos.distanceTo(want) < ARRIVED_M && this.camLook.distanceTo(look) < ARRIVED_M)
      || performance.now() > say.by)) {
      this.sayWhenArrived = null;
      say.show();
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse),
    );

    if (this.dimK !== this.dimTarget) {
      const step = (dt * 1000) / FOCUS_DIM_MS;
      const k = this.dimK < this.dimTarget ? Math.min(this.dimTarget, this.dimK + step) : Math.max(this.dimTarget, this.dimK - step);
      this.applyDim(k);
    }
    const frozen = this.othersFrozen;
    const t = (now - this.t0) / 1000;
    let paints = 0;
    const due: { s: Slot; g: Glass; d: number }[] = [];
    for (const s of this.slots) {
      const g = s.glass;
      if (s.glow) s.glow.group.visible = Math.hypot(s.x - this.camPos.x, s.spot.z - this.camPos.z) < MID_M;
      if (g.mode === 'live') {
        if (this.live.frame(TEX_LIVE)) {
          paints++;
          const tc = DEV_ROOM ? performance.now() : 0;
          this.overlays.get(s)?.refresh();
          if (DEV_ROOM) { const d = performance.now() - tc; glassCost.copyMs += d; glassTotals.copyMs += d; }
        }
        continue;
      }
      if (g.mode !== 'attract' || !s.bounds || frozen) continue;
      if ((this.camPos.x - s.spot.x) * Math.sin(s.spot.yaw) + (this.camPos.z - s.spot.z) * Math.cos(s.spot.yaw) <= 0) continue;
      if (!this.frustum.intersectsSphere(s.bounds)) continue;
      const d = Math.hypot(s.x - this.camPos.x, s.spot.z - this.camPos.z);
      if (d < NEAR_M) { if (now - g.lastPaint >= this.switches.glassNearMs) due.push({ s, g, d }); }
      else if (d < MID_M) { if (now - g.lastPaint >= MID_MS) due.push({ s, g, d }); }
      else if (g.lastPaint === -Infinity) due.push({ s, g, d });
    }
    this.placeOverlays();
    due.sort((a, b) => a.g.lastPaint - b.g.lastPaint || a.d - b.d);
    const rate = this.switches.glassPs;
    if (rate > 0) this.paintTokens = Math.min(2, this.paintTokens + (this.lastPaintTick ? (now - this.lastPaintTick) / 1000 : 0) * rate);
    this.lastPaintTick = now;
    let budget = this.switches.glass;
    for (const { s, g } of due) {
      if (budget <= 0 || (rate > 0 && this.paintTokens < 1)) break;
      if (rate > 0) this.paintTokens--;
      g.lastPaint = now;
      if (g.playAttract(t, this.switches.glassTex)) { paints++; budget--; this.overlays.get(s)?.refresh(); }
    }
    this.room.tick(t, this.camera.position);
    const tGlass = performance.now();
    this.gpuTimer?.begin();
    this.renderer.render(this.scene, this.camera);
    this.gpuTimer?.end();
    if (this.live.keys.hintsShown) {
      const view = `${this.camera.matrixWorld.elements.join()}|${this.renderer.domElement.clientWidth}x${this.renderer.domElement.clientHeight}`;
      if (view !== this.hintView) {
        this.hintView = view;
        this.live.keys.refreshHints();
      }
    } else this.hintView = '';
    const tEnd = performance.now();

    const ms = tEnd - t0;
    this.frameScriptTotal += ms;
    this.frameTimes.push(ms);
    this.glassTimes.push(tGlass - t0);
    this.renderTimes.push(tEnd - tGlass);
    if (this.glassTimes.length > 3000) { this.glassTimes.shift(); this.renderTimes.shift(); }
    if (this.frameTimes.length > 3000) this.frameTimes.shift();
    this.paintsThisSecond += paints;
    if (now - this.secondAt >= 1000) {
      this.paintsLastSecond = this.paintsThisSecond;
      this.paintsThisSecond = 0;
      this.secondAt = now;
    }
  }

  loadedCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.shown) n++;
    return n;
  }

  stats(): RoomStats {
    const ft = this.frameTimes;
    const mean = ft.length ? ft.reduce((a, b) => a + b, 0) / ft.length : 0;
    return {
      fps: 0,
      frameMs: +mean.toFixed(2),
      paints: this.paintsLastSecond,
      cabinets: this.slots.length,
      loaded: this.slots.filter((s) => s.loaded).length,
      attract: this.slots.filter((s) => s.glass.mode === 'attract').length,
      live: this.live.glass ? this.live.glass.mode : 'none',
    };
  }

  frameTimings(): number[] { return [...this.frameTimes]; }
  frameScriptTotalMs(): number { return this.frameScriptTotal; }
  private frameScriptTotal = 0;
  canvasSaid(): string {
    const c = this.renderer.domElement;
    return `${c.width}x${c.height}@${+this.renderer.getPixelRatio().toFixed(2)}`;
  }

  setLiveSwitches(o: Partial<Pick<RoomSwitches, 'focusFreeze' | 'dim' | 'dpr' | 'glow' | 'lamp'>>): void {
    const sw = this.switches as RoomSwitches;
    if (o.glow !== undefined) { sw.glow = o.glow; this.rebuildGlows(); }
    if (o.lamp !== undefined) { sw.lamp = o.lamp; this.hangFocusLamp(this.lampWanted); }
    if (o.focusFreeze !== undefined) { sw.focusFreeze = o.focusFreeze; this.freezeOthers(); }
    if (o.dim !== undefined) { sw.dim = o.dim; this.freezeOthers(); }
    if (o.dpr !== undefined) {
      sw.dpr = o.dpr;
      this.renderer.setPixelRatio(o.dpr ?? Math.min(devicePixelRatio, DPR_CAP));
      this.resize();
    }
  }
  glassTimings(): number[] { return [...this.glassTimes]; }
  renderTimings(): number[] { return [...this.renderTimes]; }
  resetTimings(): void {
    this.frameTimes.length = 0;
    this.glassTimes.length = 0;
    this.renderTimes.length = 0;
  }

  private poseBase: number | null = null;

  viewShot(w: number, h: number): HTMLCanvasElement {
    const t = (performance.now() - this.t0) / 1000;
    for (const s of this.slots) {
      if (s.glass.mode === 'attract' && s.glass.lastPaint === -Infinity) {
        s.glass.lastPaint = performance.now();
        s.glass.playAttract(t, this.switches.glassTex);
      }
    }
    const cam = this.viewCamera(w / h);
    const size = this.renderer.getSize(new THREE.Vector2());
    const vh = size.y;
    const vw = Math.min(size.x, (vh * w) / h);
    const dimWas = this.dimK;
    if (dimWas < 1) this.applyDim(1);
    const holed: Slot[] = [];
    for (const s of this.slots) {
      if (!s.shell) continue;
      for (const m of s.shell.glassMeshes) {
        const mat = m.material as THREE.MeshBasicMaterial;
        if (mat.color.r !== 1) mat.color.setScalar(1);
      }
      if (s.glass.overlaid) {
        holeGlass(s.shell, false);
        s.glass.texture.needsUpdate = true;
        holed.push(s);
      }
    }
    this.renderer.setViewport(0, 0, vw, vh);
    this.renderer.setScissor(0, 0, vw, vh);
    this.renderer.setScissorTest(true);
    this.renderer.render(this.scene, cam);
    for (const s of holed) if (s.shell) holeGlass(s.shell, true);
    for (const s of this.slots) this.shadeGlass(s);
    if (dimWas < 1) this.applyDim(dimWas);
    const el = this.renderer.domElement;
    const pr = this.renderer.getPixelRatio();
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d')!.drawImage(el, 0, el.height - vh * pr, vw * pr, vh * pr, 0, 0, w, h);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, size.x, size.y);
    return out;
  }

  private viewCamera(aspect: number): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(VIEW_FOV, aspect, 0.05, 60);
    const r = this.room.box;
    const spots = this.slots.map((s) => s.spot);
    const cx = spots.length ? spots.reduce((a, s) => a + s.x, 0) / spots.length : (r.minX + r.maxX) / 2;
    const cz = spots.length ? spots.reduce((a, s) => a + s.z, 0) / spots.length : (r.minZ + r.maxZ) / 2;
    const look = new THREE.Vector3(cx, VIEW_LOOK_Y, cz);
    const dir = new THREE.Vector3(VIEW_DIR.x, VIEW_DIR.y, VIEW_DIR.z).normalize();
    const corners = spots.flatMap((s) => [0, CAB_TOP_M].flatMap((y) => [-0.4, 0.4].flatMap((dx) => [-0.4, 0.4]
      .map((dz) => new THREE.Vector3(s.x + dx, y, s.z + dz)))));
    const v = new THREE.Vector3();
    for (let d = 2; ; d += 0.25) {
      cam.position.copy(look).addScaledVector(dir, d);
      cam.lookAt(look);
      cam.updateMatrixWorld();
      if (d > 30 || corners.every((c) => {
        v.copy(c).project(cam);
        return Math.abs(v.x) <= VIEW_FILL && Math.abs(v.y) <= VIEW_FILL && v.z < 1;
      })) break;
    }
    return cam;
  }

  shotView(kind: string, i?: number): void {
    this.shot = null;
    if (kind === 'three' && this.slots[i ?? 0]) {
      this.shot = { three: this.slots[i ?? 0] };
    } else if (kind === 'close' && this.slots[i ?? 0]) {
      this.shot = { slot: this.slots[i ?? 0] };
    } else if (kind === 'wide') {
      this.shot = { wide: true };
    } else {
      const s = this.slots[i ?? 0];
      if (s) this.standBefore(s);
    }
    this.snap = true;
  }

  posePreview(p: { yaw?: number; pitch?: number; fov?: number; back?: number; x?: number; z?: number; hold?: boolean }): void {
    if (this.focus) {
      this.orbit.yaw = p.yaw ?? 0;
      this.orbit.pitch = p.pitch ?? 0;
      this.orbit.back = p.back ?? 1;
      this.orbitDrag = p.hold === false ? null : { id: -99, x: 0, y: 0, yaw: this.orbit.yaw, pitch: this.orbit.pitch };
    } else {
      this.poseBase ??= this.head.yaw;
      this.head.yaw = wrap(this.poseBase + (p.yaw ?? 0));
      this.head.pitch = p.pitch ?? 0;
      if (p.x !== undefined) this.pos.x = p.x;
      if (p.z !== undefined) this.pos.z = p.z;
    }
    if (p.fov !== undefined) this.zoom(p.fov);
    this.snap = true;
  }

  tour(f: number): void {
    const order = [...this.slots].sort((a, b) => a.spot.z - b.spot.z || a.spot.x - b.spot.x);
    if (!order.length) return;
    const t = Math.min(0.999999, Math.max(0, f)) * order.length;
    const a = order[Math.floor(t)];
    const b = order[(Math.floor(t) + 1) % order.length];
    const u = t - Math.floor(t);
    const pa = this.before(a);
    const pb = this.before(b);
    this.route = [];
    this.turnTo = null;
    this.pos.x = pa.x + (pb.x - pa.x) * u;
    this.pos.z = pa.z + (pb.z - pa.z) * u;
    const to = u < 0.5 ? a : b;
    this.head.yaw = Math.atan2(to.spot.x - this.pos.x, to.spot.z - this.pos.z);
  }

  focusIndex(i: number): boolean {
    const s = this.slots[i];
    if (!s) return false;
    this.walkUp(s);
    return true;
  }
}

function machineFov(want: number, stood: number): number {
  if (!(stood > 0) || want <= stood) return ROOM_FOV;
  const t = Math.tan(THREE.MathUtils.degToRad(ROOM_FOV / 2)) * (want / stood);
  return Math.min(AT_MACHINE_FOV_MAX, THREE.MathUtils.radToDeg(2 * Math.atan(t)));
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function footprintOf(s: Stand): Rect {
  const c = Math.abs(Math.cos(s.yaw));
  const n = Math.abs(Math.sin(s.yaw));
  const hw = (c * DERIVED.width + n * DERIVED.depth) / 2 + 0.05;
  const hd = (n * DERIVED.width + c * DERIVED.depth) / 2 + 0.05;
  return { minX: s.x - hw, maxX: s.x + hw, minZ: s.z - hd, maxZ: s.z + hd };
}

function disposeSign(m: THREE.Mesh): void {
  m.geometry.dispose();
  const mat = m.material as THREE.MeshBasicMaterial;
  mat.map?.dispose();
  mat.dispose();
}
