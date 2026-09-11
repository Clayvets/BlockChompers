import { OverlayAction, OverlayController } from './OverlayController.js';

/**
 * The flat v3 overlays (Config.ui colors / sizes / anim), used when the styled overlays' images did not load: a card on
 * a dim with a title and plain buttons, one container per overlay. The settings card slides up and fades in; a result
 * card pops in (softer for a loss, whose title shakes) with its items one after another. It has OverlayBase's
 * interface, so UIManager and the OverlayController drive both alike.
 */
export class FlatOverlay {
  /**
   * @param {{ kit: import('./UiKit.js').UiKit, config: object, onAction: (action: string) => void,
   *           kind: 'pause' | 'win' | 'lose', effects?: { reduced: boolean } | null }} deps
   */
  constructor({ kit, config, onAction, kind, effects = null }) {
    this.kit = kit;
    this.config = config;
    this.kind = kind;
    this.effects = effects;
    const { text } = config.ui;
    const specs = {
      pause: [text.paused, [['button', text.resume, OverlayAction.RESUME], ['button button-secondary', text.restartLevel, OverlayAction.RESTART],
        ['button button-secondary', text.soundOn, OverlayAction.SOUND]]],
      win: [text.won, [['button', text.continue, OverlayAction.CONTINUE]]],
      lose: [text.lost, [['button', text.retry, OverlayAction.RETRY]]],
    };
    const [titleText, buttons] = specs[kind];
    this.root = kit.make('div', 'modal');
    this.root.hidden = true;
    if (kind !== 'pause') this.root.dataset.result = kind === 'win' ? 'won' : 'lost';
    this.card = kit.make('div', 'card');
    this.title = kit.make('h2', 'card-title', titleText);
    this.buttons = buttons.map(([className, label, action]) => kit.button(className, label, () => onAction(action)));
    this.card.append(this.title);
    if (kind === 'win') {
      this.reward = kit.make('div', 'card-reward');
      this.card.append(this.reward);
    }
    this.card.append(...this.buttons);
    this.root.append(this.card);
  }

  layout() {}

  fill(data) {
    if (this.kind !== 'win' || !data) return;
    this.reward.textContent = `+${data.reward}`;
    this.buttons[0].textContent = this.config.ui.text[OverlayController.winLabelKey(data.isLastLevel)];
  }

  setSound(on, available = true) {
    const button = this.buttons[2];
    if (!button) return;
    const { text } = this.config.ui;
    button.hidden = !available;
    button.textContent = on ? text.soundOn : text.soundOff;
  }

  show(data) {
    const a = this.config.ui.anim;
    const k = this.kit;
    this.fill(data);
    this.root.hidden = false;
    this.setEnabled(false);
    if (this.kind === 'pause') {
      return k.settled([
        k.animate(this.root, [{ opacity: 0 }, { opacity: 1 }], a.settingsInMs, a.soft),
        k.animate(this.card, [{ transform: `translateY(${a.settingsShift}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], a.settingsInMs, a.overshoot),
      ]);
    }
    const won = this.kind === 'win';
    const items = won ? [this.title, this.reward, this.buttons[0]] : [this.title, this.buttons[0]];
    const anims = [
      k.animate(this.root, [{ opacity: 0 }, { opacity: 1 }], a.backdropInMs, a.soft),
      k.animate(this.card, [{ transform: `scale(${won ? a.cardFromScale : a.loseCardFromScale})`, opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
        a.cardInMs, won ? a.overshoot : a.soft),
      ...items.map((el, i) => k.animate(el, [{ transform: `translateY(${a.itemShift}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
        a.itemInMs, a.overshoot, a.cardInMs * 0.35 + i * a.itemStaggerMs)),
    ];
    if (!won && !(this.effects && this.effects.reduced)) {
      const p = a.shakePx;
      anims.push(k.animate(this.title, [0, -p, p, -p * 0.6, p * 0.6, -p * 0.25, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        a.shakeMs, 'ease-out', a.cardInMs * 0.35 + a.itemInMs, false));
    }
    return k.settled(anims);
  }

  hide() {
    const a = this.config.ui.anim;
    const k = this.kit;
    this.setEnabled(false);
    const pause = this.kind === 'pause';
    const cardTo = pause ? { transform: `translateY(${a.settingsShift}px)`, opacity: 0 } : { transform: 'scale(0.85)', opacity: 0 };
    return k.settled([
      k.animate(this.card, [{ transform: pause ? 'translateY(0)' : 'scale(1)', opacity: 1 }, cardTo], pause ? a.settingsOutMs : a.cardOutMs, a.exit),
      k.animate(this.root, [{ opacity: 1 }, { opacity: 0 }], pause ? a.settingsOutMs : a.backdropOutMs, a.exit),
    ]).then(() => this.dismiss());
  }

  dismiss() {
    this.setEnabled(false);
    this.root.hidden = true;
  }

  setEnabled(enabled) {
    for (const button of this.buttons) button.disabled = !enabled;
  }

  focus() {
    this.buttons[0].focus();
  }

  /** Where the reward's fly starts: the "+X" label's centre on screen. */
  flyFrom() {
    const r = this.reward.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
}
