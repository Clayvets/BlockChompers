import * as THREE from 'three';

const LAY_FLAT = -Math.PI / 2;
/** thetaStart that centres an odd-sided cone base on the heading axis (symmetric footprint from above). */
const SYMMETRIC_BASE = Math.PI / 2;

/**
 * The reskin seam. Every visual in the scene is created here from Three.js primitives; swapping
 * this class (same interface) for one that loads GLTF models re-skins the game without touching
 * core or Renderer.
 *
 * Geometries and materials are cached by key and shared; only capacity labels own their resources
 * (one canvas per unit) and must be released with disposeLabel(). Meshes carry userData = { kind, id }
 * so Renderer.pick can map hits back to logical ids.
 */
export class PrimitiveFactory {
  constructor(config) {
    this.config = config;
    this.render = config.render;
    /** Shared geometries/materials keyed by descriptor, disposed in dispose(). */
    this._cache = new Map();
    this.setStyle({});
  }

  /**
   * Per-level colours (Renderer resolves them from Config.render.levels): palette for blocks/units and the
   * colours of empty ring and reserve cells. Omitted keys fall back to the render defaults.
   * @param {{ palette?: object, guideColor?: number, entryColor?: number, tileColor?: number }} style
   */
  setStyle(style) {
    const { palette, track, inventory } = this.render;
    this.style = {
      palette: style.palette || palette,
      guideColor: style.guideColor ?? track.guideColor,
      entryColor: style.entryColor ?? track.entryColor,
      tileColor: style.tileColor ?? inventory.tileColor,
    };
  }

  #cached(key, create) {
    let value = this._cache.get(key);
    if (!value) {
      value = create();
      this._cache.set(key, value);
    }
    return value;
  }

  #hex(color) {
    const hex = this.style.palette[color];
    if (hex === undefined) throw new Error(`PrimitiveFactory: no palette entry for colour ${color}`);
    return hex;
  }

  #lit(hex) {
    return this.#cached(`lit:${hex}`, () => new THREE.MeshLambertMaterial({ color: hex }));
  }

  #flat(hex) {
    return this.#cached(`flat:${hex}`, () => new THREE.MeshBasicMaterial({ color: hex }));
  }

  #tileGeometry(scale) {
    const edge = this.render.cellSize * scale;
    return this.#cached(`tile:${edge}`, () => new THREE.PlaneGeometry(edge, edge).rotateX(LAY_FLAT));
  }

  /** A grid block: BoxGeometry(cellSize - gap, blockHeight, cellSize - gap) x palette[color]. */
  block(color, row, col) {
    const { cellSize, gap, blockHeight } = this.render;
    const geometry = this.#cached('block', () => new THREE.BoxGeometry(cellSize - gap, blockHeight, cellSize - gap));
    const mesh = new THREE.Mesh(geometry, this.#lit(this.#hex(color)));
    mesh.userData = { kind: 'block', id: `${row},${col}` };
    return mesh;
  }

  /** A unit ("chomper"): a cone lying on its side with the apex on +x, so rotation.y encodes heading. */
  unit(color, id) {
    const { unitSize, unit } = this.render;
    const geometry = this.#cached('unit', () =>
      new THREE.ConeGeometry(unitSize * unit.coneRadiusFactor, unitSize, unit.radialSegments, 1, false, SYMMETRIC_BASE).rotateZ(LAY_FLAT),
    );
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, this.#lit(this.#hex(color))));
    group.userData = { kind: 'unit', id };
    return group;
  }

  /** Active-slot marker tinted by status; userData = { kind: 'slot', id: index }. */
  slot(status, index) {
    const mesh = new THREE.Mesh(this.#tileGeometry(this.render.inventory.tileScale), this.slotMaterial(status));
    mesh.userData = { kind: 'slot', id: index };
    return mesh;
  }

  /** Shared material for a slot status ('free' | 'occupied' | 'blocked'). */
  slotMaterial(status) {
    return this.#flat(this.render.slotColors[status]);
  }

  /** Background tile under a reserve position. */
  reserveTile() {
    return new THREE.Mesh(this.#tileGeometry(this.render.inventory.tileScale), this.#flat(this.style.tileColor));
  }

  /** Track guide tile; the entry corner gets the entry colour. */
  trackTile(isEntry = false) {
    const { guideColor, entryColor } = this.style;
    return new THREE.Mesh(this.#tileGeometry(this.render.track.tileScale), this.#flat(isEntry ? entryColor : guideColor));
  }

  /** A camera-facing number sprite (own canvas + texture), always drawn on top. */
  label(text) {
    const { canvasSize, worldSize } = this.render.label;
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.scale.set(worldSize, worldSize, 1);
    sprite.renderOrder = 10;
    sprite.userData = { canvas, text: null };
    this.setLabel(sprite, text);
    return sprite;
  }

  /** Redraw a label only when its text changed. */
  setLabel(sprite, text) {
    if (sprite.userData.text === text) return;
    const { canvasSize, font, color, outline, outlineWidth } = this.render.label;
    const ctx = sprite.userData.canvas.getContext('2d');
    const mid = canvasSize / 2;
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = outlineWidth;
    ctx.strokeStyle = outline;
    ctx.strokeText(text, mid, mid);
    ctx.fillStyle = color;
    ctx.fillText(text, mid, mid);
    sprite.material.map.needsUpdate = true;
    sprite.userData.text = text;
  }

  /** Release a label's own texture and material (shared resources are left alone). */
  disposeLabel(sprite) {
    sprite.material.map.dispose();
    sprite.material.dispose();
  }

  /** Dispose every cached geometry/material. */
  dispose() {
    for (const resource of this._cache.values()) resource.dispose();
    this._cache.clear();
  }
}
