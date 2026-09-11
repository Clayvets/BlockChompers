/**
 * Minimal synchronous pub/sub. Framework-free so it can be used in core and in tests.
 * Handlers run in registration order; a handler may unsubscribe itself (or others) mid-emit.
 */
export class EventBus {
  /** @type {Map<string, Set<Function>>} */
  #listeners = new Map();

  /**
   * @param {string} type
   * @param {(payload: any) => void} handler
   * @returns {() => void} unsubscribe
   */
  on(type, handler) {
    if (typeof handler !== 'function') throw new TypeError('EventBus.on: handler must be a function');
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  /** Like on(), but the handler is removed after its first call. */
  once(type, handler) {
    const wrapper = (payload) => {
      this.off(type, wrapper);
      handler(payload);
    };
    return this.on(type, wrapper);
  }

  off(type, handler) {
    const set = this.#listeners.get(type);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.#listeners.delete(type);
  }

  /** Invokes every handler registered for `type`, in registration order. */
  emit(type, payload) {
    const set = this.#listeners.get(type);
    if (!set) return;
    for (const handler of [...set]) handler(payload);
  }

  /** Removes every handler (level reset / teardown). */
  clear() {
    this.#listeners.clear();
  }
}
