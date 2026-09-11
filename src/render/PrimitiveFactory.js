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
 *
 * Sizes: board pieces (blocks, track tiles) are built for a 1 x 1 cell and scaled by the Renderer to the level's
 * cellSize; everything else (slots, reserve tiles, units, labels) is built at its constant render.layout size.
 */
export class PrimitiveFactory {
  constructor(config) {
    this.config = config;
    this.render = config.render;
    this.layout = config.render.layout;
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

  /** Flat square tile of the given world edge. */
  #tileGeometry(edge) {
    return this.#cached(`tile:${edge}`, () => new THREE.PlaneGeometry(edge, edge).rotateX(LAY_FLAT));
  }

  /** A grid block for a 1 x 1 cell: BoxGeometry(1 - gap, blockHeight, 1 - gap) x palette[color]; scale it by cellSize. */
  block(color, row, col) {
    const { gap, blockHeight } = this.render;
    const geometry = this.#cached('block', () => new THREE.BoxGeometry(1 - gap, blockHeight, 1 - gap));
    const mesh = new THREE.Mesh(geometry, this.#lit(this.#hex(color)));
    mesh.userData = { kind: 'block', id: `${row},${col}` };
    return mesh;
  }

  /** A unit ("chomper"): a cone lying on its side with the apex on +x, so rotation.y encodes heading. */
  unit(color, id) {
    const { unit } = this.render;
    const { unitSize } = this.layout;
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
    const mesh = new THREE.Mesh(this.#tileGeometry(this.layout.slotSize * this.render.inventory.tileScale), this.slotMaterial(status));
    mesh.userData = { kind: 'slot', id: index };
    return mesh;
  }

  /** Shared material for a slot status ('free' | 'blocked'). */
  slotMaterial(status) {
    return this.#flat(this.render.slotColors[status]);
  }

  /** Background tile under a reserve position. */
  reserveTile() {
    return new THREE.Mesh(this.#tileGeometry(this.layout.reserveCellSize * this.render.inventory.tileScale), this.#flat(this.style.tileColor));
  }

  /** Track guide tile for a 1 x 1 cell (scale it by cellSize); the entry corner gets the entry colour. */
  trackTile(isEntry = false) {
    const { guideColor, entryColor } = this.style;
    return new THREE.Mesh(this.#tileGeometry(this.render.track.tileScale), this.#flat(isEntry ? entryColor : guideColor));
  }

  /** A unit's capacity label: a square text sprite styled by render.label, render.layout.labelSize high. */
  label(text) {
    const { canvasSize, ...style } = this.render.label;
    return this.text(text, { ...style, canvasWidth: canvasSize, canvasHeight: canvasSize, height: this.layout.labelSize });
  }

  /**
   * Debug outline of a rect { x, y, w, h } on the ground plane (design units; x -> world x, y -> world z), drawn on top.
   * The geometry is the caller's to dispose (Renderer.clear drops it with the level).
   */
  outline({ x, y, w, h }, color, height = 0.02) {
    const points = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, pz]) => new THREE.Vector3(px, height, pz));
    const material = this.#cached(`line:${color}`, () => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
    line.renderOrder = 20;
    return line;
  }

  setLabel(sprite, text) {
    this.setText(sprite, text);
  }

  /**
   * Plain camera-facing text (own canvas + texture), always drawn on top; release it with disposeLabel().
   * @param {string} text
   * @param {{ canvasWidth: number, canvasHeight: number, height: number, font: string, color: string,
   *           outline: string, outlineWidth: number }} style  height in world units; width follows the canvas aspect
   */
  text(text, style) {
    const canvas = document.createElement('canvas');
    canvas.width = style.canvasWidth;
    canvas.height = style.canvasHeight;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.scale.set((style.height * style.canvasWidth) / style.canvasHeight, style.height, 1);
    sprite.renderOrder = 10;
    sprite.userData = { canvas, style, text: null };
    this.setText(sprite, text);
    return sprite;
  }

  /** Redraw a text sprite only when its text changed. */
  setText(sprite, text) {
    if (sprite.userData.text === text) return;
    const { canvas, style } = sprite.userData;
    const ctx = canvas.getContext('2d');
    const [cx, cy] = [canvas.width / 2, canvas.height / 2];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = style.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // Squeeze wide text (e.g. 3-digit capacities) horizontally so it fits instead of being clipped.
    const room = canvas.width - (style.outlineWidth || 0);
    const width = ctx.measureText(text).width;
    ctx.save();
    if (width > room) {
      ctx.translate(cx, 0);
      ctx.scale(room / width, 1);
      ctx.translate(-cx, 0);
    }
    if (style.outlineWidth > 0) {
      ctx.lineWidth = style.outlineWidth;
      ctx.strokeStyle = style.outline;
      ctx.strokeText(text, cx, cy);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(text, cx, cy);
    ctx.restore();
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
