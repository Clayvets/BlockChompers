import * as THREE from 'three';
import { PrimitiveFactory } from './PrimitiveFactory.js';
import { Events } from '../core/Events.js';
import { UnitState } from '../core/Unit.js';

/** facing -> heading on the cell plane (x right, y down). */
const HEADING = Object.freeze({ N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] });
const IN_SLOT = new Set([UnitState.ACTIVE, UnitState.RETURNED]);

/**
 * The Three.js bridge. Reads snapshots, owns the scene graph, never mutates game state.
 *
 *   sync(snapshot)  -- structure: static layer (track guide, slots, reserve tiles, camera) rebuilt when the
 *                      level's shape changes, blocks diffed on grid.version, slot tints on inventory.version,
 *                      units re-posed every frame
 *   bindEvents(bus) -- effects only (end-of-level background tint)
 *
 * All layout is computed in CELL units (x right, y down, origin = grid top-left) and converted once in
 * cellToWorld(). Concurrent runners ride parallel sub-lanes (render.track.laneOffsetPerSlot x slotIndex
 * along the track's outward normal) so they never overlap while core stays pure pass-through.
 */
export class Renderer {
  /** @type {Map<string, THREE.Mesh>} key 'row,col' */
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
  #layout = null;
  #pickables = [];
  /** Reserve shift animation state per unit id: { col, y (drawn row), target, startAt }. */
  #reserveAnim = new Map();
  #animClock = null;
  #size = { width: 1, height: 1 };
  /** Screen pixels covered by DOM chrome (HUD bar); fitCamera keeps the board out of them. */
  #insets = { top: 0, bottom: 0 };

  /**
   * @param {{ canvas: HTMLCanvasElement, config: object, factory?: PrimitiveFactory }} deps
   */
  constructor({ canvas, config, factory = new PrimitiveFactory(config) }) {
    this.canvas = canvas;
    this.config = config;
    this.factory = factory;
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
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.config.render.background);
    this.#levelRoot = new THREE.Group();
    this.scene.add(this.#levelRoot);
    this.initLights();
    this.initOrthographicCamera();
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
   * Fit the frustum to `bounds` (cell units) + render.camera.padding, preserving aspect; centre on them.
   * @param {{ minX: number, maxX: number, minY: number, maxY: number }} [bounds]
   */
  fitCamera(bounds = this.#layout && this.#layout.bounds) {
    if (!this.camera || !bounds) return;
    const { cellSize, camera: cam } = this.config.render;
    const { width, height } = this.#size;
    const usable = Math.max(1, height - this.#insets.top - this.#insets.bottom);
    const halfW0 = ((bounds.maxX - bounds.minX) * cellSize) / 2 + cam.padding;
    const halfH0 = ((bounds.maxY - bounds.minY) * cellSize) / 2 + cam.padding;
    const usableHalfH = Math.max(halfH0, (halfW0 * usable) / width);
    const worldPerPx = (2 * usableHalfH) / usable;
    const halfW = (width * worldPerPx) / 2;
    const halfH = (height * worldPerPx) / 2;
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    // Centre the bounds in the band between the insets: screen-up is world -z.
    const shift = ((this.#insets.top - this.#insets.bottom) / 2) * worldPerPx;
    const centre = this.cellToWorld((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
    this.camera.position.set(centre.x, cam.height, centre.z - shift);
    this.camera.lookAt(centre.x, 0, centre.z - shift);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Reserve screen pixels for DOM chrome (the HUD bar). main.js passes Config.ui.sizes.barHeight as top.
   * @param {{ top?: number, bottom?: number }} insets
   */
  setViewportInsets({ top = 0, bottom = 0 } = {}) {
    this.#insets = { top, bottom };
    this.fitCamera();
  }

  /** Level shape -> slot row, reserve grid and camera bounds, all in cell units. */
  #computeLayout(snapshot) {
    const { rows, cols } = snapshot.grid;
    const { margin } = snapshot.track;
    const { reserveCols, reserveRows } = snapshot.inventory;
    const { inventory: inv, track, unitSize } = this.config.render;
    const slotCount = snapshot.slots.length;
    const pitch = 1 + inv.slotGap;
    const cx = cols / 2;
    // How far the outermost sub-lane (plus half a unit) reaches beyond the ring centre line.
    const reach = Math.max(0.5, track.laneOffsetPerSlot * (slotCount - 1) + unitSize / 2);
    const panelTop = rows + margin - 0.5 + reach + inv.gapBelowGrid;
    const slotY = panelTop + inv.slotsRowOffset;
    const reserveY = panelTop + inv.reserveRowOffset;
    const halfRow = (Math.max(slotCount, reserveCols) * pitch) / 2;
    return {
      pitch,
      bounds: {
        minX: Math.min(-margin + 0.5 - reach, cx - halfRow),
        maxX: Math.max(cols + margin - 0.5 + reach, cx + halfRow),
        minY: -margin + 0.5 - reach,
        maxY: reserveY + (Math.max(1, reserveRows) - 1) * pitch + pitch / 2,
      },
      slotPos: (index) => ({ x: cx + (index - (slotCount - 1) / 2) * pitch, y: slotY }),
      reservePos: ({ col, row }) => ({ x: cx + (col - (reserveCols - 1) / 2) * pitch, y: reserveY + row * pitch }),
    };
  }

  /** Diff block meshes against the grid state: add missing / recoloured cells, remove emptied ones. */
  buildGridFromState(gridState) {
    const empty = this.config.grid.emptyValue;
    const half = this.config.render.blockHeight / 2;
    const live = new Set();
    gridState.cells.forEach((row, r) => row.forEach((value, c) => {
      if (value === empty) return;
      const key = `${r},${c}`;
      live.add(key);
      const existing = this.#blockMeshes.get(key);
      if (existing && existing.userData.color === value) return;
      if (existing) this.#levelRoot.remove(existing);
      const mesh = this.factory.block(value, r, c);
      mesh.userData.color = value;
      this.cellToWorld(c + 0.5, r + 0.5, half, mesh.position);
      this.#levelRoot.add(mesh);
      this.#blockMeshes.set(key, mesh);
    }));
    for (const [key, mesh] of this.#blockMeshes) {
      if (live.has(key)) continue;
      this.#levelRoot.remove(mesh);
      this.#blockMeshes.delete(key);
    }
  }

  /** Guide tiles on every ring cell (render.track.showGuide); the entry corner is tinted. */
  buildTrack(trackState) {
    if (!this.config.render.track.showGuide) return;
    const xs = trackState.corners.map((c) => c.x);
    const ys = trackState.corners.map((c) => c.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const entry = trackState.corners[0];
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
    this.cellToWorld(x, y, 0, tile.position);
    group.add(tile);
  }

  /** Tint slot markers by status (called when inventory.version changes). */
  buildInventory(snapshot) {
    for (const slot of snapshot.slots) {
      const mesh = this.#slotMeshes[slot.index];
      if (mesh) mesh.material = this.factory.slotMaterial(slot.status);
    }
  }

  /** Per-frame sync from a snapshot. Safe to call before a level is loaded. */
  sync(snapshot) {
    if (!this.scene || !snapshot || !snapshot.track) return;
    const signature = this.#signatureOf(snapshot);
    if (signature !== this.#signature) this.#rebuildStatic(snapshot, signature);
    if (snapshot.grid.version !== this.#gridVersion) {
      this.buildGridFromState(snapshot.grid);
      this.#gridVersion = snapshot.grid.version;
    }
    if (snapshot.inventory.version !== this.#inventoryVersion) {
      this.buildInventory(snapshot);
      this.#inventoryVersion = snapshot.inventory.version;
    }
    this.#syncUnits(snapshot);
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

  /** New level shape: drop every level mesh, lay out the static layer again and refit the camera. */
  #rebuildStatic(snapshot, signature) {
    this.clear();
    this.#signature = signature;
    this.#style = this.#styleFor(snapshot.levelId);
    this.factory.setStyle(this.#style);
    this.scene.background.setHex(this.#style.background);
    this.#layout = this.#computeLayout(snapshot);
    this.buildTrack(snapshot.track);
    for (let index = 0; index < snapshot.slots.length; index += 1) {
      const mesh = this.factory.slot('free', index);
      const { x, y } = this.#layout.slotPos(index);
      this.cellToWorld(x, y, 0, mesh.position);
      this.#levelRoot.add(mesh);
      this.#slotMeshes.push(mesh);
    }
    const { reserveCols, reserveRows } = snapshot.inventory;
    for (let row = 0; row < reserveRows; row += 1) {
      for (let col = 0; col < reserveCols; col += 1) {
        const tile = this.factory.reserveTile();
        const { x, y } = this.#layout.reservePos({ col, row });
        this.cellToWorld(x, y, 0, tile.position);
        this.#levelRoot.add(tile);
      }
    }
    this.fitCamera();
  }

  #syncUnits({ units, slots }) {
    const { unitHeight, label } = this.config.render;
    const now = performance.now();
    const dt = this.#animClock === null ? 0 : now - this.#animClock;
    this.#animClock = now;
    this.#animateReserve(units, now, dt);
    const frontOnly = this.config.inventory.frontOnlyPick;
    const pickables = slots.filter((s) => s.status === 'blocked').map((s) => this.#slotMeshes[s.index]).filter(Boolean);
    const alive = new Set();
    for (const unit of units) {
      if (unit.state === UnitState.DEAD) continue;
      alive.add(unit.id);
      let group = this.#unitMeshes.get(unit.id);
      if (group && group.userData.color !== unit.color) {
        this.#removeUnit(unit.id, group); // same id, different level: rebuild in the new colour
        group = undefined;
      }
      if (!group) {
        group = this.factory.unit(unit.color, unit.id);
        group.userData.color = unit.color;
        const sprite = this.factory.label(String(unit.capacity));
        sprite.position.y = label.yOffset;
        group.add(sprite);
        group.userData.label = sprite;
        this.#levelRoot.add(group);
        this.#unitMeshes.set(unit.id, group);
      }
      this.factory.setLabel(group.userData.label, String(unit.capacity));
      group.userData.pickAs = this.#pickTarget(unit, frontOnly);
      if (group.userData.pickAs) pickables.push(group);
      const { x, y, facing } = this.#unitCellPose(unit);
      const [dx, dy] = HEADING[facing];
      this.cellToWorld(x, y, unitHeight / 2, group.position);
      group.rotation.y = Math.atan2(-dy, dx);
    }
    for (const [id, group] of this.#unitMeshes) {
      if (!alive.has(id)) this.#removeUnit(id, group);
    }
    this.#pickables = pickables;
  }

  /** Raycast target for a unit: front reserve units launch, parked units relaunch from their slot, others none. */
  #pickTarget(unit, frontOnly) {
    if (unit.state === UnitState.RESERVE && (!frontOnly || unit.reservePos.row === 0)) return { kind: 'unit', id: unit.id };
    if (unit.state === UnitState.RETURNED && unit.slotIndex !== null) return { kind: 'slot', id: unit.slotIndex };
    return null;
  }

  /**
   * Reserve shift animation (presentation only: the logic already moved the units). Per column, front to back, a
   * unit whose row moved up starts render.reserveShiftStaggerMs after the unit ahead, glides one row per
   * render.reserveShiftMs, and is never drawn closer than one row to the unit ahead, so meshes never overlap.
   * A unit whose row moved back (level restart) snaps.
   */
  #animateReserve(units, now, dt) {
    const { reserveShiftMs, reserveShiftStaggerMs } = this.config.render;
    const columns = new Map();
    const inReserve = new Set();
    for (const unit of units) {
      if (unit.state !== UnitState.RESERVE) continue;
      inReserve.add(unit.id);
      const { col, row } = unit.reservePos;
      let entry = this.#reserveAnim.get(unit.id);
      if (!entry || entry.col !== col || row > entry.target) {
        entry = { col, y: row, target: row, startAt: now };
        this.#reserveAnim.set(unit.id, entry);
      } else if (row < entry.target) {
        entry.target = row;
        entry.startAt = null;
      }
      if (!columns.has(col)) columns.set(col, []);
      columns.get(col).push(entry);
    }
    for (const id of this.#reserveAnim.keys()) if (!inReserve.has(id)) this.#reserveAnim.delete(id);
    for (const column of columns.values()) {
      column.sort((a, b) => a.target - b.target);
      let leaderStart = -Infinity;
      let leaderY = -Infinity;
      for (const entry of column) {
        if (entry.startAt === null) entry.startAt = Math.max(now, leaderStart + reserveShiftStaggerMs);
        if (entry.y > entry.target) {
          leaderStart = entry.startAt;
          if (now >= entry.startAt) entry.y = Math.max(entry.target, entry.y - dt / reserveShiftMs);
        }
        entry.y = Math.max(entry.y, leaderY + 1);
        leaderY = entry.y;
      }
    }
  }

  /** Reserve cell, slot, or track pose pushed outward onto the unit's sub-lane. */
  #unitCellPose(unit) {
    if (unit.pose) {
      const offset = this.config.render.track.laneOffsetPerSlot * (unit.slotIndex || 0);
      const { x, y, facing, outward } = unit.pose;
      return { x: x + outward.dx * offset, y: y + outward.dy * offset, facing };
    }
    if (IN_SLOT.has(unit.state) && unit.slotIndex !== null) return { ...this.#layout.slotPos(unit.slotIndex), facing: 'N' };
    const anim = this.#reserveAnim.get(unit.id);
    const row = anim ? anim.y : unit.reservePos.row;
    return { ...this.#layout.reservePos({ col: unit.reservePos.col, row }), facing: 'N' };
  }

  #removeUnit(id, group) {
    this.factory.disposeLabel(group.userData.label);
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
    return () => offs.forEach((off) => off());
  }

  /** Cell units (x right, y down) -> world (x right, z down, y up); applies render.cellSize. */
  cellToWorld(x, y, height = 0, target = new THREE.Vector3()) {
    const { cellSize } = this.config.render;
    return target.set(x * cellSize, height, y * cellSize);
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

  render() {
    if (this.gl && this.scene && this.camera) this.gl.render(this.scene, this.camera);
  }

  /** Dispose level meshes (blocks, units, slots, tiles) but keep gl/camera for the next level. */
  clear() {
    for (const group of this.#unitMeshes.values()) this.factory.disposeLabel(group.userData.label);
    if (this.#levelRoot) this.#levelRoot.clear();
    this.#blockMeshes.clear();
    this.#unitMeshes.clear();
    this.#slotMeshes = [];
    this.#pickables = [];
    this.#reserveAnim.clear();
    this.#animClock = null;
    this.#trackGroup = null;
    this.#layout = null;
    this.#signature = null;
    this.#gridVersion = -1;
    this.#inventoryVersion = -1;
  }

  /** Full teardown. */
  dispose() {
    this.clear();
    this.factory.dispose();
    if (this.gl) this.gl.dispose();
    this.scene = null;
    this.camera = null;
    this.gl = null;
  }
}
