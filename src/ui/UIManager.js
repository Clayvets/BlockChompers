import { Events } from '../core/Events.js';
import { GamePhase } from '../core/GameManager.js';
import { TweenScheduler } from '../render/anim/TweenScheduler.js';

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const now = () => globalThis.performance.now();

/**
 * Flat DOM UI (plain elements, solid colours, system font; no images, icon fonts or dependencies), with juice:
 *   bar      -- settings button, "Level N", money. Slides in at every level start; the level label swaps with a
 *               slide; the money counts up with a punch when the "+$X" reward label lands on it.
 *   settings -- panel shown while paused (Resume, Restart level, Effects toggle); slides and fades in and out.
 *   result   -- win card ("Congratulations!", "+$X", Continue / Play again) or lose card ("Out of space", Retry).
 *               Backdrop fades in, the card pops in with overshoot (softer for a loss, whose title shakes), and the
 *               items enter with a stagger. A button plays the exit animation first and only then sends its command.
 *   buttons  -- squash on pointerdown, bounce back on release.
 *
 * Animations use the Web Animations API on transform and opacity only; times, distances and easings come from
 * Config.ui.anim. UIManager keeps no game state: update(snapshot, dtMs) renders it and clicks become GameManager
 * commands. isAnimating() is true while an overlay enters or leaves, so main.js keeps the board's input off.
 * hooks.onWinShown / hooks.onResultClosed let main.js start and stop the win confetti.
 */
export class UIManager {
  #els = null;
  #unbind = null;
  #timer = null;
  #resultKind = null;
  #shown = {};
  #tweens = new TweenScheduler(16);
  #money = { value: 0 };
  #flyLandsAt = 0;
  #busy = 0;
  #closing = false;
  #settingsOpen = false;

  /**
   * @param {{ root: HTMLElement, eventBus: object, gameManager: object, config?: object,
   *           effects?: import('./EffectsPreference.js').EffectsPreference, hooks?: { onWinShown?: Function, onResultClosed?: Function } }} deps
   */
  constructor({ root, eventBus, gameManager, config = gameManager.config, effects = null, hooks = {} }) {
    this.root = root;
    this.eventBus = eventBus;
    this.gameManager = gameManager;
    this.config = config;
    this.effects = effects;
    this.hooks = hooks;
  }

  /** True while an overlay is entering or leaving: the board takes no input then. */
  isAnimating() {
    return this.#busy > 0 || this.#closing;
  }

  /** Build the bar, the two modals and the flying reward label inside root; subscribe to the level events. */
  mount() {
    if (this.#els) return;
    const { text } = this.config.ui;
    this.#publishTokens();

    const bar = this.#make('div', 'bar');
    const settingsButton = this.#button('icon-button', '', () => this.gameManager.pause());
    settingsButton.title = text.settings;
    settingsButton.setAttribute('aria-label', text.settings);
    for (let i = 0; i < 3; i += 1) settingsButton.append(this.#make('span', 'icon-bar'));
    const levelLabel = this.#make('div', 'bar-level');
    const moneyLabel = this.#make('div', 'bar-money');
    bar.append(settingsButton, levelLabel, moneyLabel);

    const settings = this.#modal(text.paused, [
      ['button', text.resume, () => this.gameManager.resume()],
      ['button button-secondary', text.restartLevel, () => this.gameManager.restartLevel()],
      ['button button-secondary', '', () => this.#toggleEffects()],
    ]);
    const result = this.#modal('', [['button', '', () => this.#onResultAction()]]);
    const reward = this.#make('div', 'card-reward');
    result.title.after(reward);
    result.reward = reward;
    const fly = this.#make('div', 'fly-label');
    fly.hidden = true;

    this.root.append(bar, settings.root, result.root, fly);
    this.#els = { bar, settingsButton, levelLabel, moneyLabel, settings, result, fly };
    this.#shown = {};
    this.#renderEffectsLabel();

    const offs = [
      this.eventBus.on(Events.LEVEL_WON, () => this.#schedule('won')),
      this.eventBus.on(Events.LEVEL_LOST, () => this.#schedule('lost')),
      this.eventBus.on(Events.LEVEL_LOADED, () => this.#onLevelLoaded()),
    ];
    this.#unbind = () => offs.forEach((off) => off());
  }

  unmount() {
    if (this.#unbind) this.#unbind();
    this.#unbind = null;
    this.hideResult();
    this.#tweens.clear();
    if (this.#els) {
      const { bar, settings, result, fly } = this.#els;
      for (const el of [bar, settings.root, result.root, fly]) el.remove();
    }
    this.#els = null;
  }

  /** Per-frame render from the snapshot; touches the DOM only when a shown value changed. dtMs drives the tweens. */
  update(snapshot, dtMs = 1000 / 60) {
    if (!this.#els || !snapshot) return;
    const { text } = this.config.ui;
    const { levelLabel, settingsButton } = this.#els;
    const { levelNumber, money } = snapshot.progress;
    if (this.#shown.levelNumber === undefined) {
      levelLabel.textContent = `${text.level} ${levelNumber}`;
      this.#shown.levelNumber = levelNumber;
    } else if (this.#changed('levelNumber', levelNumber)) {
      this.#swapLevelLabel(`${text.level} ${levelNumber}`);
    }
    if (this.#shown.moneyTarget === undefined) {
      this.#shown.moneyTarget = money;
      this.#money.value = money;
    } else if (this.#changed('moneyTarget', money)) {
      this.#countMoneyTo(money);
    }
    this.#tweens.update(dtMs);
    const shownMoney = Math.round(this.#money.value);
    if (this.#changed('money', shownMoney)) this.#els.moneyLabel.textContent = `${text.currency}${shownMoney}`;
    if (snapshot.paused !== this.#settingsOpen) this.#setSettingsOpen(snapshot.paused);
    const playing = snapshot.phase === GamePhase.PLAYING;
    if (this.#changed('playing', playing)) settingsButton.disabled = !playing;
  }

  /** Every level start (next level, restart, retry): the bar slides in. */
  #onLevelLoaded() {
    this.hideResult();
    const a = this.config.ui.anim;
    this.#animate(this.#els.bar, [{ transform: 'translateY(-110%)' }, { transform: 'translateY(0)' }], a.hudInMs, a.overshoot);
  }

  #swapLevelLabel(label) {
    const a = this.config.ui.anim;
    const el = this.#els.levelLabel;
    const out = this.#animate(el, [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-a.labelShift}px)`, opacity: 0 }], a.labelOutMs, a.exit);
    const enter = () => {
      el.textContent = label;
      this.#animate(el, [{ transform: `translateY(${a.labelShift}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], a.labelInMs, a.overshoot);
    };
    if (out) out.finished.then(enter, enter);
    else enter();
  }

  /** Count the shown money up to `target` once the flying reward lands, then punch the counter. */
  #countMoneyTo(target) {
    const a = this.config.ui.anim;
    const delay = Math.max(0, this.#flyLandsAt - now());
    this.#tweens.cancelTarget(this.#money);
    this.#tweens.start(this.#money, 'value', this.#money.value, target, a.countUpMs, delay, 'easeOutQuad');
    const el = this.#els.moneyLabel;
    this.#animate(el, [{ transform: 'scale(1)' }, { transform: `scale(${a.moneyPunchScale})`, offset: 0.3 }, { transform: 'scale(1)' }],
      a.moneyPunchMs, a.overshoot, delay);
  }

  #setSettingsOpen(open) {
    this.#settingsOpen = open;
    const { root, card, buttons } = this.#els.settings;
    const a = this.config.ui.anim;
    if (open) {
      root.hidden = false;
      this.#animate(root, [{ opacity: 0 }, { opacity: 1 }], a.settingsInMs, a.soft, 0, true);
      this.#animate(card, [{ transform: `translateY(${a.settingsShift}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
        a.settingsInMs, a.overshoot, 0, true);
      buttons[0].focus();
      return;
    }
    this.#animate(card, [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${a.settingsShift}px)`, opacity: 0 }], a.settingsOutMs, a.exit, 0, true);
    const fade = this.#animate(root, [{ opacity: 1 }, { opacity: 0 }], a.settingsOutMs, a.exit, 0, true);
    const hide = () => {
      if (!this.#settingsOpen) root.hidden = true;
    };
    if (fade) fade.finished.then(hide, hide);
    else hide();
  }

  #toggleEffects() {
    if (this.effects) this.effects.toggle();
    this.#renderEffectsLabel();
  }

  #renderEffectsLabel() {
    const { text } = this.config.ui;
    const button = this.#els.settings.buttons[2];
    button.hidden = !this.effects;
    button.textContent = this.effects && this.effects.reduced ? text.effectsReduced : text.effectsFull;
  }

  /** Win card: title, the reward, and Continue (or Play again on the last level of the cycle). */
  showWin() {
    const { text } = this.config.ui;
    const { reward, isLastLevel } = this.gameManager.getSnapshot().progress;
    this.#els.result.reward.textContent = `+${text.currency}${reward}`;
    this.#els.result.reward.hidden = false;
    this.#showResult('won', text.won, isLastLevel ? text.playAgain : text.continue);
    if (this.hooks.onWinShown) this.hooks.onWinShown();
  }

  /** Lose card, the same for every loss reason. */
  showLose() {
    const { text } = this.config.ui;
    this.#els.result.reward.hidden = true;
    this.#showResult('lost', text.lost, text.retry);
  }

  hideResult() {
    clearTimeout(this.#timer);
    this.#timer = null;
    const wasShown = this.#resultKind !== null;
    this.#resultKind = null;
    this.#closing = false;
    if (this.#els) this.#els.result.root.hidden = true;
    if (wasShown && this.hooks.onResultClosed) this.hooks.onResultClosed();
  }

  #schedule(kind) {
    const { winOverlayDelay, loseOverlayDelay } = this.config.ui.timing;
    clearTimeout(this.#timer);
    const delay = (kind === 'won' ? winOverlayDelay : loseOverlayDelay) * 1000;
    this.#timer = setTimeout(() => (kind === 'won' ? this.showWin() : this.showLose()), delay);
  }

  #showResult(kind, titleText, actionText) {
    if (!this.#els) return;
    const a = this.config.ui.anim;
    const { root, card, title, reward, buttons } = this.#els.result;
    this.#resultKind = kind;
    this.#closing = false;
    root.dataset.result = kind;
    title.textContent = titleText;
    buttons[0].textContent = actionText;
    root.hidden = false;
    const won = kind === 'won';
    this.#animate(root, [{ opacity: 0 }, { opacity: 1 }], a.backdropInMs, a.soft, 0, true);
    const from = won ? a.cardFromScale : a.loseCardFromScale;
    this.#animate(card, [{ transform: `scale(${from})`, opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], a.cardInMs, won ? a.overshoot : a.soft, 0, true);
    const items = won ? [title, reward, buttons[0]] : [title, buttons[0]];
    items.forEach((el, i) => {
      this.#animate(el, [{ transform: `translateY(${a.itemShift}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
        a.itemInMs, a.overshoot, a.cardInMs * 0.35 + i * a.itemStaggerMs, true);
    });
    if (!won && !(this.effects && this.effects.reduced)) {
      const p = a.shakePx;
      this.#animate(title, [0, -p, p, -p * 0.6, p * 0.6, -p * 0.25, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        a.shakeMs, 'ease-out', a.cardInMs * 0.35 + a.itemInMs, false, false);
    }
    buttons[0].focus();
  }

  /** Win: fly the reward to the money, play the exit, then pay and load the next level. Lose: exit, then retry. */
  #onResultAction() {
    if (this.#closing || !this.#resultKind) return;
    const kind = this.#resultKind;
    this.#closing = true;
    if (kind === 'won') this.#flyReward();
    const a = this.config.ui.anim;
    const { root, card } = this.#els.result;
    this.#animate(card, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.85)', opacity: 0 }], a.cardOutMs, a.exit);
    const fade = this.#animate(root, [{ opacity: 1 }, { opacity: 0 }], a.backdropOutMs, a.exit);
    const done = () => {
      if (this.#resultKind !== kind) return;
      this.hideResult();
      if (kind === 'won') this.gameManager.continueToNextLevel();
      else this.gameManager.restartLevel();
    };
    if (fade) setTimeout(done, Math.max(a.cardOutMs, a.backdropOutMs));
    else done();
  }

  /** "+$X" flies from the win card to the money counter; the count-up starts when it lands. */
  #flyReward() {
    const a = this.config.ui.anim;
    const { fly, result, moneyLabel } = this.#els;
    const from = result.reward.getBoundingClientRect();
    const to = moneyLabel.getBoundingClientRect();
    fly.textContent = result.reward.textContent;
    fly.hidden = false;
    const x0 = from.left + from.width / 2;
    const y0 = from.top + from.height / 2;
    const x1 = to.left + to.width / 2;
    const y1 = to.top + to.height / 2;
    const at = (x, y, s) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
    const anim = this.#animate(fly, [
      { transform: at(x0, y0, 1), opacity: 1 },
      { transform: at((x0 + x1) / 2, Math.min(y0, y1) - 40, 1.15), opacity: 1, offset: 0.45 },
      { transform: at(x1, y1, 0.6), opacity: 0.2 },
    ], a.flyMs, a.soft);
    this.#flyLandsAt = now() + a.flyMs;
    const hide = () => {
      fly.hidden = true;
    };
    if (anim) anim.finished.then(hide, hide);
    else hide();
  }

  /** A button with a squash on press and a bounce on release (transform only). */
  #button(className, label, onClick) {
    const button = this.#make('button', className, label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    const a = this.config.ui.anim;
    const press = () => this.#animate(button, [{ transform: 'scale(1)' }, { transform: `scale(${a.buttonDownScale})` }], a.buttonDownMs, 'ease-out');
    const release = () => this.#animate(button, [{ transform: `scale(${a.buttonDownScale})` }, { transform: 'scale(1)' }], a.buttonUpMs, a.overshoot);
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', (e) => {
      if (e.buttons) release();
    });
    return button;
  }

  /**
   * Web Animations API helper (transform and opacity only). `track` counts it as an overlay animation for
   * isAnimating(); `replace` cancels the element's running animations first.
   * @returns {Animation | null}
   */
  #animate(el, keyframes, duration, easing, delay = 0, track = false, replace = true) {
    if (!el || typeof el.animate !== 'function') return null;
    if (replace) for (const running of el.getAnimations()) running.cancel();
    const anim = el.animate(keyframes, { duration, easing, delay, fill: 'both' });
    if (track) {
      this.#busy += 1;
      let counted = true;
      const settle = () => {
        if (counted) this.#busy -= 1;
        counted = false;
      };
      anim.finished.then(settle, settle);
    }
    return anim;
  }

  #changed(key, value) {
    if (this.#shown[key] === value) return false;
    this.#shown[key] = value;
    return true;
  }

  #make(tag, className, textContent) {
    const node = this.root.ownerDocument.createElement(tag);
    node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  }

  /** Full-screen modal with a centred card: title + buttons. Hidden until shown. */
  #modal(titleText, buttonSpecs) {
    const root = this.#make('div', 'modal');
    root.hidden = true;
    const card = this.#make('div', 'card');
    const title = this.#make('h2', 'card-title', titleText);
    const buttons = buttonSpecs.map(([className, label, onClick]) => this.#button(className, label, onClick));
    card.append(title, ...buttons);
    root.append(card);
    return { root, card, title, buttons };
  }

  /** Config.ui -> CSS custom properties on root (colours as-is, sizes in px). */
  #publishTokens() {
    const { colors, sizes, disabledOpacity } = this.config.ui;
    const { style } = this.root;
    for (const [key, value] of Object.entries(colors)) style.setProperty(`--ui-color-${kebab(key)}`, value);
    for (const [key, value] of Object.entries(sizes)) style.setProperty(`--ui-size-${kebab(key)}`, `${value}px`);
    style.setProperty('--ui-disabled-opacity', String(disabledOpacity));
  }
}
