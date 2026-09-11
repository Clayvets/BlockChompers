import { Events } from '../core/Events.js';

/**
 * DOM overlay (HUD, win/lose panel, restart). Reads snapshots for numbers, listens to
 * LEVEL_WON / LEVEL_LOST for the one-shot overlays. Never touches Three.js.
 */
export class UIManager {
  #unbind = null;
  #onRestart = null;

  /** @param {{ root: HTMLElement, eventBus: import('../core/EventBus.js').EventBus, gameManager: object }} deps */
  constructor({ root, eventBus, gameManager }) {
    this.root = root;
    this.eventBus = eventBus;
    this.gameManager = gameManager;
  }

  /** Build the HUD/overlay elements inside root and subscribe to LEVEL_WON / LEVEL_LOST. */
  mount() {
    // TODO(impl)
  }

  unmount() {
    // TODO(impl)
  }

  /** Per-frame HUD refresh: blocks remaining, slot statuses, phase. */
  update(snapshot) {
    // TODO(impl)
  }

  showWin() {
    // TODO(impl)
  }

  showLose(reason) {
    // TODO(impl)
  }

  hideOverlay() {
    // TODO(impl)
  }

  /** Register the restart callback (main.js passes () => game.reset()). */
  onRestart(callback) {
    this.#onRestart = callback;
  }
}
