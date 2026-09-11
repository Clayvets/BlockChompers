import * as THREE from 'three';
import { PrimitiveFactory } from './PrimitiveFactory.js';
import { Events } from '../core/Events.js';
import { UnitState } from '../core/Unit.js';

/** facing -> heading on the cell plane (x right, y down). */
const HEADING = Object.freeze({ N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] });
const IN_SLOT = new Set([UnitState.ACTIVE, UnitState.RETURNED]);
const PICKABLE_KINDS = new Set(['unit', 'slot']);

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
  #layout = null;
  #pickables = [];
  #size = { width: 1, height: 1 };

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
    const aspect = this.#size.width / this.#size.height;
    const halfW0 = ((bounds.maxX - bounds.minX) * cellSize) / 2 + cam.padding;
    const halfH0 = ((bounds.maxY - bounds.minY) * cellSize) / 2 + cam.padding;
    const halfH = Math.max(halfH0, halfW0 / aspect);
    const halfW = halfH * aspect;
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    const centre = this.cellToWorld((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
    this.camera.position.set(centre.x, cam.height, centre.z);
    this.camera.lookAt(centre.x, 0, centre.z);
    this.camera.updateProjectionMatrix();
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
    this.#syncUnits(snapshot.units);
  }

  #signatureOf({ grid, track, slots, inventory }) {
    const entry = track.corners[0];
    return [grid.rows, grid.cols, track.margin, track.direction, entry.x, entry.y, slots.length, inventory.reserveCols, inventory.reserveRows].join(':');
  }

  /** New level shape: drop every level mesh, lay out the static layer again and refit the camera. */
  #rebuildStatic(snapshot, signature) {
    this.clear();
    this.#signature = signature;
    this.#layout = this.#computeLayout(snapshot);
    this.buildTrack(snapshot.track);
    for (let index = 0; index < snapshot.slots.length; index += 1) {
      const mesh = this.factory.slot('free', index);
      const { x, y } = this.#layout.slotPos(index);
      this.cellToWorld(x, y, 0, mesh.position);
      this.#levelRoot.add(mesh);
      this.#slotMeshes.push(mesh);
      this.#pickables.push(mesh);
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

  #syncUnits(units) {
    const { unitHeight, label } = this.config.render;
    const alive = new Set();
    for (const unit of units) {
      if (unit.state === UnitState.DEAD) continue;
      alive.add(unit.id);
      let group = this.#unitMeshes.get(unit.id);
      if (!group) {
        group = this.factory.unit(unit.color, unit.id);
        const sprite = this.factory.label(String(unit.capacity));
        sprite.position.y = label.yOffset;
        group.add(sprite);
        group.userData.label = sprite;
        this.#levelRoot.add(group);
        this.#unitMeshes.set(unit.id, group);
        this.#pickables.push(group);
      }
      this.factory.setLabel(group.userData.label, String(unit.capacity));
      const { x, y, facing } = this.#unitCellPose(unit);
      const [dx, dy] = HEADING[facing];
      this.cellToWorld(x, y, unitHeight / 2, group.position);
      group.rotation.y = Math.atan2(-dy, dx);
    }
    for (const [id, group] of this.#unitMeshes) {
      if (!alive.has(id)) this.#removeUnit(id, group);
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
    return { ...this.#layout.reservePos(unit.reservePos), facing: 'N' };
  }

  #removeUnit(id, group) {
    this.factory.disposeLabel(group.userData.label);
    this.#levelRoot.remove(group);
    this.#unitMeshes.delete(id);
    this.#pickables = this.#pickables.filter((object) => object !== group);
  }

  /**
   * Cosmetic reactions only: tint the background on LEVEL_WON / LEVEL_LOST, restore it on LEVEL_LOADED.
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
      eventBus.on(Events.LEVEL_LOADED, tint(background)),
    ];
    return () => offs.forEach((off) => off());
  }

  /** Cell units (x right, y down) -> world (x right, z down, y up); applies render.cellSize. */
  cellToWorld(x, y, height = 0, target = new THREE.Vector3()) {
    const { cellSize } = this.config.render;
    return target.set(x * cellSize, height, y * cellSize);
  }

  /**
   * Raycast units and slots from normalised device coords.
   * @returns {{ kind: 'unit'|'slot', id: string|number } | null}
   */
  pick(ndcX, ndcY) {
    if (!this.camera) return null;
    this._raycaster.setFromCamera(this._ndc.set(ndcX, ndcY), this.camera);
    for (const hit of this._raycaster.intersectObjects(this.#pickables, true)) {
      for (let object = hit.object; object; object = object.parent) {
        const { kind, id } = object.userData || {};
        if (PICKABLE_KINDS.has(kind)) return { kind, id };
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
