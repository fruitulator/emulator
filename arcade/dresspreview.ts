import * as THREE from 'three';
import { planFloor } from './floor';
import { BANK_MARGINS, buildRoom, type Dressing, lightPool } from './dressing';
import { buildShell, disposeShell, modelFor, DERIVED, type CabinetPanels, type CabinetShell } from './cabinets';
import { cabinetDress } from './cabinetlight';
import type { Glass } from './glass';
import { CANVAS_OVER_GLASS_Z, GlassOverlay, glassPieces, holeGlass } from './glassflat';
import { framingDistance, glassPointAt, glassWorld, type GlassHit } from './glasshit';
import { PlayPointer } from '../web/play/pointer';
import { UI_ICONS } from '../web/ui/icons';
import { str } from '../web/i18n';

const EYE = 1.5;
const BACK = 1.9;
const YAW_MAX = THREE.MathUtils.degToRad(70);
const YAW_HOME = THREE.MathUtils.degToRad(-18);
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1.5;
const ELEV_MIN = THREE.MathUtils.degToRad(-12);
const ELEV_MAX = THREE.MathUtils.degToRad(70);
const DECK_ELEV = THREE.MathUtils.degToRad(50);
const FLOOR_CLEAR = 0.15;
const BODY_CLEAR = 0.04;

export interface GlassPlay {
  press(pointerId: number, hit: GlassHit): void;
  release(pointerId: number): void;
  touched(): void;
}

const HINT_LOOK = str('arcade.dresspreview.drag_to_turn_scroll_or');
const HINT_PLAY = str('arcade.dresspreview.tap_the_machine_to_play');

export class DressPreview {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 60);
  private readonly holder = new THREE.Group();
  private readonly room: Dressing;
  private shell: CabinetShell | null = null;
  private seq = 0;
  readonly root: HTMLElement;
  readonly resetBtn: HTMLButtonElement;
  private readonly hint: HTMLParagraphElement;
  private playing: GlassPlay | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly caps = new PlayPointer<GlassHit>({
    at: (e) => this.glassPoint(e),
    press: (hit, id) => this.playing?.press(id, hit),
    release: (id) => this.playing?.release(id),
    capture: () => undefined,
  });
  private yaw = YAW_HOME;
  private tilt = 0;
  private zoom = 1;
  private drag: { x: number; y: number; yaw: number; tilt: number } | null = null;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; zoom: number } | null = null;
  private raf = 0;
  private readonly face: 1 | -1;
  private viewKey = '';
  private built = 0;
  private drawn = '';
  private overlay: GlassOverlay | null = null;
  private refreshedAt = -1;

  constructor(private readonly glass: Glass) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'dress-3d';
    this.canvas.style.position = 'relative';
    this.canvas.style.zIndex = String(CANVAS_OVER_GLASS_Z);
    const plan = planFloor(1, { width: DERIVED.width, depth: DERIVED.depth });
    const b = plan.bounds;
    const room = buildRoom({
      minX: b.minX - BANK_MARGINS.side, maxX: b.maxX + BANK_MARGINS.side,
      minZ: b.minZ - BANK_MARGINS.back, maxZ: b.maxZ + BANK_MARGINS.front,
    }, this.renderer);
    this.room = room;
    this.scene.add(room.group);
    const spot = plan.spots[0];
    this.face = spot.face;
    this.holder.position.set(spot.x, 0, spot.z);
    this.holder.rotation.y = spot.face === 1 ? 0 : Math.PI;
    this.holder.add(lightPool());
    this.scene.add(this.holder);
    this.root = document.createElement('div');
    this.root.className = 'dress-wrap';
    this.resetBtn = document.createElement('button');
    this.resetBtn.type = 'button';
    this.resetBtn.className = 'iconbtn dress-reset';
    this.resetBtn.setAttribute('aria-label', str('arcade.dresspreview.reset_view'));
    this.resetBtn.title = str('arcade.dresspreview.reset_view');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = UI_ICONS.reset;
    this.resetBtn.append(svg);
    this.resetBtn.addEventListener('click', () => this.resetView());
    this.hint = document.createElement('p');
    this.hint.className = 'dress-hint';
    this.hint.textContent = HINT_LOOK;
    this.hint.style.zIndex = String(CANVAS_OVER_GLASS_Z + 1);
    this.root.style.background = '#020203';
    this.root.style.isolation = 'isolate';
    this.root.append(this.canvas, this.hint);
    this.syncReset();
    this.wireView();
    const loop = (): void => {
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private wireView(): void {
    const c = this.canvas;
    const setZoom = (z: number): void => { this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); this.syncReset(); };
    const startDrag = (p: { x: number; y: number }): void => { this.drag = { x: p.x, y: p.y, yaw: this.yaw, tilt: this.tilt }; };
    const spread = (): number => {
      const [a, b] = [...this.touches.values()];
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    };
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        this.caps.drop();
        this.drag = null;
        this.pinch = { d: spread(), zoom: this.zoom };
      } else if (this.touches.size === 1) {
        startDrag({ x: e.clientX, y: e.clientY });
        if (this.playing) this.startPress(e);
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.touches.has(e.pointerId)) return;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.caps.move(e) === 'held') return;
      if (this.pinch && this.touches.size >= 2) { setZoom(this.pinch.zoom * (this.pinch.d / spread())); return; }
      if (!this.drag) return;
      const w = c.clientWidth || 1;
      const h = c.clientHeight || 1;
      this.yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, this.drag.yaw - ((e.clientX - this.drag.x) / w) * Math.PI));
      this.tilt = this.drag.tilt + ((e.clientY - this.drag.y) / h) * (Math.PI / 2);
      this.syncReset();
    });
    const end = (e: PointerEvent): void => {
      this.caps.up(e);
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = null;
      const rest = [...this.touches.values()][0];
      if (rest) startDrag(rest); else this.drag = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      setZoom(this.zoom * Math.exp(e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)));
    }, { passive: false });
    let gz = 1;
    c.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      gz = this.zoom;
    });
    c.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      setZoom(gz / ((e as unknown as { scale: number }).scale || 1));
    });
  }

  private ndc(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private deckPoint(s: CabinetShell): THREE.Vector3 {
    const box = new THREE.Box3();
    let low: THREE.Vector3 | null = null;
    for (const g of s.glassMeshes) {
      const c = box.setFromObject(g).getCenter(new THREE.Vector3());
      if (!low || c.y < low.y) low = c;
    }
    return low ?? glassWorld(this.holder, s);
  }

  private syncHint(): void {
    this.hint.textContent = this.playing ? HINT_PLAY : HINT_LOOK;
    this.drawn = '';
  }

  private startPress(e: PointerEvent): void {
    this.playing?.touched();
    this.caps.begin(e);
  }

  private glassPoint(e: { clientX: number; clientY: number }): GlassHit | null {
    const s = this.shell;
    if (!s) return null;
    return glassPointAt(this.ndc(e), this.camera, this.raycaster, this.holder, s, this.glass, this.canvas.clientHeight);
  }

  play(p: GlassPlay | null): void {
    if (this.playing === p) return;
    this.caps.drop();
    this.playing = p;
    this.syncHint();
    this.canvas.classList.toggle('dress-play', !!p);
    this.resetView();
  }

  private get home(): number { return this.playing ? 0 : YAW_HOME; }

  resetView(): void {
    this.yaw = this.home;
    this.tilt = 0;
    this.zoom = 1;
    this.syncReset();
  }

  private syncReset(): void {
    this.resetBtn.disabled = this.yaw === this.home && this.tilt === 0 && this.zoom === 1;
  }

  onBuilt: ((panels: CabinetPanels) => void) | null = null;

  get panels(): CabinetPanels | null { return this.shell?.panels ?? null; }

  private building: Promise<void> | null = null;
  private dirty = false;

  rebuild(): Promise<void> {
    this.dirty = true;
    if (!this.building) {
      this.building = (async () => {
        try {
          while (this.dirty) {
            this.dirty = false;
            try {
              await this.build();
            } catch (e) {
              console.error('[arcade] the 3D view could not build the cabinet', e);
            }
          }
        } finally {
          this.building = null;
        }
      })();
    }
    return this.building;
  }

  private async build(): Promise<void> {
    const seq = ++this.seq;
    const g = this.glass;
    const model = await modelFor(g.cabinetStyle, 0, g.machine.setup.cabinet).catch((e: unknown) => {
      console.warn('[arcade] the cabinet model could not be found; the default cabinet stands in', e);
      return null;
    });
    const shell = await buildShell({
      fit: g.shellFit(), texture: g.texture, model, trim: g.trim, body: g.machine.setup.body, surface: g.machine.setup.surface, name: g.machine.name, cabinet: g.machine.setup.cabinet,
      dress: cabinetDress(this.renderer),
    });
    if (seq !== this.seq) { disposeShell(shell, g.texture); return; }
    if (this.shell) { this.holder.remove(this.shell.group); disposeShell(this.shell, g.texture); }
    this.shell = shell;
    this.built++;
    this.holder.add(shell.group);
    g.attachCoin(shell.coin);
    this.onBuilt?.(shell.panels);
  }

  private frame(): void {
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * this.renderer.getPixelRatio()) || c.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const s = this.shell;
    const target = s
      ? glassWorld(this.holder, s)
      : new THREE.Vector3(this.holder.position.x, 1.2, this.holder.position.z);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * this.face, 0, Math.cos(this.yaw) * this.face);
    let look: THREE.Vector3;
    let dist: number;
    let rise: number;
    if (this.playing && s) {
      look = target;
      dist = framingDistance(s, this.camera);
      rise = 0;
    } else {
      look = new THREE.Vector3(target.x, target.y - 0.1, target.z);
      dist = s ? Math.max(BACK, s.frameHeight * 2.4) : BACK;
      rise = EYE - look.y;
    }
    const reach = Math.hypot(dist, rise) * this.zoom;
    const e0 = Math.atan2(rise, dist);
    const el = Math.max(Math.min(ELEV_MIN, e0), Math.min(ELEV_MAX, e0 + this.tilt));
    if (this.tilt !== 0 && el !== e0 + this.tilt) this.tilt = el - e0;
    const key = `${this.built}|${this.yaw}|${el}|${this.zoom}|${w}x${h}|${this.playing ? 1 : 0}`;
    if (key !== this.viewKey) {
      this.viewKey = key;
      if (s && el > e0) {
        const t = Math.min(1, (el - e0) / Math.max(1e-3, DECK_ELEV - e0));
        look = look.clone().lerp(this.deckPoint(s), t * t * (3 - 2 * t));
      }
      const pos = new THREE.Vector3(
        look.x + dir.x * Math.cos(el) * reach, look.y + Math.sin(el) * reach, look.z + dir.z * Math.cos(el) * reach);
      pos.y = Math.max(FLOOR_CLEAR, pos.y);
      if (s) {
        const back = pos.clone().sub(look);
        const far = back.length();
        this.raycaster.set(look, back.normalize());
        this.raycaster.near = BODY_CLEAR;
        this.raycaster.far = far;
        const hit = this.raycaster.intersectObject(s.group, true).find((x) => visible(x.object));
        this.raycaster.near = 0;
        this.raycaster.far = Infinity;
        if (hit) pos.copy(look).addScaledVector(back, Math.max(BODY_CLEAR, hit.distance - BODY_CLEAR));
      }
      this.camera.position.copy(pos);
      this.camera.lookAt(look);
    }
    this.camera.updateMatrixWorld();
    this.placeGlass(w, h);
    const stamp = `${this.viewKey}|${this.glass.overlaid ? 'o' : this.glass.paints}`;
    if (stamp === this.drawn) return;
    this.drawn = stamp;
    this.room.tick(0, this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  private placeGlass(w: number, h: number): void {
    const g = this.glass;
    const s = this.shell;
    const col = g.shown;
    const pc = g.layoutCanvas;
    const want = !!s && g.mode === 'live' && !g.wholeGlass && !!col && !!pc && !!g.cab;
    const pieces = want ? glassPieces(s!, col!.width, col!.height, col!.left - g.cab!.content.left, col!.top - g.cab!.content.top, this.camera, w, h) : [];
    if (!pieces.length) {
      if (g.overlaid) {
        g.overlaid = false;
        this.overlay?.hide();
        if (s) holeGlass(s, false);
        g.texture.needsUpdate = true;
        this.drawn = '';
      }
      return;
    }
    if (!this.overlay) this.overlay = new GlassOverlay(this.root);
    if (!g.overlaid) { g.overlaid = true; this.drawn = ''; }
    holeGlass(s!, true);
    this.overlay.show(pc!, true);
    if (g.paints !== this.refreshedAt) { this.refreshedAt = g.paints; this.overlay.refresh(); }
    this.overlay.place(pieces);
  }

  dispose(): void {
    this.caps.drop();
    this.playing = null;
    cancelAnimationFrame(this.raf);
    if (this.glass.overlaid) { this.glass.overlaid = false; if (this.shell) holeGlass(this.shell, false); }
    this.overlay?.dispose();
    this.overlay = null;
    if (this.shell) { this.holder.remove(this.shell.group); disposeShell(this.shell, this.glass.texture); this.shell = null; }
    this.renderer.dispose();
  }
}

function visible(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}
