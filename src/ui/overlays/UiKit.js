import { Cues } from '../../app/Cues.js';

const PRESS_KEYS = new Set(['Enter', ' ']);

/**
 * The DOM helpers every UI piece shares (UIManager and the overlays): elements, buttons with the v3 press juice, and
 * Web Animations on transform and opacity (Config.ui.anim). Presentation only; it keeps no game state.
 */
export class UiKit {
  /** @param {{ doc: Document, config: object, cues?: import('../../app/Cues.js').CueBus | null }} deps */
  constructor({ doc, config, cues = null }) {
    this.doc = doc;
    this.config = config;
    this.cues = cues;
  }

  make(tag, className, textContent) {
    const node = this.doc.createElement(tag);
    node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  }

  /**
   * A real <button> with the v3 press: a squash on pointerdown (or Enter / Space) and a bounce back on release, transform
   * only; `tap` sends the TAP cue on press. Enter and Space activate it as they do any button.
   */
  button(className, label, onClick, tap = true) {
    const button = this.make('button', className, label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    const a = this.config.ui.anim;
    const press = () => {
      if (button.disabled) return;
      if (tap) this.cue(Cues.TAP);
      this.animate(button, [{ transform: 'scale(1)' }, { transform: `scale(${a.buttonDownScale})` }], a.buttonDownMs, 'ease-out');
    };
    const release = () => this.animate(button, [{ transform: `scale(${a.buttonDownScale})` }, { transform: 'scale(1)' }], a.buttonUpMs, a.overshoot);
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', (e) => {
      if (e.buttons) release();
    });
    button.addEventListener('keydown', (e) => {
      if (PRESS_KEYS.has(e.key) && !e.repeat) press();
    });
    button.addEventListener('keyup', (e) => {
      if (PRESS_KEYS.has(e.key)) release();
    });
    return button;
  }

  /**
   * Web Animations helper (transform and opacity only). `replace` cancels the element's running animations first;
   * `timing` adds options (e.g. a loop).
   * @returns {Animation | null}
   */
  animate(el, keyframes, duration, easing, delay = 0, replace = true, timing = null) {
    if (!el || typeof el.animate !== 'function') return null;
    if (replace) for (const running of el.getAnimations()) running.cancel();
    return el.animate(keyframes, { duration, easing, delay, fill: 'both', ...timing });
  }

  /** Resolves when every animation has finished (or was cancelled); at once when there are none. */
  settled(animations) {
    const list = animations.filter(Boolean).map((anim) => anim.finished.catch(() => {}));
    return Promise.all(list).then(() => {});
  }

  cue(type) {
    if (this.cues) this.cues.emit(type);
  }
}
