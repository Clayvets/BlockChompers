import * as THREE from 'three';
import { PrimitiveFactory } from './PrimitiveFactory.js';
import { Events } from '../core/Events.js';
import { UnitState } from '../core/Unit.js';
import { Cues } from '../app/Cues.js';
import { ease } from './anim/easing.js';
import { VfxFactory } from './vfx/VfxFactory.js';
import { VfxManager } from './vfx/VfxManager.js';
import { trackDrawPosition, trackFromSnapshot } from './trackPlacement.js';
import { HEADING, launchPath, flightProgress, flightPose, entryQueueBacks, returnPose, newPose } from './launchPlacement.js';
import { computeLayout, fitView, boardPoint, slotPoint, reservePoint } from './layout/computeLayout.js';
import { computeTrackPieces } from './layout/computeTrackPieces.js';

const WHITE = new THREE.Color(1, 1, 1);
const USED_STATES = new Set([UnitState.LAUNCHING, UnitState.RUNNING, UnitState.EATING, UnitState.RETURNED]);
/** States in which a styled unit plays its swim animation (idle otherwise). */
const MOVING_STATES = new Set([UnitState.LAUNCHING, UnitState.RUNNING, UnitState.EATING]);
const TONE_MAPPING = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping };
/** Numeric key of a grid cell (no string per lookup). */
const cellKey = (row, col) => row * 1024 + col;
/** Reserve shift order within a column (a module function, so sorting creates no closure per frame). */
const byTarget = (a, b) => a.target - b.target;
const clearList = (list) => {
  list.length = 0;
};

/**
 * The Three.js bridge. Reads snapshots, owns the scene graph, never mutates game state.
 *
 *   sync(snapshot)  -- structure: static layer (track guide, slots, reserve tiles, camera) rebuilt when the
 *                      level's shape changes, blocks diffed on grid.version, slot tints on inventory.version,
 *                      units re-posed every frame (flight curve, entry queue, return glide, reserve shift, turning)
 *   bindEvents(bus) -- effects only: end-of-level tint, and the VfxManager (projectiles, block hits, sparks)
 *
 * Juice runs on a presentation clock (sync's dtMs: frozen while paused, scaled by debug.timeScale): the muzzle pop,
 * the capacity number swap, the death pop and the "N/5" counter punch live here because they animate meshes this class
 * owns; the VfxManager borrows blocks and unit positions through the host methods (takeBlockMesh, unitTip, ...).
 * The visual moments sounds sync to go out as cues (src/app/Cues.js) on the optional `cues` bus: a block breaking (the
 * projectile lands), a capacity number dropping, a death pop starting, a unit landing in its slot, the counter hitting 0.
 *
 * Styled look (StyledFactory, Fish of Fortune step 1): units are GLB fish (their animator runs on the presentation
 * clock) and the track is built from GLB pieces placed by layout/computeTrackPieces.js. The GLB meshes sit on
 * render.lighting.layer and render() draws them in a first pass under their own lights, then the rest as in v3.
 *
 * Layout: a fixed portrait design (Config.render.layout) in design units, which are world units on the x/z plane.
 * computeLayout() (pure) gives every rect; the camera shows the whole design and never refits on a level change.
 * Only the board scales: logic cell units map to world through the level's cellSize and board origin (boardToWorld).
 * Slots, reserve cells, units and labels keep their render.layout size everywhere (designToWorld). Runners are drawn
 * exactly on the track path at their interpolated track distance (trackPlacement.js); spacing between them only
 * exists along the track (Config.track.launchSpacing).
 */
export class Renderer {
  /** @type {Map<number, THREE.Mesh>} key cellKey(row, col); the VfxManager takes a block's mesh when it is eaten */
  #blockMeshes = new Map();
  /** @type {Map<string, THREE.Group>} key unit id; group.userData.label is the capacity sprite */
  #unitMeshes = new Map();
  /** @type {THREE.Mesh[]} index = slot index */
  #slotMeshes = [];
  /** @type {THREE.Group | null} */
  #trackGroup = null;
  /** @type {THREE.Group | null} parent of every level mesh */
  #levelRoot = null;
  #gridVersion = -1;
  #inventoryVersion = -1;
  #signature = null;
  /** Resolved per-level colours (see #styleFor). */
  #style = null;
  /** computeLayout() result for the loaded level (design / world units); see getLayout(). */
  #layout = null;
  /** Debug outlines of the layout regions (Config.debug.enabled). */
  #debugGroup = null;
  /** "N/5" available-slot counter sprite (render.slotCounter). */
  #slotCounter = null;
  /** The level Track rebuilt from the snapshot, used to place runners on the path. */
  #track = null;
  /** snapshot.stepAlpha of the frame being drawn. */
  #alpha = 0;
  #pickables = [];
  /** Reserve shift animation state per unit id: { col, y (drawn row), from, target, startAt }. */
  #reserveAnim = new Map();
  /** Reserve column -> time (ms) its front unit last left; the shift behind it starts a stagger later. */
  #departures = new Map();
  /** Per-unit motion memory (see #motionFor): flight start and path, return start, last drawn point. */
  #motion = new Map();
  /** Track entry point (world units) and heading, where every launch flight ends. */
  #entry = null;
  /** snapshot.launchSteps: whole steps of a launch flight. */
  #launchSteps = 0;
  /** Presentation clock (ms): advanced by sync's dtMs, frozen while paused. */
  #clock = 0;
  /** N shown on the "N/5" sprite, and when it last changed / hit 0 (counter punch and flash). */
  #counterFree = null;
  #counterPunchAt = -Infinity;
  #counterFlashAt = -Infinity;
  #counterBase = { x: 1, y: 1 };
  #labelFlash = null;
  #counterFlash = null;
  /** Reused every frame, so the unit loop allocates no arrays, sets or maps. */
  #alive = new Set();
  #pickList = [];
  #backs = new Map();
  #backsScratch = [];
  #liveCells = new Set();
  #trackPoint = { x: 0, y: 0, facing: 'N' };
  #slotPoint = { x: 0, y: 0 };
  #resColumns = new Map();
  #resSeen = new Set();
  #resNow = 0;
  #size = { width: 1, height: 1 };
  /** Screen pixels covered by DOM chrome (HUD bar); fitCamera keeps the board out of them. */
  #insets = { top: 0, bottom: 0 };
  /** Styled factory: GLB models live on render.lighting.layer and are drawn in their own pass (see render()). */
  #modelPass = false;
  #modelLayer = 1;
  #modelToneMapping = THREE.NoToneMapping;
  /** Board cell units -> world x/z into `out`, without allocating (the chevron flow calls it every frame). */
  #toWorld = (x, y, out) => {
    const { boardOrigin, cellSize } = this.#layout;
    out.x = boardOrigin.x + x * cellSize;
    out.y = boardOrigin.y + y * cellSize;
    return out;
  };

  /**
   * @param {{ canvas: HTMLCanvasElement, config: object, factory?: PrimitiveFactory, cues?: import('../app/Cues.js').CueBus }} deps
   */
  constructor({ canvas, config, factory = new PrimitiveFactory(config), cues = null }) {
    this.canvas = canvas;
    this.config = config;
    this.factory = factory;
    this.cues = cues;
    /** @type {THREE.Scene | null} */
    this.scene = null;
    /** @type {THREE.OrthographicCamera | null} */
    this.camera = null;
    /** @type {THREE.WebGLRenderer | null} */
    this.gl = null;
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
  }

  /** WebGLRenderer on `canvas`, scene with render.background, lights, camera. */
  init() {
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.info.autoReset = false; // render() resets it once per frame, so the stats cover both passes
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.config.render.background);
    this.#levelRoot = new THREE.Group();
    this.scene.add(this.#levelRoot);
    this.initLights();
    this.#initModelLights();
    this.initOrthographicCamera();
    const { vfx } = this.config.render;
    this.#labelFlash = new THREE.Color(vfx.label.flashColor);
    this.#counterFlash = new THREE.Color(vfx.counter.flashColor);
    this.vfxFactory = new VfxFactory(this.config);
    this.vfx = new VfxManager({ config: this.config, factory: this.vfxFactory, host: this });
    this.vfx.attach(this.scene);
  }

  /** Effects "reduced": fewer particles (settings toggle or prefers-reduced-motion). */
  setEffectsReduced(reduced) {
    if (this.vfx) this.vfx.setReduced(reduced);
  }

  /**
   * Strictly top-down OrthographicCamera looking down -Y. up = -Z so grid row 0 (smallest z) is at the
   * top of the screen. The frustum is sized by fitCamera().
   */
  initOrthographicCamera() {
    const { near, far, height } = this.config.render.camera;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, near, far);
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(0, height, 0);
    this.camera.lookAt(0, 0, 0);
    this.fitCamera();
  }

  initLights() {
    const l = this.config.render.lights;
    this.scene.add(new THREE.AmbientLight(l.ambient, l.ambientIntensity));
    const sun = new THREE.DirectionalLight(l.directional, l.directionalIntensity);
    sun.position.set(...l.directionalPosition);
    this.scene.add(sun);
  }

  /**
   * With a factory that draws GLB models (StyledFactory: it has track()), render.lighting's hemisphere and directional
   * lights go on the model layer. Lights only reach what the camera renders on their layer, so they light the models
   * alone, and the v3 lights above never reach the models.
   */
  #initModelLights() {
    const lighting = this.config.render.lighting;
    this.#modelPass = Boolean(lighting) && typeof this.factory.track === 'function';
    if (!this.#modelPass) return;
    this.#modelLayer = lighting.layer;
    this.#modelToneMapping = TONE_MAPPING[lighting.toneMapping] ?? THREE.NoToneMapping;
    const hemi = new THREE.HemisphereLight(lighting.hemisphere.sky, lighting.hemisphere.ground, lighting.hemisphere.intensity);
    const sun = new THREE.DirectionalLight(lighting.directional.color, lighting.directional.intensity);
    sun.position.set(...lighting.directional.position);
    for (const light of [hemi, sun]) {
      light.layers.set(this.#modelLayer);
      this.scene.add(light);
    }
  }

  /**
   * Fit the frustum to the design layout, once per viewport size: the whole design scaled uniformly into the band
   * below the HUD (insets), centred, extra space as margin. It never depends on the level.
   */
  fitCamera() {
    if (!this.camera) return;
    const { layout, camera: cam } = this.config.render;
    const { width, height } = this.#size;
    const usable = Math.max(1, height - this.#insets.top - this.#insets.bottom);
    const view = fitView(layout.designWidth, layout.designHeight, width / usable);
    const worldPerPx = view.h / usable;
    const halfW = (width * worldPerPx) / 2;
    const halfH = (height * worldPerPx) / 2;
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    // Centre the view in the band between the insets: screen-up is world -z.
    const shift = ((this.#insets.top - this.#insets.bottom) / 2) * worldPerPx;
    const cx = view.x + view.w / 2;
    const cz = view.y + view.h / 2 - shift;
    this.camera.position.set(cx, cam.height, cz);
    this.camera.lookAt(cx, 0, cz);
    this.camera.updateProjectionMatrix();
    if (this.#layout) this.#layout = { ...this.#layout, view };
  }

  /**
   * Reserve screen pixels for DOM chrome (the HUD bar). main.js passes Config.ui.sizes.barHeight as top.
   * @param {{ top?: number, bottom?: number }} insets
   */
  setViewportInsets({ top = 0, bottom = 0 } = {}) {
    this.#insets = { top, bottom };
    this.fitCamera();
  }

  /** computeLayout() for this level: board dims from the snapshot, constant parts from render.layout. */
  #layoutFor(snapshot) {
    const { width, height } = this.#size;
    const usable = Math.max(1, height - this.#insets.top - this.#insets.bottom);
    const dims = { rows: snapshot.grid.rows, cols: snapshot.grid.cols, margin: snapshot.track.margin, reserveRows: snapshot.inventory.reserveRows };
    const layoutConfig = { ...this.config.render.layout, slotCount: snapshot.slots.length, reserveCols: snapshot.inventory.reserveCols };
    return computeLayout(dims, layoutConfig, width / usable);
  }

  /** The current layout (plain data: rects, cellSize, board origin, view), or null before a level is drawn. */
  getLayout() {
    return this.#layout;
  }

  /** Diff block meshes against the grid state: add missing / recoloured cells, remove emptied ones. */
  buildGridFromState(gridState) {
    const empty = this.config.grid.emptyValue;
    const { cellSize } = this.#layout;
    const half = (this.config.render.blockHeight * cellSize) / 2;
    const live = this.#liveCells;
    live.clear();
    const { cells } = gridState;
    for (let r = 0; r < cells.length; r += 1) {
      const row = cells[r];
      for (let c = 0; c < row.length; c += 1) {
        const value = row[c];
        if (value === empty) continue;
        const key = cellKey(r, c);
        live.add(key);
        const existing = this.#blockMeshes.get(key);
        if (existing && existing.userData.color === value) continue;
        if (existing) this.#levelRoot.remove(existing);
        const mesh = this.factory.block(value, r, c);
        mesh.userData.color = value;
        mesh.scale.setScalar(cellSize);
        this.boardToWorld(c + 0.5, r + 0.5, half, mesh.position);
        this.#levelRoot.add(mesh);
        this.#blockMeshes.set(key, mesh);
      }
    }
    this.#blockMeshes.forEach(this.#pruneBlock);
  }

  #pruneBlock = (mesh, key) => {
    if (this.#liveCells.has(key)) return;
    this.#levelRoot.remove(mesh);
    this.#blockMeshes.delete(key);
  };

  /**
   * The track on every ring cell (render.track.showGuide). A factory with track() (StyledFactory) builds the canal
   * from GLB pieces placed by computeTrackPieces; otherwise, or if its models did not load, flat guide tiles with the
   * entry corner tinted.
   */
  buildTrack(trackState) {
    if (!this.config.render.track.showGuide) return;
    const xs = trackState.corners.map((c) => c.x);
    const ys = trackState.corners.map((c) => c.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const entry = trackState.corners[0];
    if (typeof this.factory.track === 'function') {
      const { margin, direction } = trackState;
      const dims = { rows: Math.round(y1 - y0 + 1 - 2 * margin), cols: Math.round(x1 - x0 + 1 - 2 * margin), margin, direction };
      const entryCorner = (entry.y === y0 ? 'N' : 'S') + (entry.x === x0 ? 'W' : 'E');
      const pieces = computeTrackPieces({ ...dims, entryCorner });
      const styled = this.factory.track({ pieces, dims, cellSize: this.#layout.cellSize, toWorld: this.#toWorld });
      if (styled) {
        this.#trackGroup = styled;
        this.#levelRoot.add(styled);
        return;
      }
    }
    const group = new THREE.Group();
    for (let x = x0; x <= x1; x += 1) {
      this.#tile(group, x, y0, entry);
      this.#tile(group, x, y1, entry);
    }
    for (let y = y0 + 1; y < y1; y += 1) {
      this.#tile(group, x0, y, entry);
      this.#tile(group, x1, y, entry);
    }
    this.#trackGroup = group;
    this.#levelRoot.add(group);
  }

  #tile(group, x, y, entry) {
    const tile = this.factory.trackTile(x === entry.x && y === entry.y);
    tile.scale.setScalar(this.#layout.cellSize);
    this.boardToWorld(x, y, 0, tile.position);
    group.add(tile);
  }

  /** Tint slot markers by status (called when inventory.version changes). */
  buildInventory(snapshot) {
    for (const slot of snapshot.slots) {
      const mesh = this.#slotMeshes[slot.index];
      if (mesh) mesh.material = this.factory.slotMaterial(slot.status);
    }
  }

  /**
   * "N/total" every frame: N = activeSlots - (units moving + units parked); moving units hold no slot. The text is only
   * redrawn when N changes; then the sprite punches, and it flashes when N reaches 0.
   */
  #updateSlotCounter({ units, slots }, now) {
    const counter = this.#slotCounter;
    if (!counter) return;
    let used = 0;
    for (let i = 0; i < units.length; i += 1) if (USED_STATES.has(units[i].state)) used += 1;
    const total = slots.length;
    const free = Math.max(0, total - used);
    if (free !== this.#counterFree) {
      if (this.#counterFree !== null) {
        this.#counterPunchAt = now;
        if (free === 0) {
          this.#counterFlashAt = now;
          this.#cue(Cues.SLOTS_EMPTY);
        }
      }
      this.#counterFree = free;
      this.factory.setText(counter, `${free}/${total}`);
    }
    const c = this.config.render.vfx.counter;
    const tp = now - this.#counterPunchAt;
    const k = tp >= 0 && tp < c.punchMs ? 1 + c.punch * ease('punch', tp / c.punchMs) : 1;
    counter.scale.set(this.#counterBase.x * k, this.#counterBase.y * k, 1);
    const tf = now - this.#counterFlashAt;
    if (tf >= 0 && tf < c.flashMs) counter.material.color.copy(this.#counterFlash).lerp(WHITE, ease('easeInQuad', tf / c.flashMs));
    else counter.material.color.copy(WHITE);
  }

  /**
   * Per-frame sync from a snapshot. Safe to call before a level is loaded. dtMs is the frame's presentation time
   * (main.js: real time x debug.timeScale); nothing animates while the game is paused.
   */
  sync(snapshot, dtMs = 1000 / 60) {
    if (!this.scene || !snapshot || !snapshot.track) return;
    const dt = snapshot.paused ? 0 : dtMs;
    this.#clock += dt;
    const signature = this.#signatureOf(snapshot);
    if (signature !== this.#signature) this.#rebuildStatic(snapshot, signature);
    this.#alpha = snapshot.stepAlpha || 0;
    this.#launchSteps = snapshot.launchSteps || 0;
    if (snapshot.grid.version !== this.#gridVersion) {
      this.buildGridFromState(snapshot.grid);
      this.#gridVersion = snapshot.grid.version;
    }
    if (snapshot.inventory.version !== this.#inventoryVersion) {
      this.buildInventory(snapshot);
      this.#inventoryVersion = snapshot.inventory.version;
    }
    this.#syncUnits(snapshot, dt);
    this.#updateSlotCounter(snapshot, this.#clock);
    if (this.#trackGroup && this.#trackGroup.userData.animator) this.#trackGroup.userData.animator.update(dt);
    if (this.vfx) this.vfx.update(dt);
  }

  #signatureOf({ levelId, grid, track, slots, inventory }) {
    const entry = track.corners[0];
    return [levelId, grid.rows, grid.cols, track.margin, track.direction, entry.x, entry.y, slots.length, inventory.reserveCols, inventory.reserveRows].join(':');
  }

  /** Defaults from Config.render overlaid with Config.render.levels[levelId], if any. */
  #styleFor(levelId) {
    const render = this.config.render;
    const level = (render.levels && render.levels[levelId]) || {};
    return {
      background: level.background ?? render.background,
      palette: { ...render.palette, ...level.palette },
      guideColor: level.track?.guideColor ?? render.track.guideColor,
      entryColor: level.track?.entryColor ?? render.track.entryColor,
      tileColor: level.inventory?.tileColor ?? render.inventory.tileColor,
    };
  }

  /** New level shape: drop every level mesh and lay out the static layer again (the camera does not move). */
  #rebuildStatic(snapshot, signature) {
    this.clear();
    this.#signature = signature;
    this.#style = this.#styleFor(snapshot.levelId);
    this.factory.setStyle(this.#style);
    this.scene.background.setHex(this.#style.background);
    this.#layout = this.#layoutFor(snapshot);
    const layout = this.#layout;
    if (typeof this.factory.setLayout === 'function') this.factory.setLayout(layout);
    if (layout.reserveOverflow) console.warn(`Level "${snapshot.levelId}" needs ${snapshot.inventory.reserveRows} reserve rows; render.layout fits ${layout.reserve.rows}`);
    this.#track = trackFromSnapshot(snapshot);
    const entry = this.#track.positionAt(0);
    this.#entry = { point: boardPoint(layout, entry.x, entry.y), dir: HEADING[entry.facing] };
    this.buildTrack(snapshot.track);
    layout.slots.forEach((_, index) => {
      const mesh = this.factory.slot('free', index);
      const { x, y } = slotPoint(layout, index);
      this.designToWorld(x, y, 0, mesh.position);
      this.#levelRoot.add(mesh);
      this.#slotMeshes.push(mesh);
    });
    this.#slotCounter = this.factory.text('', { ...this.config.render.slotCounter, height: layout.counter.height });
    this.#counterBase = { x: this.#slotCounter.scale.x, y: this.#slotCounter.scale.y };
    this.designToWorld(layout.counter.x, layout.counter.y, this.config.render.label.yOffset, this.#slotCounter.position);
    this.#levelRoot.add(this.#slotCounter);
    // The whole reserve grid, on every level (plus any rows a level needs beyond it).
    const rows = Math.max(layout.reserve.rows, snapshot.inventory.reserveRows);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < layout.reserve.cols; col += 1) {
        const tile = this.factory.reserveTile();
        const { x, y } = reservePoint(layout, col, row);
        this.designToWorld(x, y, 0, tile.position);
        this.#levelRoot.add(tile);
      }
    }
    if (this.config.debug.enabled) this.#drawDebugOutlines(layout);
  }

  /** Config.debug.enabled: outline the design, the three regions and the fitted board. */
  #drawDebugOutlines(layout) {
    const colors = this.config.debug.layoutColors;
    const group = new THREE.Group();
    for (const key of ['design', 'boardRegion', 'board', 'slotsRegion', 'reserveRegion']) {
      group.add(this.factory.outline(layout[key], colors[key]));
    }
    this.#debugGroup = group;
    this.#levelRoot.add(group);
  }

  #syncUnits(snapshot, dt) {
    const { units, slots } = snapshot;
    const { unitHeight, label, hopHeight, vfx } = this.config.render;
    const now = this.#clock;
    this.#animateReserve(units, now);
    const backs = entryQueueBacks(units, this.config.track.launchSpacing, this.#alpha, this.#backs, this.#backsScratch);
    const frontOnly = this.config.inventory.frontOnlyPick;
    const pickables = this.#pickList;
    pickables.length = 0;
    for (let i = 0; i < slots.length; i += 1) if (slots[i].status === 'blocked' && this.#slotMeshes[slots[i].index]) pickables.push(this.#slotMeshes[slots[i].index]);
    const alive = this.#alive;
    alive.clear();
    for (let u = 0; u < units.length; u += 1) {
      const unit = units[u];
      let group = this.#unitMeshes.get(unit.id);
      if (unit.state === UnitState.DEAD) {
        // Keep a unit that just died for its death pop, where it was last drawn; then it is removed below.
        const juice = group && group.userData.juice;
        if (!juice || juice.deathAt < 0 || now - juice.deathAt >= vfx.death.ms) continue;
        alive.add(unit.id);
        group.userData.pickAs = null;
        this.#applyLabel(group, unit, now);
        this.#applyJuice(group, now, true);
        if (group.userData.animator) group.userData.animator.update(dt, true);
        continue;
      }
      alive.add(unit.id);
      if (group && group.userData.color !== unit.color) {
        this.#removeUnit(unit.id, group); // same id, different level: rebuild in the new colour
        group = undefined;
      }
      if (!group) {
        group = this.factory.unit(unit.color, unit.id);
        group.userData.color = unit.color;
        const sprite = this.factory.label(String(unit.capacity));
        const spare = this.factory.label('');
        sprite.position.y = label.yOffset;
        spare.position.y = label.yOffset;
        spare.visible = false;
        group.add(sprite, spare);
        Object.assign(group.userData, {
          label: sprite, labelSpare: spare, labelValue: unit.capacity, labelBase: sprite.scale.y,
          juice: { fireAt: -Infinity, deathAt: -1, swapAt: -Infinity },
        });
        this.#levelRoot.add(group);
        this.#unitMeshes.set(unit.id, group);
      }
      group.userData.juice.deathAt = -1;
      this.#applyLabel(group, unit, now);
      group.userData.pickAs = this.#pickTarget(unit, frontOnly);
      if (group.userData.pickAs) pickables.push(group);
      if (!group.userData.pose) group.userData.pose = newPose();
      const pose = this.#unitPose(unit, now, backs, group.userData.pose);
      this.designToWorld(pose.x, pose.y, unitHeight / 2 + (pose.air || 0) * hopHeight, group.position);
      this.#turn(group, pose.dir, dt);
      this.#applyJuice(group, now, false);
      if (group.userData.animator) group.userData.animator.update(dt, MOVING_STATES.has(unit.state));
    }
    this.#unitMeshes.forEach(this.#pruneUnit);
    this.#motion.forEach(this.#pruneMotion);
    this.#pickables = pickables;
  }

  // Bound once: Map.forEach with these allocates nothing per frame.
  #pruneUnit = (group, id) => {
    if (!this.#alive.has(id)) this.#removeUnit(id, group);
  };

  #pruneMotion = (_, id) => {
    if (!this.#alive.has(id)) this.#motion.delete(id);
  };

  // ---- VfxManager host: what the effects may borrow (never game state) ----

  /** Hand the block mesh at (row, col) over to the effects; the grid diff will no longer see or remove it. */
  takeBlockMesh(row, col) {
    const key = cellKey(row, col);
    const mesh = this.#blockMeshes.get(key);
    if (!mesh) return null;
    this.#blockMeshes.delete(key);
    return mesh;
  }

  /** World centre of a grid cell, written into `out` (a Vector3). */
  cellWorld(row, col, out) {
    const { boardOrigin, cellSize } = this.#layout;
    return out.set(boardOrigin.x + (col + 0.5) * cellSize, 0, boardOrigin.y + (row + 0.5) * cellSize);
  }

  /** World position of a unit's tip (the cone apex), written into `out`; false when the unit has no mesh. */
  unitTip(unitId, out) {
    const group = this.#unitMeshes.get(unitId);
    if (!group) return false;
    // A styled fish can be shorter than unitSize on small boards (it must fit the canal): use its real length.
    const half = (typeof this.factory.unitLength === 'function' ? this.factory.unitLength() : this.config.render.layout.unitSize) / 2;
    const h = group.rotation.y;
    out.set(group.position.x + Math.cos(h) * half, group.position.y, group.position.z - Math.sin(h) * half);
    return true;
  }

  /** The level's colour for a colour id, written into `out` (a Color). */
  paletteColor(colorId, out) {
    const hex = this.#style ? this.#style.palette[colorId] : undefined;
    return out.setHex(hex === undefined ? 0xffffff : hex);
  }

  cellSize() {
    return this.#layout ? this.#layout.cellSize : 1;
  }

  /** The unit fired: start its muzzle pop. */
  unitFired(unitId) {
    const group = this.#unitMeshes.get(unitId);
    if (group) group.userData.juice.fireAt = this.#clock;
  }

  /** The unit died: start its death pop; its position goes into `out`. @returns {number} its colour id (0 if unknown) */
  unitDied(unitId, out) {
    const group = this.#unitMeshes.get(unitId);
    if (!group) return 0;
    group.userData.juice.deathAt = this.#clock;
    this.#cue(Cues.UNIT_POP);
    out.copy(group.position);
    return group.userData.color;
  }

  /** A projectile landed and its block starts breaking. */
  blockHit() {
    this.#cue(Cues.BLOCK_BREAK);
  }

  #cue(type) {
    if (this.cues) this.cues.emit(type);
  }

  /** Debug numbers: draw calls and memory of the last frame, and active effect instances. */
  getStats() {
    const info = this.gl ? this.gl.info : null;
    const vfx = this.vfx ? this.vfx.stats() : { projectiles: 0, particles: 0, blocks: 0 };
    return {
      calls: info ? info.render.calls : 0,
      triangles: info ? info.render.triangles : 0,
      geometries: info ? info.memory.geometries : 0,
      textures: info ? info.memory.textures : 0,
      projectiles: vfx.projectiles,
      particles: vfx.particles,
      blocks: vfx.blocks,
    };
  }

  /**
   * Capacity label. Redrawn only when the number changes: then the old number (now on the spare sprite) fades and
   * shrinks away while the new one pops in with an overshoot and a quick colour flash.
   */
  #applyLabel(group, unit, now) {
    const ud = group.userData;
    const L = this.config.render.vfx.label;
    if (unit.capacity !== ud.labelValue) {
      if (unit.capacity < ud.labelValue && unit.capacity > 0) this.#cue(Cues.CAPACITY_TICK); // at 0 the death pop sounds
      const incoming = ud.labelSpare;
      ud.labelSpare = ud.label;
      ud.label = incoming;
      ud.labelValue = unit.capacity;
      this.factory.setLabel(incoming, String(unit.capacity));
      incoming.visible = true;
      ud.juice.swapAt = now;
    }
    const t = now - ud.juice.swapAt;
    const base = ud.labelBase;
    const out = ud.labelSpare;
    if (t < L.outMs) {
      const e = ease('easeOutQuad', t / L.outMs);
      const k = base * (1 + (L.outScale - 1) * e);
      out.visible = true;
      out.material.opacity = 1 - e;
      out.scale.set(k, k, 1);
    } else if (out.visible) {
      out.visible = false;
    }
    const k = t < L.inMs ? base * (L.inFrom + (1 - L.inFrom) * ease('easeOutBack', t / L.inMs)) : base;
    ud.label.scale.set(k, k, 1);
    ud.label.material.opacity = 1;
    if (t < L.flashMs) ud.label.material.color.copy(this.#labelFlash).lerp(WHITE, ease('easeInQuad', t / L.flashMs));
    else ud.label.material.color.copy(WHITE);
  }

  /** Muzzle pop when the unit fires; squash then shrink when it has died (its local x axis is the heading). */
  #applyJuice(group, now, dead) {
    const { muzzle, death } = this.config.render.vfx;
    const juice = group.userData.juice;
    let sx = 1;
    let sy = 1;
    let sz = 1;
    const tf = now - juice.fireAt;
    if (tf >= 0 && tf < muzzle.ms) {
      const k = 1 + muzzle.punch * ease('punch', tf / muzzle.ms);
      sx = k;
      sy = k;
      sz = k;
    }
    if (dead) {
      const p = (now - juice.deathAt) / death.ms;
      if (p < death.squashAt) {
        const e = ease('easeOutQuad', p / death.squashAt);
        sx *= 1 + (death.squash - 1) * e;
        sz *= 1 + (death.stretch - 1) * e;
      } else {
        const f = Math.max(0, 1 - ease('easeInBack', (p - death.squashAt) / (1 - death.squashAt)));
        sx = death.squash * f;
        sy = f;
        sz = death.stretch * f;
      }
    }
    group.scale.set(sx, sy, sz);
  }

  /** Raycast target for a unit: front reserve units launch, parked units relaunch from their slot, others none. */
  #pickTarget(unit, frontOnly) {
    if (unit.state === UnitState.RESERVE && (!frontOnly || unit.reservePos.row === 0)) return { kind: 'unit', id: unit.id };
    if (unit.state === UnitState.RETURNED && unit.slotIndex !== null) return { kind: 'slot', id: unit.slotIndex };
    return null;
  }

  /**
   * Turn a unit toward `dir` (cell plane) the short way round with exponential damping (render.rotationDamping per
   * second), so it swings smoothly through corners and launch curves. Snaps on the unit's first frame.
   */
  #turn(group, dir, dtMs) {
    const target = Math.atan2(-dir.dy, dir.dx);
    const data = group.userData;
    if (data.heading === undefined) {
      data.heading = target;
    } else {
      const delta = Math.atan2(Math.sin(target - data.heading), Math.cos(target - data.heading));
      data.heading += delta * (1 - Math.exp((-this.config.render.rotationDamping * dtMs) / 1000));
    }
    group.rotation.y = data.heading;
  }

  /**
   * Reserve shift (presentation only: the logic already moved the units). Per column, front to back, a unit whose row
   * moved up glides there in render.reserveShiftMs per row with render.motionEasing. It starts
   * render.reserveShiftStaggerMs after the unit ahead of it (the first one: after the unit that left) and is never
   * drawn closer than one row to the unit ahead, so meshes never overlap. A unit whose row moved back (restart) snaps.
   */
  #animateReserve(units, now) {
    const columns = this.#resColumns;
    const seen = this.#resSeen;
    columns.forEach(clearList);
    seen.clear();
    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      if (unit.state !== UnitState.RESERVE) continue;
      seen.add(unit.id);
      const { col, row } = unit.reservePos;
      let entry = this.#reserveAnim.get(unit.id);
      if (!entry || entry.col !== col || row > entry.target) {
        entry = { col, y: row, from: row, target: row, startAt: now };
        this.#reserveAnim.set(unit.id, entry);
      } else if (row < entry.target) {
        entry.from = entry.y;
        entry.target = row;
        entry.startAt = null;
      }
      let list = columns.get(col);
      if (!list) {
        list = [];
        columns.set(col, list);
      }
      list.push(entry);
    }
    this.#resNow = now;
    this.#reserveAnim.forEach(this.#noteDeparture);
    columns.forEach(this.#shiftColumn);
  }

  /** A unit left the reserve: its column's shift starts a stagger after this moment. */
  #noteDeparture = (entry, id) => {
    if (this.#resSeen.has(id)) return;
    this.#departures.set(entry.col, this.#resNow);
    this.#reserveAnim.delete(id);
  };

  /** One column, front to back: each unit starts a stagger after the one ahead and never closes in beyond a row. */
  #shiftColumn = (column, col) => {
    const { reserveShiftMs, reserveShiftStaggerMs, motionEasing } = this.config.render;
    const now = this.#resNow;
    column.sort(byTarget);
    let leaderStart = this.#departures.has(col) ? this.#departures.get(col) : -Infinity;
    let leaderY = -Infinity;
    for (let i = 0; i < column.length; i += 1) {
      const entry = column[i];
      if (entry.startAt === null) entry.startAt = Math.max(now, leaderStart + reserveShiftStaggerMs);
      if (entry.from > entry.target) {
        const p = (now - entry.startAt) / (reserveShiftMs * (entry.from - entry.target));
        entry.y = entry.from + (entry.target - entry.from) * ease(motionEasing, p);
        if (p >= 1) entry.from = entry.target;
        leaderStart = entry.startAt;
      }
      entry.y = Math.max(entry.y, leaderY + 1);
      leaderY = entry.y;
    }
  };

  /**
   * Where to draw a unit (cell units) and which way it heads:
   * All in world (design) units:
   *   RUNNING / EATING -- on the track path at its interpolated distance (trackPlacement.js), mapped onto the board
   *   LAUNCHING        -- along the eased flight curve from where it was drawn when the launch began to the entry,
   *                       never past its place in the entry queue (launchPlacement.js)
   *   RETURNED         -- gliding from where it left the track into its slot (render.returnToSlotMs), then parked
   *   RESERVE          -- its reserve cell, with the eased column shift
   */
  #unitPose(unit, now, backs, out) {
    const motion = this.#motionFor(unit, now);
    const { motionEasing, launchLift, launchCurve, returnToSlotMs } = this.config.render;
    const layout = this.#layout;
    const { boardOrigin, cellSize } = layout;
    if (unit.pose) {
      const p = trackDrawPosition(unit, this.#track, this.#alpha, this.#trackPoint);
      out.x = boardOrigin.x + p.x * cellSize;
      out.y = boardOrigin.y + p.y * cellSize;
      out.dir.dx = HEADING[p.facing].dx;
      out.dir.dy = HEADING[p.facing].dy;
      out.air = 0;
    } else if (unit.state === UnitState.LAUNCHING) {
      if (!motion.path) motion.path = launchPath(motion.from, this.#entry.point, this.#entry.dir, { lift: launchLift, curve: launchCurve });
      // Queue gaps are track distances (cells): on the board they are cellSize long.
      const back = (backs.get(unit.id) || 0) * cellSize;
      flightPose(motion.path, flightProgress(unit, this.#launchSteps, this.#alpha), motionEasing, back, out);
    } else if (unit.state === UnitState.RETURNED && unit.slotIndex !== null) {
      const progress = returnToSlotMs > 0 ? (now - motion.since) / returnToSlotMs : 1;
      if (progress >= 1 && !motion.landed) {
        motion.landed = true;
        this.#cue(Cues.UNIT_PARKED);
      }
      const slot = layout.slots[unit.slotIndex];
      this.#slotPoint.x = slot.x + slot.w / 2;
      this.#slotPoint.y = slot.y + slot.h / 2;
      returnPose(motion.from, this.#slotPoint, progress, motionEasing, out);
    } else {
      const anim = this.#reserveAnim.get(unit.id);
      const row = anim ? anim.y : unit.reservePos.row;
      const { origin, pitch } = layout.reserve;
      out.x = origin.x + unit.reservePos.col * pitch;
      out.y = origin.y + row * pitch;
      out.dir.dx = HEADING.N.dx;
      out.dir.dy = HEADING.N.dy;
      out.air = 0;
    }
    motion.last.x = out.x;
    motion.last.y = out.y;
    motion.seen = true;
    return out;
  }

  /** Per-unit presentation memory: notices a new launch or a return and remembers where it started from. */
  #motionFor(unit, now) {
    let motion = this.#motion.get(unit.id);
    if (!motion) {
      // landed: a unit first seen already parked makes no landing sound.
      motion = { state: unit.state, launchSeq: unit.launchSeq, from: null, since: now, path: null, last: { x: 0, y: 0 }, seen: false, landed: true };
      if (unit.state === UnitState.LAUNCHING) motion.from = this.#originPoint(unit); // first sight mid-flight
      this.#motion.set(unit.id, motion);
      return motion;
    }
    const newLaunch = unit.state === UnitState.LAUNCHING && (motion.state !== UnitState.LAUNCHING || motion.launchSeq !== unit.launchSeq);
    if (newLaunch) {
      motion.from = motion.seen ? { x: motion.last.x, y: motion.last.y } : this.#originPoint(unit);
      motion.path = null;
      motion.since = now;
    } else if (unit.state === UnitState.RETURNED && motion.state !== UnitState.RETURNED) {
      motion.from = motion.seen ? { x: motion.last.x, y: motion.last.y } : null;
      motion.since = now;
      motion.landed = false;
    }
    motion.state = unit.state;
    motion.launchSeq = unit.launchSeq;
    return motion;
  }

  /** Logical start of a launch: the reserve cell it left, or its parking slot for a relaunch. */
  #originPoint(unit) {
    const origin = unit.launchOrigin;
    if (origin && origin.kind === 'slot') return slotPoint(this.#layout, origin.index);
    const { col, row } = origin || unit.reservePos;
    return reservePoint(this.#layout, col, row);
  }

  #removeUnit(id, group) {
    this.factory.disposeLabel(group.userData.label);
    this.factory.disposeLabel(group.userData.labelSpare);
    if (group.userData.animator) group.userData.animator.dispose();
    this.#levelRoot.remove(group);
    this.#unitMeshes.delete(id);
    this.#pickables = this.#pickables.filter((object) => object !== group);
  }

  /**
   * Cosmetic reactions only: tint the background on LEVEL_WON / LEVEL_LOST, restore the level's own on LEVEL_LOADED.
   * @returns {() => void} unbind
   */
  bindEvents(eventBus) {
    const { endTint, background } = this.config.render;
    const tint = (hex) => () => {
      if (this.scene) this.scene.background.setHex(hex);
    };
    const offs = [
      eventBus.on(Events.LEVEL_WON, tint(endTint.won)),
      eventBus.on(Events.LEVEL_LOST, tint(endTint.lost)),
      eventBus.on(Events.LEVEL_LOADED, () => tint(this.#style ? this.#style.background : background)()),
    ];
    if (this.vfx) offs.push(this.vfx.bindEvents(eventBus));
    return () => offs.forEach((off) => off());
  }

  /** Design units (x right, y down) -> world (x right, z down, y up): the same numbers on the ground plane. */
  designToWorld(x, y, height = 0, target = new THREE.Vector3()) {
    return target.set(x, height, y);
  }

  /** Logic cell units of the board (origin = grid top-left) -> world, through the level's cellSize and board origin. */
  boardToWorld(x, y, height = 0, target = new THREE.Vector3()) {
    const p = boardPoint(this.#layout, x, y);
    return target.set(p.x, height, p.y);
  }

  /**
   * Raycast the current targets: { kind: 'unit', id } for a pickable reserve unit, { kind: 'slot', id: slotIndex }
   * for a parked unit or its blocked slot.
   * @returns {{ kind: 'unit'|'slot', id: string|number } | null}
   */
  pick(ndcX, ndcY) {
    if (!this.camera) return null;
    this._raycaster.setFromCamera(this._ndc.set(ndcX, ndcY), this.camera);
    for (const hit of this._raycaster.intersectObjects(this.#pickables, true)) {
      for (let object = hit.object; object; object = object.parent) {
        const data = object.userData || {};
        const target = data.pickAs || (data.kind === 'slot' ? { kind: 'slot', id: data.id } : null);
        if (target) return target;
      }
    }
    return null;
  }

  resize(width, height) {
    this.#size = { width: Math.max(1, width), height: Math.max(1, height) };
    if (!this.gl) return;
    this.gl.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, this.config.render.pixelRatioMax));
    this.gl.setSize(this.#size.width, this.#size.height);
    this.fitCamera();
  }

  /**
   * One pass, or two with a styled factory: first the GLB models (render.lighting.layer) under the model lights and
   * render.lighting's tone mapping, on the cleared background; then everything else on layer 0 under the v3 lights and
   * no tone mapping, over it without clearing, so depth still sorts models against the board and the labels, VFX and
   * tiles look exactly as in v3.
   */
  render() {
    const { gl, scene, camera } = this;
    if (!gl || !scene || !camera) return;
    gl.info.reset();
    if (!this.#modelPass) {
      gl.render(scene, camera);
      return;
    }
    gl.autoClear = true;
    gl.toneMapping = this.#modelToneMapping;
    gl.toneMappingExposure = this.config.render.lighting.exposure;
    camera.layers.set(this.#modelLayer);
    gl.render(scene, camera);
    const background = scene.background;
    scene.background = null;
    gl.autoClear = false;
    gl.toneMapping = THREE.NoToneMapping;
    camera.layers.set(0);
    gl.render(scene, camera);
    scene.background = background;
    gl.autoClear = true;
  }

  /** Dispose level meshes (blocks, units, slots, tiles) but keep gl/camera for the next level. */
  clear() {
    for (const group of this.#unitMeshes.values()) {
      this.factory.disposeLabel(group.userData.label);
      this.factory.disposeLabel(group.userData.labelSpare);
      if (group.userData.animator) group.userData.animator.dispose();
    }
    // Styled track: its InstancedMeshes' instance buffers (the GLB geometry and materials stay cached).
    if (this.#trackGroup && this.#trackGroup.userData.dispose) this.#trackGroup.userData.dispose();
    if (this.#slotCounter) this.factory.disposeLabel(this.#slotCounter);
    this.#slotCounter = null;
    if (this.#debugGroup) this.#debugGroup.children.forEach((line) => line.geometry.dispose());
    this.#debugGroup = null;
    if (this.#levelRoot) this.#levelRoot.clear();
    this.#blockMeshes.clear();
    this.#unitMeshes.clear();
    this.#slotMeshes = [];
    this.#pickables = [];
    this.#reserveAnim.clear();
    this.#departures.clear();
    this.#motion.clear();
    this.#counterFree = null;
    this.#counterPunchAt = -Infinity;
    this.#counterFlashAt = -Infinity;
    this.#entry = null;
    this.#trackGroup = null;
    this.#layout = null;
    this.#signature = null;
    this.#gridVersion = -1;
    this.#inventoryVersion = -1;
  }

  /** Full teardown. */
  dispose() {
    this.clear();
    if (this.vfx) this.vfx.dispose();
    if (this.vfxFactory) this.vfxFactory.dispose();
    this.factory.dispose();
    if (this.gl) this.gl.dispose();
    this.scene = null;
    this.camera = null;
    this.gl = null;
  }
}
