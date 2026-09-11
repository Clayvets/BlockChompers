import { Pool } from '../anim/Pool.js';

/**
 * Win confetti, drawn on its own transparent canvas ABOVE the DOM (#canvas-fx), so it rains over the win overlay: flat
 * rectangles in the level palette that burst from the bottom corners, flip, sway, fall and fade. A 2D canvas (not a
 * second WebGL context) with a fixed Pool of render.vfx.maxConfetti pieces. Each piece is its rectangle turned in 3D
 * (rx, ry, rz, Euler XYZ) and seen straight on (orthographic): the canvas transform is the rotation matrix's x and y
 * rows, so it flips exactly as the WebGL quads did. Units are CSS px, y down. Presentation only: burst() / stop() come
 * from the UI's win overlay and update(dtMs) from the frame loop; it allocates nothing per frame (colours are strings
 * made at burst time) and, while nothing flies, does not touch the canvas.
 */
export class ConfettiLayer {
  constructor({ canvas, config }) {
    this.canvas = canvas;
    this.config = config;
    this.ctx = null;
    this.reduced = false;
    this.clock = 0;
    const cap = config.render.vfx.maxConfetti;
    this._pool = new Pool(cap);
    this._x = new Float32Array(cap); this._y = new Float32Array(cap);
    this._vx = new Float32Array(cap); this._vy = new Float32Array(cap);
    this._rx = new Float32Array(cap); this._ry = new Float32Array(cap); this._rz = new Float32Array(cap);
    this._wx = new Float32Array(cap); this._wy = new Float32Array(cap); this._wz = new Float32Array(cap);
    this._w = new Float32Array(cap); this._h = new Float32Array(cap);
    this._t0 = new Float64Array(cap); this._life = new Float32Array(cap); this._phase = new Float32Array(cap);
    this._fill = new Array(cap).fill('#ffffff');
    this._stopAt = -1;
    this._drawn = false;
    this._size = { width: 1, height: 1 };
    this._ratio = 1;
  }

  init() {
    this.ctx = this.canvas.getContext('2d');
  }

  resize(width, height) {
    this._size = { width: Math.max(1, width), height: Math.max(1, height) };
    this._ratio = Math.min(globalThis.devicePixelRatio || 1, this.config.render.pixelRatioMax);
    this.canvas.width = Math.round(this._size.width * this._ratio);
    this.canvas.height = Math.round(this._size.height * this._ratio);
    this._drawn = true; // resizing cleared it; redraw what flies on the next update
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
    const fills = colors.map((hex) => `#${hex.toString(16).padStart(6, '0')}`);
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
      this._fill[s] = fills[n % fills.length];
    }
  }

  /** Fade everything out quickly (the win overlay closed). */
  stop() {
    if (this._pool.count > 0) this._stopAt = this.clock;
  }

  /** Drop everything at once (level change, teardown). */
  clear() {
    this._pool.clear();
    this._stopAt = -1;
  }

  update(dtMs) {
    this.clock += dtMs;
    const dt = dtMs / 1000;
    const c = this.config.render.vfx.confetti;
    const stopping = this._stopAt >= 0;
    const stopFade = stopping ? Math.max(0, 1 - (this.clock - this._stopAt) / c.stopFadeMs) : 1;
    if (stopping && stopFade === 0) this._pool.clear();
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
    const count = this._pool.count;
    if (count === 0) this._stopAt = -1;
    const ctx = this.ctx;
    if (!ctx || (count === 0 && !this._drawn)) return; // idle: the canvas is already clear
    const r = this._ratio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let k = 0; k < count; k += 1) {
      const s = this._pool.active[k];
      const age = this.clock - this._t0[s];
      const sway = Math.sin(this._phase[s] + age * 0.004) * c.sway;
      // Rotation matrix of Euler XYZ, first two columns' x and y rows (a = cos x, b = sin x, ...). World y is up in the
      // quad's frame and down on screen, hence the minus on the y row.
      const a = Math.cos(this._rx[s]); const b = Math.sin(this._rx[s]);
      const cy = Math.cos(this._ry[s]); const d = Math.sin(this._ry[s]);
      const e = Math.cos(this._rz[s]); const f = Math.sin(this._rz[s]);
      const w = this._w[s] * r;
      const h = this._h[s] * r;
      ctx.setTransform(cy * e * w, -(a * f + b * e * d) * w, -cy * f * h, -(a * e - b * f * d) * h, (this._x[s] + sway) * r, this._y[s] * r);
      ctx.globalAlpha = Math.min(1, (this._life[s] - age) / c.fadeMs) * stopFade;
      ctx.fillStyle = this._fill[s];
      ctx.fillRect(-0.5, -0.5, 1, 1);
    }
    ctx.globalAlpha = 1;
    this._drawn = count > 0;
  }

  /** Pieces in flight; confetti costs no WebGL draw calls. */
  stats() {
    return { confetti: this._pool.count, calls: 0 };
  }

  dispose() {
    this.clear();
    if (this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.ctx = null;
  }
}
