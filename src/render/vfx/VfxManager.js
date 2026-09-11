import * as THREE from 'three';
import { Events } from '../../core/Events.js';
import { ease } from '../anim/easing.js';
import { Pool } from '../anim/Pool.js';

// Scratch objects, reused every frame: the update loop allocates nothing.
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _tip = new THREE.Vector3();
const _hit = new THREE.Vector3();

/**
 * Board effects, presentation only (they never touch game state):
 *   BLOCK_CONSUMED -> the unit fires: muzzle pop on the triangle, and a projectile with a fading trail flies from its
 *                     tip to the block. On the VISUAL impact (not the logic event) the block flashes white, squashes,
 *                     shrinks away and bursts into a few sparks of its colour.
 *   UNIT_DIED      -> sparks where the triangle pops (the Renderer squashes and shrinks the mesh itself)
 *   LEVEL_LOADED   -> everything cleared (restart or next level)
 * Time is update(dtMs) from the Renderer's presentation clock: 0 while paused, scaled by debug.timeScale.
 *
 * The host (the Renderer) lends what effects need: takeBlockMesh, cellWorld, unitTip, paletteColor, cellSize,
 * unitFired, unitDied. Projectiles and sparks are one InstancedMesh each (VfxFactory), refilled from Pool slots every
 * frame; when a cap is reached the oldest instance is recycled (a recycled projectile lands at once).
 */
export class VfxManager {
  constructor({ config, factory, host }) {
    this.config = config;
    this.host = host;
    this.reduced = false;
    this.clock = 0;
    const v = config.render.vfx;
    this.projectileMesh = factory.projectiles(v.maxProjectiles);
    this.particleMesh = factory.particles(v.maxParticles);
    this._flash = factory.flashMaterial();
    this._lastCounts = [0, 0];

    const P = v.maxProjectiles;
    this._proj = new Pool(P, (slot) => this.#impact(slot));
    this._pStart = new Float32Array(P * 3);
    this._pEnd = new Float32Array(P * 3);
    this._pPos = new Float32Array(P * 3);
    this._pColor = new Float32Array(P * 3);
    this._pT0 = new Float64Array(P);
    this._pTrail = new Float64Array(P);
    this._pScale = new Float32Array(P);
    this._pBlock = new Array(P).fill(null);

    this._dying = new Pool(P, (slot) => this.#finishDying(slot));
    this._dT0 = new Float64Array(P);
    this._dBase = new Float32Array(P);
    this._dMesh = new Array(P).fill(null);
    this._dMaterial = new Array(P).fill(null);

    const N = v.maxParticles;
    this._part = new Pool(N);
    this._x = new Float32Array(N);
    this._y = new Float32Array(N);
    this._z = new Float32Array(N);
    this._vx = new Float32Array(N);
    this._vz = new Float32Array(N);
    this._g = new Float32Array(N);
    this._size = new Float32Array(N);
    this._life = new Float32Array(N);
    this._t0 = new Float64Array(N);
    this._rgb = new Float32Array(N * 3);
  }

  /** Add the effect meshes to a scene (once; they outlive levels). */
  attach(parent) {
    parent.add(this.projectileMesh, this.particleMesh);
  }

  /** @returns {() => void} unbind */
  bindEvents(eventBus) {
    const offs = [
      eventBus.on(Events.BLOCK_CONSUMED, (e) => this.#fire(e)),
      eventBus.on(Events.UNIT_DIED, (e) => this.#death(e)),
      eventBus.on(Events.LEVEL_LOADED, () => this.clear()),
    ];
    return () => offs.forEach((off) => off());
  }

  setReduced(reduced) {
    this.reduced = Boolean(reduced);
  }

  /** Active instances, for the debug panel. */
  stats() {
    return { projectiles: this._proj.count, particles: this._part.count, blocks: this._dying.count };
  }

  #count(n) {
    return this.reduced ? Math.max(1, Math.round(n * this.config.render.vfx.reducedScale)) : n;
  }

  #fire({ unitId, row, col, color }) {
    const { projectile } = this.config.render.vfx;
    if (!this.host.unitTip(unitId, _tip)) return; // no mesh yet: the renderer removes the block as usual
    const block = this.host.takeBlockMesh(row, col);
    if (block) _hit.copy(block.position);
    else this.host.cellWorld(row, col, _hit);
    const slot = this._proj.acquire();
    const i = slot * 3;
    this._pStart[i] = _tip.x; this._pStart[i + 1] = projectile.height; this._pStart[i + 2] = _tip.z;
    this._pEnd[i] = _hit.x; this._pEnd[i + 1] = projectile.height; this._pEnd[i + 2] = _hit.z;
    this._pPos[i] = _tip.x; this._pPos[i + 1] = projectile.height; this._pPos[i + 2] = _tip.z;
    this.host.paletteColor(color, _c);
    this._pColor[i] = _c.r; this._pColor[i + 1] = _c.g; this._pColor[i + 2] = _c.b;
    this._pT0[slot] = this.clock;
    this._pTrail[slot] = this.clock;
    this._pScale[slot] = this.host.cellSize();
    this._pBlock[slot] = block;
    this.host.unitFired(unitId);
  }

  #death({ unitId }) {
    const color = this.host.unitDied(unitId, _hit);
    if (!(color > 0)) return;
    const { death, burst } = this.config.render.vfx;
    this.host.paletteColor(color, _c);
    const scale = this.config.render.layout.unitSize * 0.5;
    this.#burst(_hit.x, burst.height, _hit.z, this.#count(death.burstCount), _c.r, _c.g, _c.b, scale);
  }

  /** The projectile in `slot` lands: sparks, and the block starts its flash / squash / shrink. */
  #impact(slot) {
    const i = slot * 3;
    const { blockBurstCount, vfx } = this.config.render;
    this.#burst(this._pEnd[i], vfx.burst.height, this._pEnd[i + 2], this.#count(blockBurstCount),
      this._pColor[i], this._pColor[i + 1], this._pColor[i + 2], this._pScale[slot]);
    const block = this._pBlock[slot];
    this._pBlock[slot] = null;
    if (!block) return;
    const d = this._dying.acquire();
    this._dMesh[d] = block;
    this._dMaterial[d] = block.material;
    this._dBase[d] = block.scale.x;
    this._dT0[d] = this.clock;
    block.material = this._flash;
  }

  #finishDying(slot) {
    const mesh = this._dMesh[slot];
    if (mesh) {
      mesh.material = this._dMaterial[slot];
      if (mesh.parent) mesh.parent.remove(mesh);
    }
    this._dMesh[slot] = null;
    this._dMaterial[slot] = null;
  }

  /** `count` sparks bursting out of (x, z) on the ground plane; speed and size in units of `scale` (world units). */
  #burst(x, y, z, count, r, g, b, scale) {
    const { burst } = this.config.render.vfx;
    for (let n = 0; n < count; n += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = burst.speed * scale * (0.45 + 0.55 * Math.random());
      // Kick them up the screen a little so the pull down the screen reads as a small arc.
      this.#spawn(x, y, z, Math.cos(angle) * speed, Math.sin(angle) * speed - burst.speed * scale * 0.35,
        burst.gravity * scale, burst.lifeMs * (0.7 + 0.3 * Math.random()), burst.size * scale * (0.7 + 0.6 * Math.random()), r, g, b);
    }
  }

  #spawn(x, y, z, vx, vz, gravity, lifeMs, size, r, g, b) {
    const s = this._part.acquire();
    this._x[s] = x; this._y[s] = y; this._z[s] = z;
    this._vx[s] = vx; this._vz[s] = vz; this._g[s] = gravity;
    this._life[s] = lifeMs; this._size[s] = size; this._t0[s] = this.clock;
    this._rgb[s * 3] = r; this._rgb[s * 3 + 1] = g; this._rgb[s * 3 + 2] = b;
  }

  /** Advance every effect by dtMs of presentation time and upload the instance buffers once. */
  update(dtMs) {
    this.clock += dtMs;
    const dt = dtMs / 1000;
    const { projectileTravelMs, projectileEasing, vfx } = this.config.render;
    const { projectile, impact } = vfx;

    for (let k = this._proj.count - 1; k >= 0; k -= 1) {
      const slot = this._proj.active[k];
      const i = slot * 3;
      const p = (this.clock - this._pT0[slot]) / projectileTravelMs;
      if (p >= 1) {
        this.#impact(slot);
        this._proj.release(slot);
        continue;
      }
      const e = ease(projectileEasing, p);
      for (let a = 0; a < 3; a += 1) this._pPos[i + a] = this._pStart[i + a] + (this._pEnd[i + a] - this._pStart[i + a]) * e;
      if (this.clock - this._pTrail[slot] >= projectile.trailEveryMs) {
        this._pTrail[slot] = this.clock;
        this.#spawn(this._pPos[i], this._pPos[i + 1] - 0.05, this._pPos[i + 2], 0, 0, 0, projectile.trailLifeMs,
          projectile.size * projectile.trailSize, this._pColor[i], this._pColor[i + 1], this._pColor[i + 2]);
      }
    }

    for (let k = this._dying.count - 1; k >= 0; k -= 1) {
      const slot = this._dying.active[k];
      const mesh = this._dMesh[slot];
      const base = this._dBase[slot];
      const t = this.clock - this._dT0[slot];
      if (t >= impact.flashMs && mesh.material === this._flash) mesh.material = this._dMaterial[slot];
      if (t >= impact.squashMs + impact.shrinkMs) {
        this.#finishDying(slot);
        this._dying.release(slot);
        continue;
      }
      let xz;
      let y;
      if (t < impact.squashMs) {
        const e = ease('easeOutQuad', t / impact.squashMs);
        xz = 1 + (impact.stretchXZ - 1) * e;
        y = 1 + (impact.squashY - 1) * e;
      } else {
        const f = Math.max(0, 1 - ease('easeInBack', (t - impact.squashMs) / impact.shrinkMs));
        xz = impact.stretchXZ * f;
        y = impact.squashY * f;
      }
      mesh.scale.set(base * xz, base * y, base * xz);
    }

    for (let k = this._part.count - 1; k >= 0; k -= 1) {
      const s = this._part.active[k];
      if (this.clock - this._t0[s] >= this._life[s]) {
        this._part.release(s);
        continue;
      }
      this._vz[s] += this._g[s] * dt;
      this._x[s] += this._vx[s] * dt;
      this._z[s] += this._vz[s] * dt;
    }

    this.#write();
  }

  /** Copy active slots into the instanced meshes; flag the buffers once. */
  #write() {
    const pm = this.projectileMesh;
    const size = this.config.render.vfx.projectile.size;
    const pOpacity = pm.geometry.attributes.instanceOpacity;
    _q.identity();
    for (let k = 0; k < this._proj.count; k += 1) {
      const slot = this._proj.active[k];
      const i = slot * 3;
      _p.set(this._pPos[i], this._pPos[i + 1], this._pPos[i + 2]);
      _s.set(size, size, size);
      pm.setMatrixAt(k, _m.compose(_p, _q, _s));
      pm.setColorAt(k, _c.setRGB(this._pColor[i], this._pColor[i + 1], this._pColor[i + 2]));
      pOpacity.array[k] = 1;
    }
    this.#flag(pm, pOpacity, this._proj.count, 0);

    const qm = this.particleMesh;
    const qOpacity = qm.geometry.attributes.instanceOpacity;
    for (let k = 0; k < this._part.count; k += 1) {
      const s = this._part.active[k];
      const u = (this.clock - this._t0[s]) / this._life[s];
      const scale = this._size[s] * (1 - 0.6 * u);
      _p.set(this._x[s], this._y[s], this._z[s]);
      _s.set(scale, scale, scale);
      qm.setMatrixAt(k, _m.compose(_p, _q, _s));
      qm.setColorAt(k, _c.setRGB(this._rgb[s * 3], this._rgb[s * 3 + 1], this._rgb[s * 3 + 2]));
      qOpacity.array[k] = 1 - u * u;
    }
    this.#flag(qm, qOpacity, this._part.count, 1);
  }

  #flag(mesh, opacity, count, which) {
    if (count === 0 && this._lastCounts[which] === 0) return;
    this._lastCounts[which] = count;
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    opacity.needsUpdate = true;
  }

  /** Drop every effect; blocks caught mid-flight or mid-destruction leave the scene with them. */
  clear() {
    for (let k = this._proj.count - 1; k >= 0; k -= 1) {
      const slot = this._proj.active[k];
      const block = this._pBlock[slot];
      if (block && block.parent) block.parent.remove(block);
      this._pBlock[slot] = null;
    }
    this._proj.clear();
    for (let k = this._dying.count - 1; k >= 0; k -= 1) this.#finishDying(this._dying.active[k]);
    this._dying.clear();
    this._part.clear();
    this.#write();
  }

  dispose() {
    this.clear();
    this.projectileMesh.removeFromParent();
    this.particleMesh.removeFromParent();
  }
}
