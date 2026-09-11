import { OverlayBase } from './OverlayBase.js';
import { OverlayAction } from './OverlayController.js';

/**
 * The settings panel (pause): "PAUSED", then Resume, Restart level and the Sound toggle, one button width and gap apart
 * (ui.overlays.pause.buttonsY). It slides up and fades in, and back down and out, like the v3 settings. While it is up
 * the game is frozen; the HUD settings button stays above its dim, highlighted (UIManager raises it), and closes it
 * again, as Escape does.
 */
export class SettingsPanel extends OverlayBase {
  constructor(deps) {
    super({ ...deps, kind: 'pause' });
    const { text } = this.config.ui;
    const [resumeY, restartY, soundY] = this.o.pause.buttonsY;
    this.root.setAttribute('aria-label', text.pauseTitle);
    this.title(text.pauseTitle, this.o.titleY);
    this.button(text.resume, OverlayAction.RESUME, resumeY);
    this.button(text.restartLevel, OverlayAction.RESTART, restartY);
    this.sound = this.button(text.soundOn, OverlayAction.SOUND, soundY);
  }

  /** "Sound: on" / "Sound: off"; hidden when there is no sound preference. */
  setSound(on, available = true) {
    const { text } = this.config.ui;
    this.sound.hidden = !available;
    this.setButtonLabel(this.sound, on ? text.soundOn : text.soundOff);
  }

  enterAnimations() {
    return this.enter({ slide: true, easing: this.config.ui.anim.overshoot });
  }

  hide() {
    return super.hide({ slide: true });
  }
}
