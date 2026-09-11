import { computeOverlayLayout, panelPoint } from '../layout/computeOverlayLayout.js';

const px = (value) => `${value}px`;

/**
 * A styled overlay (Config.ui.overlays): the dim over the game and the HUD, which takes every tap under it and does
 * nothing with them; the glass panel (CSS only: gradient, border, inset shadows; no backdrop-filter); and what the
 * subclass puts on it: a title, maybe a subtitle and art, and the green pill buttons. Each subclass (SettingsPanel,
 * WinOverlay, LoseOverlay) builds its own markup; this class only knows the pieces.
 *
 * layout(frame) places everything from the design frame (layout/computeOverlayLayout.js; lengths are artboard px x
 * scale). show(data) plays the enter animation and resolves once it is in; hide() plays the exit and resolves once it
 * is gone; dismiss() hides at once. Buttons send their OverlayAction through onAction; UIManager disables them while
 * the overlay animates (setEnabled). Idle loops (the coin's bob, the bubble's float) run only while it is shown.
 */
export class OverlayBase {
  /**
   * @param {{ kit: import('./UiKit.js').UiKit, config: object, art: { button: HTMLImageElement },
   *           onAction: (action: string) => void, kind: string, effects?: { reduced: boolean } | null }} deps
   */
  constructor({ kit, config, art, onAction, kind, effects = null }) {
    this.kit = kit;
    this.config = config;
    this.o = config.ui.overlays;
    this.art = art;
    this.onAction = onAction;
    this.effects = effects;
    this.root = kit.make('div', `ov-root ov-${kind}`);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.panel = kit.make('div', 'ov-panel');
    /** Children are placed from the panel's outer top-left corner (the content box spans the border too). */
    this.content = kit.make('div', 'ov-content');
    this.panel.append(this.content);
    this.root.append(this.panel);
    this.buttons = [];
    this.texts = [];
    this.boxes = [];
    this.layoutFrame = null;
    this.layoutState = null;
    this.idle = [];
  }

  // ---- pieces --------------------------------------------------------------------------------------------------

  /** A title: gradient letters over their own outline layer (stroke behind the letters, which keep their full weight). */
  title(text, y) {
    const el = this.kit.make('h2', 'ov-text ov-title');
    const outline = this.kit.make('span', 'ov-title-outline', text);
    const fill = this.kit.make('span', 'ov-title-fill', text);
    fill.setAttribute('aria-hidden', 'true');
    el.append(outline, fill);
    this.#addText(el, outline, y, this.o.typography.title.size);
    return el;
  }

  /** A one-line text in a named style (subtitle, reward): flat fill, outline behind the letters, soft shadow. */
  text(style, text, y) {
    const el = this.kit.make('p', `ov-text ov-${style}`);
    const span = this.kit.make('span', 'ov-line', text);
    el.append(span);
    this.#addText(el, span, y, this.o.typography[style].size);
    return el;
  }

  #addText(el, measure, y, size) {
    this.content.append(el);
    this.texts.push({ el, measure, y, size });
  }

  /** Change a text's words (and re-fit it). */
  setText(el, text) {
    const entry = this.texts.find((t) => t.el === el);
    for (const span of el.children) span.textContent = text;
    if (entry && this.layoutState) this.#fitText(entry);
  }

  /** A green pill button (the Play button's pill and label) whose centre is `y` artboard px down. */
  button(label, action, y) {
    const button = this.kit.button('ov-button', '', () => this.onAction(action));
    button.style.backgroundImage = `url("${this.art.button.src}")`;
    const span = this.kit.make('span', 'ov-button-label', label);
    button.append(span);
    button.disabled = true;
    button.dataset.y = String(y);
    this.content.append(button);
    this.buttons.push(button);
    return button;
  }

  setButtonLabel(button, label) {
    button.firstChild.textContent = label;
    if (this.layoutState) this.#fitButton(button);
  }

  /**
   * An art box: `place` (its rect: centre x, y and width in artboard px, height from `aspect`) > an idle-loop layer >
   * whatever the subclass puts in. The outer box takes the entrance animation, the inner one the idle loop: each layer
   * owns one transform.
   */
  artBox(rect, aspect) {
    const box = this.kit.make('div', 'ov-art');
    const loop = this.kit.make('div', 'ov-idle');
    box.append(loop);
    this.content.append(box);
    this.boxes.push({ box, rect, aspect });
    return { box, loop };
  }

  // ---- layout ---------------------------------------------------------------------------------------------------

  /** Place the panel and everything on it for this design frame (Renderer.screenFrame()). */
  layout(frame) {
    if (!frame) return;
    this.layoutFrame = frame;
    const layout = computeOverlayLayout(frame, this.o);
    this.layoutState = layout;
    const { panel } = layout;
    Object.assign(this.panel.style, { left: px(panel.x), top: px(panel.y), width: px(panel.width), height: px(panel.height) });
    this.root.style.setProperty('--ov-s', String(layout.scale));
    for (const entry of this.texts) {
      const size = entry.size * layout.scale;
      entry.el.dataset.fontSize = String(size);
      entry.el.style.top = px(panelPoint(layout, this.o.panel, entry.y).y - this.o.typography.capCenter * size);
      this.#fitText(entry);
    }
    for (const button of this.buttons) this.#fitButton(button);
    for (const { box, rect: { x, y, width }, aspect } of this.boxes) {
      const centre = panelPoint(layout, this.o.panel, y, x);
      const w = width * layout.scale;
      const h = w / aspect;
      Object.assign(box.style, { left: px(centre.x - w / 2), top: px(centre.y - h / 2), width: px(w), height: px(h) });
    }
  }

  /** A text at its size, shrunk to typography.maxWidth x the panel when its words are wider. */
  #fitText({ el, measure }) {
    const base = Number(el.dataset.fontSize);
    if (!base) return;
    el.style.fontSize = px(base);
    const room = this.o.typography.maxWidth * this.layoutState.panel.width;
    const need = measure.offsetWidth;
    if (need > room && room > 0) el.style.fontSize = px((base * room) / need);
  }

  /** A button at button.width, its label the Play button's size (labelSize x height), shrunk to fit labelMaxWidth. */
  #fitButton(button) {
    const layout = this.layoutState;
    const { width, labelMaxWidth } = this.o.button;
    const w = width * layout.scale;
    const h = w / (this.art.button.naturalWidth / this.art.button.naturalHeight);
    const centre = panelPoint(layout, this.o.panel, Number(button.dataset.y));
    Object.assign(button.style, { left: px(centre.x - w / 2), top: px(centre.y - h / 2), width: px(w), height: px(h) });
    const base = this.config.ui.startScreen.playButton.labelSize * h;
    button.style.fontSize = px(base);
    const need = button.firstChild.offsetWidth;
    const room = labelMaxWidth * w;
    if (need > room && room > 0) button.style.fontSize = px((base * room) / need);
  }

  // ---- showing ------------------------------------------------------------------------------------------------

  get reduced() {
    return Boolean(this.effects && this.effects.reduced);
  }

  /** Fill the overlay for this showing (the reward, a label); subclasses override. */
  fill() {}

  /** What enters one after another once the panel is in (titles, art, buttons); subclasses override. */
  items() {
    return [...this.texts.map((t) => t.el), ...this.buttons];
  }

  /**
   * The panel's entrance: from `fromScale` with `easing`, or sliding up by the settings shift (`slide`), with the dim
   * fading in; then the items one after another. Resolves once all of it is in.
   */
  enter({ fromScale = 1, easing, slide = false } = {}) {
    const a = this.config.ui.anim;
    const k = this.kit;
    const panelFrom = slide ? `translateY(${a.settingsShift}px)` : `scale(${fromScale})`;
    const panelMs = slide ? a.settingsInMs : a.cardInMs;
    const anims = [
      k.animate(this.root, [{ opacity: 0 }, { opacity: 1 }], slide ? a.settingsInMs : a.backdropInMs, a.soft),
      k.animate(this.panel, [{ transform: panelFrom, opacity: 0 }, { transform: 'none', opacity: 1 }], panelMs, easing),
    ];
    this.items().forEach((el, i) => {
      anims.push(k.animate(el, [{ transform: `translateY(${a.itemShift}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
        a.itemInMs, a.overshoot, panelMs * 0.35 + i * a.itemStaggerMs));
    });
    return anims;
  }

  /** Show it: fill(data), place it, play the entrance (subclass: enterAnimations). Resolves once it is in. */
  show(data) {
    this.fill(data);
    this.root.hidden = false;
    this.layout(this.layoutFrame);
    this.setEnabled(false);
    return this.kit.settled(this.enterAnimations()).then(() => {
      if (!this.root.hidden) this.startIdle();
    });
  }

  enterAnimations() {
    return this.enter();
  }

  /** Idle loops while it is shown (subclasses: the coin's bob, the bubble's float). */
  startIdle() {}

  /** An endless back-and-forth on `el` (transform only), stopped when the overlay leaves. Off with reduced effects. */
  loop(el, keyframes, periodMs) {
    if (this.reduced) return;
    const anim = this.kit.animate(el, keyframes, periodMs / 2, 'ease-in-out', 0, true, { direction: 'alternate', iterations: Infinity });
    if (anim) this.idle.push(anim);
  }

  #stopIdle() {
    for (const anim of this.idle) anim.cancel();
    this.idle.length = 0;
  }

  /** The panel shrinks and fades with the dim (or slides down, for the settings); resolves once it is gone. */
  hide({ slide = false } = {}) {
    const a = this.config.ui.anim;
    const k = this.kit;
    this.setEnabled(false);
    this.#stopIdle();
    const panelTo = slide ? `translateY(${a.settingsShift}px)` : 'scale(0.85)';
    const anims = [
      k.animate(this.panel, [{ transform: 'none', opacity: 1 }, { transform: panelTo, opacity: 0 }], slide ? a.settingsOutMs : a.cardOutMs, a.exit),
      k.animate(this.root, [{ opacity: 1 }, { opacity: 0 }], slide ? a.settingsOutMs : a.backdropOutMs, a.exit),
    ];
    return k.settled(anims).then(() => this.dismiss());
  }

  /** Gone at once (a level loaded underneath, or the exit finished). */
  dismiss() {
    this.#stopIdle();
    this.setEnabled(false);
    this.root.hidden = true;
  }

  /** Buttons work only while the overlay is in (never while it enters or leaves). */
  setEnabled(enabled) {
    for (const button of this.buttons) button.disabled = !enabled;
  }

  /** The first button takes the keyboard focus (Enter / Space activate it). */
  focus() {
    if (this.buttons[0]) this.buttons[0].focus();
  }
}
