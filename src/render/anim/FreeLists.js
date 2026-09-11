/**
 * Reusable items kept per key (pure): take(key, create) returns a free item made for that key, or a new one from
 * create(); give(key, item) puts it back for the next taker. Nothing is dropped before clear(), so an item that is
 * expensive to rebuild is made once per concurrent use and then reused. The Renderer's unit fades use it for their
 * transparent materials: three.js destroys a shader program with the last material using it, so disposing a fade's
 * material after every fade meant compiling the program again for the next one.
 */
export class FreeLists {
  constructor() {
    this._free = new Map();
    this._all = [];
  }

  /**
   * @template T
   * @param {*} key
   * @param {() => T} create  called only when no item for `key` is free
   * @returns {T}
   */
  take(key, create) {
    const free = this._free.get(key);
    if (free && free.length > 0) return free.pop();
    const item = create();
    this._all.push(item);
    return item;
  }

  /** Put an item taken for `key` back. */
  give(key, item) {
    let free = this._free.get(key);
    if (!free) {
      free = [];
      this._free.set(key, free);
    }
    free.push(item);
  }

  /** How many items were ever made (taken or free). */
  get size() {
    return this._all.length;
  }

  /** Hand every item ever made to `dispose` once, then forget them all. */
  clear(dispose) {
    for (const item of this._all) dispose(item);
    this._all.length = 0;
    this._free.clear();
  }
}
