import * as THREE from 'three';

/**
 * The reskin seam. Every visual in the scene is created here from Three.js primitives; swapping
 * this class (same interface) for one that loads GLTF models re-skins the game without touching
 * core or Renderer.
 *
 * Every mesh gets userData = { kind, id } so Renderer.pick can map hits back to logical ids.
 */
export class PrimitiveFactory {
  constructor(config) {
    this.config = config;
    this.render = config.render;
    /** Shared geometries/materials keyed by descriptor, disposed in dispose(). */
    this._cache = new Map();
  }

  /** A grid block: BoxGeometry(cellSize - gap, blockHeight, cellSize - gap) x palette[color]; userData.kind = 'block'. */
  block(color, row, col) {
    // TODO(impl)
    return new THREE.Mesh();
  }

  /** A unit ("chomper"): e.g. a ConeGeometry pointing +x so rotation.y encodes `facing`; userData = { kind: 'unit', id }. */
  unit(color, id) {
    // TODO(impl)
    return new THREE.Mesh();
  }

  /** Active-slot marker: PlaneGeometry x slotColors[status]; userData = { kind: 'slot', id: index }. */
  slot(status, index) {
    // TODO(impl)
    return new THREE.Mesh();
  }

  /** Optional track guide tile (render.track.showGuide). */
  trackTile() {
    // TODO(impl)
    return new THREE.Mesh();
  }

  /** Dispose every cached geometry/material. */
  dispose() {
    // TODO(impl)
  }
}
