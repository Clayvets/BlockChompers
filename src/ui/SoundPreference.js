/**
 * The player's "Sound: on / off" choice (presentation state, never game state). main.js starts it from
 * Config.render.audio.muted and the AudioManager subscribes (off mutes the master gain); the settings panel toggles it.
 */
export class SoundPreference {
  #listeners = new Set();

  constructor(on = true) {
    this.on = Boolean(on);
  }

  set(on) {
    const next = Boolean(on);
    if (next === this.on) return;
    this.on = next;
    for (const listener of this.#listeners) listener(this.on);
  }

  toggle() {
    this.set(!this.on);
  }

  /** Call `listener(on)` now and on every change. @returns {() => void} unsubscribe */
  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.on);
    return () => this.#listeners.delete(listener);
  }
}
