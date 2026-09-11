/** Values of the "Effects" setting. */
export const EffectsMode = Object.freeze({ FULL: 'full', REDUCED: 'reduced' });

/**
 * The player's "Effects: full / reduced" choice (presentation state, never game state). Reduced lowers particle and
 * confetti counts and removes shakes. main.js starts it from prefers-reduced-motion; the settings panel toggles it;
 * the renderer, the confetti layer and the UI subscribe.
 */
export class EffectsPreference {
  #listeners = new Set();

  constructor(mode = EffectsMode.FULL) {
    this.mode = mode === EffectsMode.REDUCED ? EffectsMode.REDUCED : EffectsMode.FULL;
  }

  get reduced() {
    return this.mode === EffectsMode.REDUCED;
  }

  set(mode) {
    const next = mode === EffectsMode.REDUCED ? EffectsMode.REDUCED : EffectsMode.FULL;
    if (next === this.mode) return;
    this.mode = next;
    for (const listener of this.#listeners) listener(this.reduced);
  }

  toggle() {
    this.set(this.reduced ? EffectsMode.FULL : EffectsMode.REDUCED);
  }

  /** Call `listener(reduced)` now and on every change. @returns {() => void} unsubscribe */
  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.reduced);
    return () => this.#listeners.delete(listener);
  }
}
