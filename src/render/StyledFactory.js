import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PrimitiveFactory } from './PrimitiveFactory.js';
import { fishLength, scaleToLength } from './assets/fitModel.js';
import { trackLoop } from './layout/computeTrackPieces.js';
import { fishTintMaterial } from './styled/fishTint.js';

const UP = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;
// Scratch objects for the chevron flow (no allocation per frame).
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _sample = { x: 0, y: 0, heading: 0 };
const _world = { x: 0, y: 0 };

/** Small deterministic hash of a unit id, so each fish starts its animation at its own point. */
function phaseOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

/**
 * Fish of Fortune look, step 1 (3D only). Same API as PrimitiveFactory, with two creations replaced:
 *   unit(color, id)   a skinned fish (SkeletonUtils clone; geometry, textures and skeleton data shared) tinted with one
 *                     shared material per palette colour, sized from its bounding box, turned to face +X (the unit's
 *                     heading axis) and animated: Swim while it moves, Idle otherwise (group.userData.animator)
 *   track(context)    the canal as InstancedMeshes built from the GLB geometry: one per piece type (straight, corner)
 *                     and material, the entry corner tinted through its instance colour, and chevrons flowing along
 *                     the canal's centre line in the travel direction (group.userData.animator / dispose)
 * Everything else (blocks, tiles, slots, labels, text, outlines) comes from PrimitiveFactory unchanged, and a model
 * that failed to load falls back to its primitive. GLB meshes are put on render.lighting.layer: only the model lights
 * reach them (see Renderer.render).
 */
export class StyledFactory extends PrimitiveFactory {
  /**
   * @param {object} config
   * @param {import('./assets/AssetLoader.js').AssetLoader} assets preloaded GLBs (StyledFactory.assetUrls)
   */
  constructor(config, assets) {
    super(config);
    this.assets = assets;
    this.models = config.render.models;
    this.modelLayer = config.render.lighting.layer;
    this._tints = new Map();
    this._fish = undefined;
    this._fishLength = config.render.layout.unitSize;
    this._pickGeometry = new THREE.BoxGeometry(1, 1, 1);
    this._pickMaterial = new THREE.MeshBasicMaterial();
  }

  /** Every GLB this factory uses; main.js preloads them before the start screen. */
  static assetUrls(config) {
    const { fish, track } = config.render.models;
    return [fish.url, track.straightUrl, track.cornerUrl, track.chevronUrl];
  }

  /** The level's layout: the fish size depends on its cellSize (it must fit the one-cell canal). */
  setLayout(layout) {
    const fish = this.#fishTemplate();
    const cfg = this.models.fish;
    this._fishLength = fish
      ? fishLength({ unitSize: this.layout.unitSize, scale: cfg.scale, cellSize: layout.cellSize, canalFit: cfg.canalFit, widthOverLength: fish.widthOverLength })
      : this.layout.unitSize;
  }

  /** Length (world units) of a unit on this level, nose to tail: where projectiles leave from. */
  unitLength() {
    return this._fishLength;
  }

  unit(color, id) {
    const fish = this.#fishTemplate();
    if (!fish) return super.unit(color, id);
    const cfg = this.models.fish;
    const length = this._fishLength;
    const scale = scaleToLength(fish.size, length);
    const model = cloneSkinned(fish.root);
    const material = this.#tintMaterial(this.style.palette[color]);
    const skinned = [];
    model.traverse((object) => {
      if (!object.isMesh) return;
      if (cfg.tintMaterialNames.includes(object.material.name)) object.material = material;
      object.layers.set(this.modelLayer);
      object.frustumCulled = false; // animated skin bounds are the bind pose's; the fish is small and always on screen
      if (object.isSkinnedMesh) skinned.push(object);
    });
    // Centre the model on its bounding box, face +X, and scale it to this level's length.
    model.position.set(-fish.center.x, -fish.center.y, -fish.center.z);
    const pivot = new THREE.Group();
    pivot.add(model);
    pivot.scale.setScalar(scale);
    pivot.rotation.y = cfg.rotationOffset * DEG;
    pivot.position.y = cfg.yOffset;
    // Invisible box on the default layer: what Renderer.pick hits, as it hit the cone.
    const pick = new THREE.Mesh(this._pickGeometry, this._pickMaterial);
    pick.visible = false;
    pick.scale.set(length, fish.size[1] * scale, fish.size[2] * scale);
    const group = new THREE.Group();
    group.add(pivot, pick);
    group.userData = { kind: 'unit', id, animator: new FishAnimator(model, skinned, fish.clips, cfg.animations, phaseOf(String(id))) };
    return group;
  }

  /**
   * The canal for a level, or null when the track models did not load (the Renderer then lays its tiles).
   * @param {{ pieces: Array<object>, dims: { rows: number, cols: number, margin: number, direction: string },
   *           cellSize: number, toWorld: (x: number, y: number, out: { x: number, y: number }) => object }} context
   */
  track({ pieces, dims, cellSize, toWorld }) {
    const cfg = this.models.track;
    const straight = this.assets.get(cfg.straightUrl);
    const corner = this.assets.get(cfg.cornerUrl);
    if (!straight || !corner) return null;
    const group = new THREE.Group();
    const meshes = [];
    const entryColor = new THREE.Color(cfg.entryTint);
    const white = new THREE.Color(0xffffff);
    for (const [type, gltf] of [['straight', straight], ['corner', corner]]) {
      const list = pieces.filter((piece) => piece.type === type);
      for (const part of this.#parts(gltf)) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        mesh.layers.set(this.modelLayer);
        list.forEach((piece, i) => {
          toWorld(piece.x, piece.y, _world);
          _p.set(_world.x, 0, _world.y);
          _q.setFromAxisAngle(UP, (piece.rotation * Math.PI) / 2);
          _s.setScalar(cellSize);
          mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
          if (type === 'corner') mesh.setColorAt(i, piece.entry ? entryColor : white);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        meshes.push(mesh);
        group.add(mesh);
      }
    }
    const chevrons = this.#chevrons(dims, cellSize, toWorld);
    if (chevrons) {
      meshes.push(chevrons.mesh);
      group.add(chevrons.mesh);
      group.userData.animator = chevrons;
    }
    group.userData.dispose = () => meshes.forEach((mesh) => mesh.dispose());
    return group;
  }

  /** Flowing chevrons: an InstancedMesh re-posed along the canal's centre line every frame (dt 0 while paused). */
  #chevrons(dims, cellSize, toWorld) {
    const cfg = this.models.track.chevrons;
    const gltf = this.assets.get(this.models.track.chevronUrl);
    if (!gltf) return null;
    const [part] = this.#parts(gltf);
    const loop = trackLoop({ ...dims, cornerRadius: cfg.cornerRadius });
    const count = Math.max(1, Math.round(loop.length / cfg.spacing));
    const spacing = loop.length / count;
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
    mesh.layers.set(this.modelLayer);
    mesh.frustumCulled = false;
    let phase = 0;
    const update = (dtMs) => {
      phase = (phase + dtMs / cfg.periodMs) % 1;
      for (let i = 0; i < count; i += 1) {
        loop.sample((i + phase) * spacing, _sample);
        toWorld(_sample.x, _sample.y, _world);
        _p.set(_world.x, 0, _world.y);
        _q.setFromAxisAngle(UP, _sample.heading);
        _s.setScalar(cellSize);
        mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    update(0);
    return { mesh, count, update };
  }

  /** The meshes of a loaded track GLB as { geometry, material } (materials prepared once: see #trackMaterial). */
  #parts(gltf) {
    const parts = [];
    gltf.scene.traverse((object) => {
      if (object.isMesh) parts.push({ geometry: object.geometry, material: this.#trackMaterial(object.material) });
    });
    return parts;
  }

  /**
   * Blender's transmission (KHR_materials_transmission on the water and the outer rim) is drawn as plain
   * transparency, opacity = 1 - transmission x transmissionWeight: the canal bed shows through the water as in the
   * Blender render, without the extra full-scene render a transmissive material costs in three.js. Those materials
   * draw their front faces only (the top-down camera never sees their undersides).
   */
  #trackMaterial(material) {
    if (material.userData.styledTrack) return material;
    material.userData.styledTrack = true;
    const { transmissionAsOpacity, transmissionWeight } = this.models.track;
    if (transmissionAsOpacity && material.transmission > 0) {
      material.opacity = 1 - material.transmission * transmissionWeight;
      material.transparent = true;
      material.transmission = 0;
      material.side = THREE.FrontSide;
    }
    return material;
  }

  #tintMaterial(hex) {
    let material = this._tints.get(hex);
    if (!material) {
      material = fishTintMaterial(this._fish.baseMaterial, hex, this.models.fish.tint);
      material.toneMapped = this.models.fish.toneMapped;
      this._tints.set(hex, material);
    }
    return material;
  }

  /** The loaded fish, measured once: bounding box (rest pose, Y-up), clips and the material to tint. */
  #fishTemplate() {
    if (this._fish !== undefined) return this._fish;
    const cfg = this.models.fish;
    const gltf = this.assets.get(cfg.url);
    if (!gltf) {
      this._fish = null;
      return null;
    }
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    let baseMaterial = null;
    gltf.scene.traverse((object) => {
      if (object.isMesh && cfg.tintMaterialNames.includes(object.material.name)) baseMaterial = object.material;
    });
    if (!baseMaterial) console.error(`StyledFactory: ${cfg.url} has no material named ${cfg.tintMaterialNames.join(' / ')}; fish are not tinted`);
    const byName = (name) => THREE.AnimationClip.findByName(gltf.animations, name) || null;
    this._fish = {
      root: gltf.scene,
      size: [size.x, size.y, size.z],
      center: box.getCenter(new THREE.Vector3()),
      widthOverLength: size.z / size.x,
      baseMaterial,
      clips: { swim: byName(cfg.animations.swim), idle: byName(cfg.animations.idle) },
    };
    return this._fish;
  }

  dispose() {
    super.dispose();
    for (const material of this._tints.values()) material.dispose();
    this._tints.clear();
    this._pickGeometry.dispose();
    this._pickMaterial.dispose();
    // The GLB assets themselves belong to the AssetLoader and stay cached.
  }
}

/**
 * One fish's animation: an AnimationMixer on its clone, cross-fading between Swim (moving) and Idle. update(dtMs, moving)
 * gets the Renderer's presentation time, so the animation stops while paused and follows debug.timeScale.
 */
class FishAnimator {
  constructor(root, skinned, clips, cfg, phase) {
    this.root = root;
    this.skinned = skinned;
    this.cfg = cfg;
    this.mixer = new THREE.AnimationMixer(root);
    this.swim = clips.swim ? this.mixer.clipAction(clips.swim) : null;
    this.idle = clips.idle ? this.mixer.clipAction(clips.idle) : null;
    if (this.swim) {
      this.swim.timeScale = cfg.swimSpeed;
      this.swim.time = phase * clips.swim.duration;
    }
    if (this.idle) {
      this.idle.timeScale = cfg.idleSpeed;
      this.idle.time = phase * clips.idle.duration;
      this.idle.play();
    }
    this.moving = false;
  }

  update(dtMs, moving) {
    if (moving !== this.moving) {
      this.moving = moving;
      const to = moving ? this.swim : this.idle;
      const from = moving ? this.idle : this.swim;
      const fade = this.cfg.fadeMs / 1000;
      if (to) to.reset().setEffectiveWeight(1).fadeIn(fade).play();
      if (from) from.fadeOut(fade);
    }
    if (dtMs > 0) this.mixer.update(dtMs / 1000);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    for (const mesh of this.skinned) mesh.skeleton.dispose();
  }
}
