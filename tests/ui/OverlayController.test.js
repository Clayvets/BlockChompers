import { describe, it, expect } from 'vitest';
import { OverlayController, OverlayState, OverlayAction as A, OverlayCommand as C } from '../../src/ui/overlays/OverlayController.js';

/** A controller with `state` up and entered (its buttons work). */
function shown(state) {
  const c = new OverlayController();
  expect(c.open(state)).toBe(true);
  c.entered();
  return c;
}

describe('OverlayController', () => {
  it('starts with nothing up and lets the board take input', () => {
    const c = new OverlayController();
    expect(c.state).toBe(OverlayState.NONE);
    expect(c.blocksInput()).toBe(false);
    expect(c.raised()).toBe(null);
  });

  it('opens the settings panel from the HUD button over a running level, sending PAUSE at once', () => {
    const c = new OverlayController();
    expect(c.press(A.SETTINGS, { playing: true })).toEqual({ command: C.PAUSE, opens: OverlayState.PAUSE });
    expect(c.state).toBe(OverlayState.PAUSE);
    expect(c.busy).toBe(true);
    expect(c.blocksInput()).toBe(true);
    expect(c.raised()).toBe('settings');
  });

  it('keeps the settings panel shut when the level is not running', () => {
    const c = new OverlayController();
    expect(c.settingsEnabled(false)).toBe(false);
    expect(c.press(A.SETTINGS, { playing: false })).toBe(null);
    expect(c.state).toBe(OverlayState.NONE);
  });

  it('shows one overlay at a time: no result over the settings, no settings over a result', () => {
    const paused = shown(OverlayState.PAUSE);
    expect(paused.open(OverlayState.WIN)).toBe(false);
    expect(paused.open(OverlayState.LOSE)).toBe(false);
    for (const result of [OverlayState.WIN, OverlayState.LOSE]) {
      const c = shown(result);
      expect(c.open(OverlayState.PAUSE)).toBe(false);
      expect(c.settingsEnabled(true)).toBe(false);
      expect(c.press(A.SETTINGS)).toBe(null);
      expect(c.press(A.ESCAPE)).toBe(null);
      expect(c.state).toBe(result);
      expect(c.raised()).toBe('coins');
    }
  });

  it('ignores every press while its overlay enters or leaves', () => {
    const c = new OverlayController();
    c.open(OverlayState.PAUSE);
    expect(c.press(A.RESUME)).toBe(null); // still entering
    expect(c.press(A.SOUND)).toBe(null);
    expect(c.settingsEnabled(true)).toBe(false);
    c.entered();
    expect(c.press(A.RESUME)).toEqual({ command: C.RESUME, closes: true });
    expect(c.press(A.RESTART)).toBe(null); // leaving
    expect(c.press(A.SETTINGS)).toBe(null);
    c.entered(); // a late enter callback does not re-enable a leaving overlay
    expect(c.busy).toBe(true);
    expect(c.open(OverlayState.WIN)).toBe(false);
  });

  it('maps each button to its command; a closing one runs after the exit animation', () => {
    const cases = [
      [OverlayState.PAUSE, A.RESUME, C.RESUME],
      [OverlayState.PAUSE, A.SETTINGS, C.RESUME], // the HUD button again
      [OverlayState.PAUSE, A.ESCAPE, C.RESUME],
      [OverlayState.PAUSE, A.RESTART, C.RESTART_LEVEL],
      [OverlayState.WIN, A.CONTINUE, C.CONTINUE],
      [OverlayState.LOSE, A.RETRY, C.RESTART_LEVEL],
    ];
    for (const [state, action, command] of cases) {
      const c = shown(state);
      expect(c.press(action)).toEqual({ command, closes: true });
      expect(c.state).toBe(state); // still shown while it leaves
      expect(c.closed()).toBe(command);
      expect(c.state).toBe(OverlayState.NONE);
      expect(c.blocksInput()).toBe(false);
      expect(c.closed()).toBe(null); // sent once
    }
  });

  it('toggles the sound at once and keeps the settings panel open', () => {
    const c = shown(OverlayState.PAUSE);
    expect(c.press(A.SOUND)).toEqual({ command: C.TOGGLE_SOUND });
    expect(c.state).toBe(OverlayState.PAUSE);
    expect(c.busy).toBe(false);
  });

  it("ignores buttons that do not belong to the overlay that is up", () => {
    expect(shown(OverlayState.WIN).press(A.RETRY)).toBe(null);
    expect(shown(OverlayState.LOSE).press(A.CONTINUE)).toBe(null);
    expect(shown(OverlayState.PAUSE).press(A.CONTINUE)).toBe(null);
    expect(new OverlayController().press(A.RESUME)).toBe(null);
  });

  it('opens a result once the settings panel has closed', () => {
    const c = shown(OverlayState.PAUSE);
    c.press(A.RESUME);
    c.closed();
    expect(c.open(OverlayState.WIN)).toBe(true);
  });

  it('drops whatever is up when a level loads underneath', () => {
    const c = shown(OverlayState.LOSE);
    c.press(A.RETRY);
    c.reset();
    expect(c.state).toBe(OverlayState.NONE);
    expect(c.busy).toBe(false);
    expect(c.closed()).toBe(null);
  });

  it('labels the win button Play again only after the last level of the cycle', () => {
    expect(OverlayController.winLabelKey(true)).toBe('playAgain');
    expect(OverlayController.winLabelKey(false)).toBe('continue');
  });
});
