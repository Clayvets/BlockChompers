/** App screens above the game. */
export const AppState = Object.freeze({ MENU: 'menu', PLAYING: 'playing' });

/** Why a flow command was refused (`reason` in its result). */
export const FlowReason = Object.freeze({ NOT_IN_MENU: 'not-in-menu' });

/**
 * App flow state machine, pure (no three, no DOM, no clock): MENU (start screen, the simulation does not run) ->
 * PLAYING. There is no way back to MENU: "Play again" after the last level is a game command that stays in PLAYING.
 * main.js advances the simulation only through update(), so nothing can step while the start screen is up.
 */
export class AppFlow {
  #state = AppState.MENU;

  /** @param {{ game: { update(dtSeconds: number): void, restartLevel(): object } }} deps */
  constructor({ game }) {
    this.game = game;
  }

  get state() {
    return this.#state;
  }

  get playing() {
    return this.#state === AppState.PLAYING;
  }

  /**
   * Start screen "Play": MENU -> PLAYING, and the progression's current level (Level 1: the flow only leaves MENU
   * once) loads from scratch, which emits LEVEL_LOADED.
   * @returns {{ ok: boolean, reason?: string }}
   */
  play() {
    if (this.#state !== AppState.MENU) return { ok: false, reason: FlowReason.NOT_IN_MENU };
    this.#state = AppState.PLAYING;
    this.game.restartLevel();
    return { ok: true };
  }

  /** Advance the simulation by dtSeconds, only while PLAYING. @returns {boolean} whether it ran */
  update(dtSeconds) {
    if (this.#state !== AppState.PLAYING) return false;
    this.game.update(dtSeconds);
    return true;
  }
}
