/**
 * Presentation cues: moments the player sees or does, which are not game events (the game's own events stay on the
 * core EventBus). The UI emits the actions, the Renderer the visual moments; the AudioManager plays sounds for them.
 */
export const Cues = Object.freeze({
  /** A button was pressed (not the Play button). */
  TAP: 'tap',
  /** An overlay (start screen, settings, win or lose card) starts entering / leaving. */
  OVERLAY_IN: 'overlay-in',
  OVERLAY_OUT: 'overlay-out',
  /** The start screen's Play button was clicked (inside the click: audio may start here). */
  PLAY: 'play',
  /** The win card appeared (with the confetti) / the lose card appeared. */
  WIN: 'win',
  LOSE: 'lose',
  /** The money counter showed a new number while counting up. */
  COIN: 'coin',
  /** A projectile landed: the block starts breaking (visual impact, after the logic event). */
  BLOCK_BREAK: 'block-break',
  /** A unit's capacity number dropped (to 1 or more). */
  CAPACITY_TICK: 'capacity-tick',
  /** A unit at capacity 0 starts its death pop. */
  UNIT_POP: 'unit-pop',
  /** A returning unit finished its glide into its slot. */
  UNIT_PARKED: 'unit-parked',
  /** The "N/5" counter reached 0. */
  SLOTS_EMPTY: 'slots-empty',
});

/**
 * Tiny pub/sub for cues. Unlike the core EventBus, emit() allocates nothing, because cues fire from inside the render
 * loop: listener lists are copied on subscribe and unsubscribe instead (both happen only at wiring time), so a
 * listener may still unsubscribe during an emit.
 */
export class CueBus {
  /** @type {Map<string, Function[]>} */
  #listeners = new Map();

  /** @returns {() => void} unsubscribe */
  on(type, handler) {
    if (typeof handler !== 'function') throw new TypeError('CueBus.on: handler must be a function');
    this.#listeners.set(type, [...(this.#listeners.get(type) || []), handler]);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    const list = this.#listeners.get(type);
    if (!list) return;
    const next = list.filter((h) => h !== handler);
    if (next.length) this.#listeners.set(type, next);
    else this.#listeners.delete(type);
  }

  emit(type, payload) {
    const list = this.#listeners.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i += 1) list[i](payload);
  }

  clear() {
    this.#listeners.clear();
  }
}
