/**
 * Fixed-capacity slot pool (pure, allocation-free after construction). Callers keep their per-item data in parallel
 * typed arrays indexed by slot. When every slot is taken, acquire() recycles the OLDEST active slot and reports it
 * through onRecycle(slot) first, so the caller can finish or drop that item.
 *
 * Iterate active slots without closures: for (let i = pool.count - 1; i >= 0; i -= 1) { const slot = pool.active[i]; }
 * (backwards, so release() inside the loop is safe: it swaps the last active slot into position i).
 */
export class Pool {
  /** @param {number} capacity  @param {(slot: number) => void} [onRecycle] */
  constructor(capacity, onRecycle = null) {
    if (!(capacity > 0)) throw new RangeError('Pool: capacity must be > 0');
    this.capacity = capacity;
    this.onRecycle = onRecycle;
    /** Dense list of active slots; valid entries are active[0 .. count - 1]. */
    this.active = new Int32Array(capacity);
    this.count = 0;
    this.recycled = 0;
    this._where = new Int32Array(capacity).fill(-1); // slot -> index in `active`, -1 when free
    this._free = new Int32Array(capacity);
    this._freeCount = capacity;
    this._stamp = new Float64Array(capacity);
    this._clock = 0;
    for (let i = 0; i < capacity; i += 1) this._free[i] = capacity - 1 - i; // pop order 0, 1, 2, ...
  }

  /** Take a slot; recycles the oldest active one at capacity. @returns {number} slot */
  acquire() {
    let slot;
    if (this._freeCount > 0) {
      this._freeCount -= 1;
      slot = this._free[this._freeCount];
    } else {
      slot = this.oldest();
      this.recycled += 1;
      if (this.onRecycle) this.onRecycle(slot);
      this.release(slot);
      this._freeCount -= 1; // release() just pushed it back; take it again
    }
    this._where[slot] = this.count;
    this.active[this.count] = slot;
    this.count += 1;
    this._clock += 1;
    this._stamp[slot] = this._clock;
    return slot;
  }

  /** Give a slot back (no-op when it is already free). */
  release(slot) {
    const at = this._where[slot];
    if (at < 0) return;
    const last = this.active[this.count - 1];
    this.active[at] = last;
    this._where[last] = at;
    this.count -= 1;
    this._where[slot] = -1;
    this._free[this._freeCount] = slot;
    this._freeCount += 1;
  }

  isActive(slot) {
    return this._where[slot] >= 0;
  }

  /** The active slot acquired longest ago, or -1 when none is active. */
  oldest() {
    let best = -1;
    let bestStamp = Infinity;
    for (let i = 0; i < this.count; i += 1) {
      const slot = this.active[i];
      if (this._stamp[slot] < bestStamp) {
        bestStamp = this._stamp[slot];
        best = slot;
      }
    }
    return best;
  }

  /** Free every slot. */
  clear() {
    while (this.count > 0) this.release(this.active[this.count - 1]);
  }
}
