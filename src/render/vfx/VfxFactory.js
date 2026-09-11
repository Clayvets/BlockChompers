import * as THREE from 'three';

/**
 * The VFX reskin seam, like PrimitiveFactory: the ONLY place that creates effect geometries and materials. Each
 * effect type is one InstancedMesh of a plain shape (no textures, no image assets), preallocated to its cap in
 * Config.render.vfx, with a per-instance colour and a per-instance opacity. VfxManager only writes instance transforms,
 * colours and opacities, so changing a look -- e.g. projectiles becoming bubbles -- touches only the matching method
 * below and render config. (The win confetti is a 2D canvas: ConfettiLayer.)
 */
export class VfxFactory {
  constructor(config) {
    this.config = config;
    this._materials = new Map();
    this._geometries = [];
  }

  #material(key, side) {
    let material = this._materials.get(key);
    if (!material) {
      // forceSinglePass: a transparent double-sided material would otherwise cost two draw calls (back, then front).
      material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side, forceSinglePass: true });
      // Multiply a per-instance opacity into the alpha (no texture, no custom shader file).
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vInstanceOpacity;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstanceOpacity;');
      };
      material.customProgramCacheKey = () => 'vfx-instance-opacity';
      this._materials.set(key, material);
    }
    return material;
  }

  /** InstancedMesh with `cap` instances, dynamic transform/colour/opacity buffers, drawn on top, count 0. */
  #instanced(geometry, material, cap) {
    this._geometries.push(geometry);
    geometry.setAttribute('instanceOpacity', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances are spread out; the base geometry's bounds mean nothing
    mesh.renderOrder = 5;
    return mesh;
  }

  /** Projectile: a small low-poly ball. Swap this method (and render.vfx.projectile) to change the look, e.g. bubbles. */
  projectiles(cap) {
    return this.#instanced(new THREE.SphereGeometry(0.5, 10, 8), this.#material('projectile', THREE.FrontSide), cap);
  }

  /** Sparks for trails, block bursts and death pops: tiny cubes, like loose pixels of the art. */
  particles(cap) {
    return this.#instanced(new THREE.BoxGeometry(1, 1, 1), this.#material('particle', THREE.FrontSide), cap);
  }

  /** The flat white a block turns for a moment when a projectile hits it. */
  flashMaterial() {
    let material = this._materials.get('flash');
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this._materials.set('flash', material);
    }
    return material;
  }

  dispose() {
    for (const material of this._materials.values()) material.dispose();
    for (const geometry of this._geometries) geometry.dispose();
    this._materials.clear();
    this._geometries = [];
  }
}
