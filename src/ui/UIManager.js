import { Events } from '../core/Events.js';
import { GamePhase } from '../core/GameManager.js';

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * Minimal flat UI (v1: plain DOM, solid colours, system font; no images, icon fonts or dependencies).
 *   bar      -- settings button (left), "Level N" (centre), money (right)
 *   settings -- modal panel shown while the simulation is paused: Resume / Restart level
 *   result   -- modal card after LEVEL_WON ("Congratulations!" + "Continue +$X") or LEVEL_LOST ("Out of space" + "Retry")
 *
 * UIManager keeps no game state: update(snapshot) renders it and clicks become GameManager commands. The result
 * card waits Config.ui.timing.{win,lose}OverlayDelay after the event so the last move stays visible. Modals cover
 * the whole screen with pointer events on, so the game underneath gets no input. Colours, sizes and timings come
 * from Config.ui and are published as CSS custom properties (--ui-color-*, --ui-size-*, --ui-fade) for the
 * layout-only stylesheet in index.html.
 */
export class UIManager {
  #els = null;
  #unbind = null;
  #timer = null;
  #resultKind = null;
  #shown = {};

  /** @param {{ root: HTMLElement, eventBus: import('../core/EventBus.js').EventBus, gameManager: object, config?: object }} deps */
  constructor({ root, eventBus, gameManager, config = gameManager.config }) {
    this.root = root;
    this.eventBus = eventBus;
    this.gameManager = gameManager;
    this.config = config;
  }

  /** Build the bar and the two modals inside root and subscribe to the level events. */
  mount() {
    if (this.#els) return;
    const { text } = this.config.ui;
    this.#publishTokens();

    const bar = this.#make('div', 'bar');
    const settingsButton = this.#make('button', 'icon-button');
    settingsButton.type = 'button';
    settingsButton.title = text.settings;
    settingsButton.setAttribute('aria-label', text.settings);
    for (let i = 0; i < 3; i += 1) settingsButton.append(this.#make('span', 'icon-bar'));
    settingsButton.addEventListener('click', () => this.gameManager.pause());
    const levelLabel = this.#make('div', 'bar-level');
    const moneyLabel = this.#make('div', 'bar-money');
    bar.append(settingsButton, levelLabel, moneyLabel);

    const settings = this.#modal(text.paused, [
      ['button', text.resume, () => this.gameManager.resume()],
      ['button button-secondary', text.restartLevel, () => this.gameManager.restartLevel()],
    ]);
    const result = this.#modal('', [['button', '', () => this.#onResultAction()]]);

    this.root.append(bar, settings.root, result.root);
    this.#els = { bar, settingsButton, levelLabel, moneyLabel, settings, result };
    this.#shown = {};

    const offs = [
      this.eventBus.on(Events.LEVEL_WON, () => this.#schedule('won')),
      this.eventBus.on(Events.LEVEL_LOST, () => this.#schedule('lost')),
      this.eventBus.on(Events.LEVEL_LOADED, () => this.hideResult()),
    ];
    this.#unbind = () => offs.forEach((off) => off());
  }

  unmount() {
    if (this.#unbind) this.#unbind();
    this.#unbind = null;
    this.hideResult();
    if (this.#els) {
      const { bar, settings, result } = this.#els;
      bar.remove();
      settings.root.remove();
      result.root.remove();
    }
    this.#els = null;
  }

  /** Per-frame render from the snapshot; touches the DOM only when a shown value changed. */
  update(snapshot) {
    if (!this.#els || !snapshot) return;
    const { text } = this.config.ui;
    const { levelLabel, moneyLabel, settings, settingsButton } = this.#els;
    const { levelNumber, money } = snapshot.progress;
    if (this.#changed('levelNumber', levelNumber)) levelLabel.textContent = `${text.level} ${levelNumber}`;
    if (this.#changed('money', money)) moneyLabel.textContent = `${text.currency}${money}`;
    if (this.#changed('paused', snapshot.paused)) {
      settings.root.hidden = !snapshot.paused;
      if (snapshot.paused) settings.buttons[0].focus();
    }
    const playing = snapshot.phase === GamePhase.PLAYING;
    if (this.#changed('playing', playing)) settingsButton.disabled = !playing;
  }

  /**
   * Win card: title and an action showing the reward from the progression state. On the last level of the cycle the
   * action reads "Play again" (the same command then loads Level 1).
   */
  showWin() {
    const { text } = this.config.ui;
    const { reward, isLastLevel } = this.gameManager.getSnapshot().progress;
    const action = isLastLevel ? text.playAgain : text.continue;
    this.#showResult('won', text.won, `${action} +${text.currency}${reward}`);
  }

  /** Lose card, the same for every loss reason. */
  showLose() {
    const { text } = this.config.ui;
    this.#showResult('lost', text.lost, text.retry);
  }

  hideResult() {
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#resultKind = null;
    if (this.#els) this.#els.result.root.hidden = true;
  }

  #schedule(kind) {
    const { winOverlayDelay, loseOverlayDelay } = this.config.ui.timing;
    clearTimeout(this.#timer);
    const delay = (kind === 'won' ? winOverlayDelay : loseOverlayDelay) * 1000;
    this.#timer = setTimeout(() => (kind === 'won' ? this.showWin() : this.showLose()), delay);
  }

  #showResult(kind, titleText, actionText) {
    if (!this.#els) return;
    const { result } = this.#els;
    this.#resultKind = kind;
    result.root.dataset.result = kind;
    result.title.textContent = titleText;
    result.buttons[0].textContent = actionText;
    result.root.hidden = false;
    result.buttons[0].focus();
  }

  /** Win: pay + next level. Lose: replay. The card hides on the LEVEL_LOADED that follows. */
  #onResultAction() {
    if (this.#resultKind === 'won') this.gameManager.continueToNextLevel();
    else if (this.#resultKind === 'lost') this.gameManager.restartLevel();
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
    const buttons = buttonSpecs.map(([className, label, onClick]) => {
      const button = this.#make('button', className, label);
      button.type = 'button';
      button.addEventListener('click', onClick);
      return button;
    });
    card.append(title, ...buttons);
    root.append(card);
    return { root, title, buttons };
  }

  /** Config.ui -> CSS custom properties on root (colours as-is, sizes in px, fade in s). */
  #publishTokens() {
    const { colors, sizes, timing, disabledOpacity } = this.config.ui;
    const { style } = this.root;
    for (const [key, value] of Object.entries(colors)) style.setProperty(`--ui-color-${kebab(key)}`, value);
    for (const [key, value] of Object.entries(sizes)) style.setProperty(`--ui-size-${kebab(key)}`, `${value}px`);
    style.setProperty('--ui-fade', `${timing.fade}s`);
    style.setProperty('--ui-disabled-opacity', String(disabledOpacity));
  }
}
