import * as THREE from 'three';
import { Pool } from '../anim/Pool.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Win confetti, drawn on its own transparent canvas ABOVE the DOM, so it rains over the win card. One InstancedMesh of
 * flat rectangles (VfxFactory.confetti) in the level palette; they burst from the bottom corners, flip, sway, fall and
 * fade. Units are CSS pixels (y down on screen). Presentation only: burst() / stop() come from the UI's win overlay,
 * and update(dtMs) from the frame loop. While nothing flies it does not render at all (0 draw calls).
 */
export class ConfettiLayer {
  constructor({ canvas, config, factory }) {
    this.canvas = canvas;
    this.config = config;
    this.reduced = false;
    this.clock = 0;
    const cap = config.render.vfx.maxConfetti;
    this.mesh = factory.confetti(cap);
    this._pool = new Pool(cap);
    this._x = new Float32Array(cap); this._y = new Float32Array(cap);
    this._vx = new Float32Array(cap); this._vy = new Float32Array(cap);
    this._rx = new Float32Array(cap); this._ry = new Float32Array(cap); this._rz = new Float32Array(cap);
    this._wx = new Float32Array(cap); this._wy = new Float32Array(cap); this._wz = new Float32Array(cap);
    this._w = new Float32Array(cap); this._h = new Float32Array(cap);
    this._t0 = new Float64Array(cap); this._life = new Float32Array(cap); this._phase = new Float32Array(cap);
    this._rgb = new Float32Array(cap * 3);
    this._stopAt = -1;
    this._dirty = false;
    this._size = { width: 1, height: 1 };
  }

  init() {
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    this.gl.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -100, 100);
    this.scene.add(this.mesh);
  }

  resize(width, height) {
    this._size = { width: Math.max(1, width), height: Math.max(1, height) };
    if (!this.gl) return;
    this.gl.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, this.config.render.pixelRatioMax));
    this.gl.setSize(this._size.width, this._size.height);
    Object.assign(this.camera, { left: 0, right: this._size.width, top: 0, bottom: -this._size.height });
    this.camera.updateProjectionMatrix();
    this._dirty = true;
  }

  setReduced(reduced) {
    this.reduced = Boolean(reduced);
  }

  get active() {
    return this._pool.count;
  }

  /** Fire a burst in these colours (hex numbers) from both bottom corners. */
  burst(colors) {
    const c = this.config.render.vfx.confetti;
    const count = this.reduced ? Math.max(1, Math.round(c.count * this.config.render.vfx.reducedScale)) : c.count;
    const { width, height } = this._size;
    this._stopAt = -1;
    for (let n = 0; n < count; n += 1) {
      const left = n % 2 === 0;
      const s = this._pool.acquire();
      // Up and in from the corner: -60 deg from the left corner, -120 deg from the right one, +- spread.
      const angle = (left ? -Math.PI / 3 : (-2 * Math.PI) / 3) + (Math.random() * 2 - 1) * c.spread;
      const speed = c.speed * (1 - c.speedJitter + 2 * c.speedJitter * Math.random());
      this._x[s] = left ? 0 : width;
      this._y[s] = height + 10;
      this._vx[s] = Math.cos(angle) * speed;
      this._vy[s] = Math.sin(angle) * speed;
      this._rx[s] = Math.random() * Math.PI; this._ry[s] = Math.random() * Math.PI; this._rz[s] = Math.random() * Math.PI;
      this._wx[s] = (Math.random() * 2 - 1) * c.spin; this._wy[s] = (Math.random() * 2 - 1) * c.spin; this._wz[s] = (Math.random() * 2 - 1) * c.spin;
      this._w[s] = c.width * (0.8 + 0.4 * Math.random());
      this._h[s] = c.height * (0.8 + 0.4 * Math.random());
      this._t0[s] = this.clock;
      this._life[s] = c.durationMs * (0.7 + 0.3 * Math.random());
      this._phase[s] = Math.random() * Math.PI * 2;
      _c.setHex(colors[n % colors.length]);
      this._rgb[s * 3] = _c.r; this._rgb[s * 3 + 1] = _c.g; this._rgb[s * 3 + 2] = _c.b;
    }
    this._dirty = true;
  }

  /** Fade everything out quickly (the win overlay closed). */
  stop() {
    if (this._pool.count > 0) this._stopAt = this.clock;
  }

  /** Drop everything at once (level change, teardown). */
  clear() {
    this._pool.clear();
    this._stopAt = -1;
    this._dirty = true;
  }

  update(dtMs) {
    this.clock += dtMs;
    const dt = dtMs / 1000;
    const c = this.config.render.vfx.confetti;
    const stopping = this._stopAt >= 0;
    const stopFade = stopping ? Math.max(0, 1 - (this.clock - this._stopAt) / c.stopFadeMs) : 1;
    if (stopping && stopFade === 0) this._pool.clear();
    const opacity = this.mesh.geometry.attributes.instanceOpacity;
    for (let k = this._pool.count - 1; k >= 0; k -= 1) {
      const s = this._pool.active[k];
      const age = this.clock - this._t0[s];
      if (age >= this._life[s]) {
        this._pool.release(s);
        continue;
      }
      const drag = Math.max(0, 1 - c.drag * dt);
      this._vx[s] *= drag;
      this._vy[s] = this._vy[s] * drag + c.gravity * dt;
      this._x[s] += this._vx[s] * dt;
      this._y[s] += this._vy[s] * dt;
      this._rx[s] += this._wx[s] * dt; this._ry[s] += this._wy[s] * dt; this._rz[s] += this._wz[s] * dt;
    }
    for (let k = 0; k < this._pool.count; k += 1) {
      const s = this._pool.active[k];
      const age = this.clock - this._t0[s];
      const sway = Math.sin(this._phase[s] + age * 0.004) * c.sway;
      _p.set(this._x[s] + sway, -this._y[s], 0);
      _q.setFromEuler(_e.set(this._rx[s], this._ry[s], this._rz[s]));
      _s.set(this._w[s], this._h[s], 1);
      this.mesh.setMatrixAt(k, _m.compose(_p, _q, _s));
      this.mesh.setColorAt(k, _c.setRGB(this._rgb[s * 3], this._rgb[s * 3 + 1], this._rgb[s * 3 + 2]));
      opacity.array[k] = Math.min(1, (this._life[s] - age) / c.fadeMs) * stopFade;
    }
    const count = this._pool.count;
    if (count === 0 && this.mesh.count === 0 && !this._dirty) return; // idle: nothing to draw, no draw calls
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    opacity.needsUpdate = true;
    if (count === 0) this._stopAt = -1;
    if (this.gl) this.gl.render(this.scene, this.camera);
    this._dirty = false;
  }

  /** Draw calls of the last rendered frame (0 while idle). */
  stats() {
    return { confetti: this._pool.count, calls: this._pool.count > 0 && this.gl ? this.gl.info.render.calls : 0 };
  }

  dispose() {
    this.clear();
    if (this.gl) this.gl.dispose();
    this.gl = null;
  }
}
