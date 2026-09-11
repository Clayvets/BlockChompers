import * as THREE from 'three';
import { PrimitiveFactory } from './PrimitiveFactory.js';
import { Events } from '../core/Events.js';

/**
 * The Three.js bridge. Reads snapshots, owns the scene graph, never mutates game state.
 *
 *   sync(snapshot)  -- structure: rebuild meshes when grid/inventory versions change, re-pose units every frame
 *   bindEvents(bus) -- effects: optional one-shot visuals (puffs, fades, tweens)
 *
 * Rule: sync() alone must produce a correct picture; a renderer that ignores every event is still correct.
 * Units are drawn on parallel sub-lanes (render.track.laneOffsetPerSlot x slotIndex) so concurrent
 * runners never overlap visually while core stays pure pass-through.
 */
export class Renderer {
  /** @type {Map<string, THREE.Mesh>} key 'row,col' */
  #blockMeshes = new Map();
  /** @type {Map<string, THREE.Mesh>} key unit id */
  #unitMeshes = new Map();
  /** @type {THREE.Mesh[]} index = slot index */
  #slotMeshes = [];
  /** @type {THREE.Group | null} */
  #trackGroup = null;
  #gridVersion = -1;
  #inventoryVersion = -1;
  /** Meshes eligible for raycasting (units, slots). */
  #pickables = [];

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
  }

  /** WebGLRenderer on `canvas` (antialias, pixel ratio, clear colour = render.background), scene, lights, camera. */
  init() {
    // TODO(impl)
  }

  /**
   * Strictly top-down OrthographicCamera: positioned at (cx, render.camera.height, cz) looking at (cx, 0, cz),
   * frustum sized to grid + inventory bounds + render.camera.padding, aspect-corrected in resize().
   */
  initOrthographicCamera() {
    // TODO(impl)
  }

  initLights() {
    // TODO(impl)
  }

  /**
   * Rebuild block meshes from a grid state: dispose existing, one factory.block(color) per non-empty
   * cell, positioned via cellToWorld(col, row).
   * @param {{ rows: number, cols: number, cells: number[][], version: number }} gridState
   */
  buildGridFromState(gridState) {
    // TODO(impl)
  }

  /** Optional guide loop from trackState.corners (render.track.showGuide). */
  buildTrack(trackState) {
    // TODO(impl)
  }

  /** Reserve panel (render.inventory.gapBelowGrid under the grid) + config.inventory.activeSlots slot markers. */
  buildInventory(snapshot) {
    // TODO(impl)
  }

  /**
   * Per-frame structural sync: rebuild grid/inventory if their version changed, create/remove unit
   * meshes by id, pose every unit (reserve cell, slot, or track pose + sub-lane offset), tint slots by status.
   */
  sync(snapshot) {
    // TODO(impl)
  }

  /**
   * Subscribe cosmetic reactions: BLOCK_CONSUMED puff, UNIT_DIED fade, UNIT_RETURNED tween over
   * timing.returnDuration, LEVEL_WON/LOST flourish.
   * @returns {() => void} unbind
   */
  bindEvents(eventBus) {
    // TODO(impl)
    return () => {};
  }

  /** Cell units (x right, y down) -> world (x right, z down, y up); applies render.cellSize. */
  cellToWorld(x, y, height = 0) {
    // TODO(impl)
    return new THREE.Vector3(x, height, y);
  }

  /**
   * Raycast the pickable meshes from normalised device coords.
   * @returns {{ kind: 'unit'|'slot'|'block', id: string|number } | null}
   */
  pick(ndcX, ndcY) {
    // TODO(impl)
    return null;
  }

  resize(width, height) {
    // TODO(impl)
  }

  render() {
    // TODO(impl)
  }

  /** Dispose level meshes (blocks, units, slots, track) but keep gl/camera for the next level. */
  clear() {
    // TODO(impl)
  }

  /** Full teardown. */
  dispose() {
    // TODO(impl)
  }
}
