import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Loads each GLB once and keeps it for the whole session (levels come and go; the cached scenes, geometries,
 * materials and textures stay). main.js awaits preload() before the start screen appears. A file that fails to load is
 * reported with a console error naming it and resolves to null, so the game still starts: StyledFactory then falls
 * back to the primitive for that model.
 */
export class AssetLoader {
  /** @type {Map<string, Promise<object | null>>} */
  #pending = new Map();
  /** @type {Map<string, object>} */
  #loaded = new Map();

  constructor({ loader = new GLTFLoader() } = {}) {
    this.loader = loader;
  }

  /** @param {string[]} urls @returns {Promise<Array<object | null>>} */
  preload(urls) {
    return Promise.all(urls.map((url) => this.load(url)));
  }

  /** @returns {Promise<object | null>} the parsed glTF ({ scene, animations, ... }), or null if it failed */
  load(url) {
    if (!this.#pending.has(url)) {
      const promise = this.loader.loadAsync(url).then(
        (gltf) => {
          prepare(gltf);
          this.#loaded.set(url, gltf);
          return gltf;
        },
        (error) => {
          console.error(`AssetLoader: could not load "${url}" (${error && error.message ? error.message : error}); using the primitive instead`);
          return null;
        },
      );
      this.#pending.set(url, promise);
    }
    return this.#pending.get(url);
  }

  /** The loaded glTF for `url`, or null if it is not loaded (or failed). */
  get(url) {
    return this.#loaded.get(url) || null;
  }

  /** Release every cached GPU resource (full teardown only, e.g. a hot reload). */
  dispose() {
    for (const gltf of this.#loaded.values()) {
      gltf.scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        for (const material of [].concat(object.material || [])) {
          for (const value of Object.values(material)) if (value && value.isTexture) value.dispose();
          material.dispose();
        }
      });
    }
    this.#loaded.clear();
    this.#pending.clear();
  }
}

/** Colour textures are sRGB (GLTFLoader already tags base colour and emissive maps; this makes it explicit). */
function prepare(gltf) {
  gltf.scene.traverse((object) => {
    for (const material of [].concat(object.material || [])) {
      if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
      if (material.emissiveMap) material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    }
  });
}
