import { ease } from './easing.js';
import { Pool } from './Pool.js';

/**
 * Tiny tween scheduler (pure: no three, no DOM, no clock). It animates a numeric property, target[key], from `from` to
 * `to` over durationMs after delayMs, with a named easing. Driven by update(dtMs), so it follows whatever clock the
 * caller feeds it (pause = dt 0, debug time scale = scaled dt).
 *
 * Allocation-free while running: records are preallocated, start() takes positional arguments (no options object),
 * and update() creates no closures. At capacity the oldest tween is finished at once (jumps to `to`) and reused.
 */
export class TweenScheduler {
  /** @param {number} [capacity] */
  constructor(capacity = 128) {
    this._records = Array.from({ length: capacity }, () => ({
      id: 0, target: null, key: '', from: 0, to: 0, duration: 0, delay: 0, elapsed: 0, easing: 'linear', onComplete: null,
    }));
    this._pool = new Pool(capacity, (slot) => this._finish(slot));
    this._nextId = 1;
  }

  /** Number of running tweens. */
  get activeCount() {
    return this._pool.count;
  }

  /**
   * Start a tween; target[key] is set to `from` at once (so staggered items hold their start value while they wait).
   * @returns {number} id for cancel()
   */
  start(target, key, from, to, durationMs, delayMs = 0, easing = 'linear', onComplete = null) {
    const slot = this._pool.acquire();
    const r = this._records[slot];
    r.id = this._nextId;
    this._nextId += 1;
    r.target = target;
    r.key = key;
    r.from = from;
    r.to = to;
    r.duration = Math.max(0, durationMs);
    r.delay = Math.max(0, delayMs);
    r.elapsed = 0;
    r.easing = easing;
    r.onComplete = onComplete;
    target[key] = from;
    return r.id;
  }

  /**
   * The same tween on several targets, each starting staggerMs after the previous one (after delayMs).
   * @returns {number} how many were started
   */
  stagger(targets, key, from, to, durationMs, staggerMs, easing = 'linear', delayMs = 0) {
    for (let i = 0; i < targets.length; i += 1) this.start(targets[i], key, from, to, durationMs, delayMs + i * staggerMs, easing);
    return targets.length;
  }

  /** Stop a tween where it is (no onComplete). @returns {boolean} whether it was running */
  cancel(id) {
    for (let i = this._pool.count - 1; i >= 0; i -= 1) {
      const slot = this._pool.active[i];
      if (this._records[slot].id === id) {
        this._drop(slot);
        return true;
      }
    }
    return false;
  }

  /** Stop every tween on a target, optionally only one key. @returns {number} how many stopped */
  cancelTarget(target, key = null) {
    let stopped = 0;
    for (let i = this._pool.count - 1; i >= 0; i -= 1) {
      const slot = this._pool.active[i];
      const r = this._records[slot];
      if (r.target === target && (key === null || r.key === key)) {
        this._drop(slot);
        stopped += 1;
      }
    }
    return stopped;
  }

  isActive(id) {
    for (let i = 0; i < this._pool.count; i += 1) if (this._records[this._pool.active[i]].id === id) return true;
    return false;
  }

  /** Advance every tween by dtMs; finished ones land exactly on `to` and call onComplete(target, key). */
  update(dtMs) {
    for (let i = this._pool.count - 1; i >= 0; i -= 1) {
      const slot = this._pool.active[i];
      const r = this._records[slot];
      r.elapsed += dtMs;
      const t = r.elapsed - r.delay;
      if (t < 0) continue;
      if (r.duration === 0 || t >= r.duration) {
        this._finish(slot);
        this._pool.release(slot);
        continue;
      }
      r.target[r.key] = r.from + (r.to - r.from) * ease(r.easing, t / r.duration);
    }
  }

  /** Drop everything without completing. */
  clear() {
    for (let i = this._pool.count - 1; i >= 0; i -= 1) this._drop(this._pool.active[i]);
  }

  _finish(slot) {
    const r = this._records[slot];
    r.target[r.key] = r.easing === 'punch' ? r.from : r.to;
    const done = r.onComplete;
    const { target, key } = r;
    r.target = null;
    r.onComplete = null;
    if (done) done(target, key);
  }

  _drop(slot) {
    const r = this._records[slot];
    r.target = null;
    r.onComplete = null;
    this._pool.release(slot);
  }
}
