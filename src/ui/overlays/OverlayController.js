/** Which overlay is up: nothing, the settings panel (the game is paused), or a level result. */
export const OverlayState = Object.freeze({ NONE: 'none', PAUSE: 'pause', WIN: 'win', LOSE: 'lose' });

/** What the player did: an overlay button, the HUD settings button or the Escape key. */
export const OverlayAction = Object.freeze({
  RESUME: 'resume',
  RESTART: 'restart',
  SOUND: 'sound',
  CONTINUE: 'continue',
  RETRY: 'retry',
  SETTINGS: 'settings',
  ESCAPE: 'escape',
});

/** What UIManager sends: GameManager command names, plus the settings' own sound toggle. */
export const OverlayCommand = Object.freeze({
  PAUSE: 'pause',
  RESUME: 'resume',
  RESTART_LEVEL: 'restartLevel',
  CONTINUE: 'continueToNextLevel',
  TOGGLE_SOUND: 'toggleSound',
});

const { NONE, PAUSE, WIN, LOSE } = OverlayState;
const A = OverlayAction;
const C = OverlayCommand;

/** The actions that close each overlay, and the command sent once its exit animation has finished. */
const CLOSING = Object.freeze({
  [PAUSE]: Object.freeze({ [A.RESUME]: C.RESUME, [A.SETTINGS]: C.RESUME, [A.ESCAPE]: C.RESUME, [A.RESTART]: C.RESTART_LEVEL }),
  [WIN]: Object.freeze({ [A.CONTINUE]: C.CONTINUE }),
  [LOSE]: Object.freeze({ [A.RETRY]: C.RESTART_LEVEL }),
});

/** The HUD piece kept above an overlay's backdrop: the settings button over the pause panel, the coins over a result. */
const RAISED = Object.freeze({ [NONE]: null, [PAUSE]: 'settings', [WIN]: 'coins', [LOSE]: 'coins' });

/**
 * The overlays' state machine (pure: no DOM, no timers; tests/ui/OverlayController.test.js). One overlay at a time:
 * the settings panel opens only over a running level with nothing else up (never during a result), and a result only
 * when nothing is up. An overlay is busy from open() until entered(), and from the press that closes it until closed():
 * meanwhile every press does nothing and nothing else opens. A closing press's command runs after the exit animation
 * (closed() hands it back); the sound toggle acts at once and keeps the panel open. PAUSE is sent when the panel opens,
 * so the simulation freezes at once.
 *
 * UIManager renders the state (which overlay, which HUD piece stays above the backdrop, the win button's label) and
 * sends the commands; it keeps no overlay state of its own.
 */
export class OverlayController {
  constructor() {
    this.state = NONE;
    this.busy = false;
    this.closing = false;
    this.pending = null;
  }

  /** The board takes no input while an overlay is up or animating. */
  blocksInput() {
    return this.state !== NONE || this.busy;
  }

  /** The HUD settings button works to open the panel over a running level, or to close it once it is in. */
  settingsEnabled(playing) {
    if (this.state === PAUSE) return !this.busy;
    return this.state === NONE && !this.busy && playing;
  }

  /** @returns {'settings' | 'coins' | null} the HUD piece drawn above the current overlay's backdrop */
  raised() {
    return RAISED[this.state];
  }

  /**
   * Show PAUSE, WIN or LOSE. PAUSE needs a running level. Refused while anything is up or animating.
   * @param {string} state OverlayState
   * @param {{ playing?: boolean }} [context]
   * @returns {boolean} opened (it is busy until entered())
   */
  open(state, { playing = true } = {}) {
    if (this.state !== NONE || this.busy || !CLOSING[state]) return false;
    if (state === PAUSE && !playing) return false;
    this.state = state;
    this.busy = true;
    this.closing = false;
    this.pending = null;
    return true;
  }

  /** The enter animation finished: the overlay's buttons work. */
  entered() {
    if (!this.closing) this.busy = false;
  }

  /**
   * A player action.
   * @param {string} action OverlayAction
   * @param {{ playing?: boolean }} [context] whether the level is running (the settings button opens the panel then)
   * @returns {{ command: string, opens?: string, closes?: boolean } | null} what to do; null when it does nothing.
   *   opens: the overlay just opened (send the command now); closes: play the exit, then closed() gives the command.
   *   Neither: send the command now and stay (the sound toggle).
   */
  press(action, { playing = true } = {}) {
    if (this.state === NONE) {
      if (action === A.SETTINGS && this.open(PAUSE, { playing })) return { command: C.PAUSE, opens: PAUSE };
      return null;
    }
    if (this.busy) return null;
    if (this.state === PAUSE && action === A.SOUND) return { command: C.TOGGLE_SOUND };
    const command = CLOSING[this.state][action];
    if (!command) return null;
    this.busy = true;
    this.closing = true;
    this.pending = command;
    return { command, closes: true };
  }

  /** The exit animation finished: nothing is up. @returns {string | null} the command to send now */
  closed() {
    const command = this.pending;
    this.state = NONE;
    this.busy = false;
    this.closing = false;
    this.pending = null;
    return command;
  }

  /** A new level loaded (restart, next level, Play): whatever was up is gone, with no command. */
  reset() {
    this.closed();
  }

  /** The win button's label (ui.text key): "Play again" after the last level of the cycle, whose next level is Level 1. */
  static winLabelKey(isLastLevel) {
    return isLastLevel ? 'playAgain' : 'continue';
  }
}
