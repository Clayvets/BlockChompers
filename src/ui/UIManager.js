import { Events } from '../core/Events.js';
import { GamePhase } from '../core/GameManager.js';
import { AppState } from '../app/AppFlow.js';
import { Cues } from '../app/Cues.js';
import { TweenScheduler } from '../render/anim/TweenScheduler.js';
import { computeStartScreenLayout } from './layout/computeStartScreenLayout.js';

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const now = () => globalThis.performance.now();
const place = (el, { x, y, width, height }) => {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
};

/**
 * Flat DOM UI (plain elements, solid colours, system font; no icon fonts or dependencies), with juice:
 *   start    -- start screen while the app flow is in MENU (page load), with the HUD hidden. Styled (Fish of Fortune,
 *               Config.ui.startScreen) when main.js passes its loaded art: the key art with the painted title, contained
 *               in the viewport over a blurred copy of itself, and an image Play button anchored to the art
 *               (layout/computeStartScreenLayout.js) that breathes while idle. Otherwise the flat v3 screen: the game
 *               title and a big Play button on a card. Play plays the exit animation, then starts the flow
 *               (AppFlow.play: Level 1 loads and the HUD slides in).
 *   bar      -- settings button, "Level N", money. Slides in at every level start; the level label swaps with a
 *               slide; the money counts up with a punch when the "+$X" reward label lands on it. Styled (Fish of
 *               Fortune, Config.ui.hud) when main.js passes its loaded images: the round settings button, the level bar
 *               and the coin bar with the coin over its left end, sized in design units from the Renderer's
 *               screenFrame() (resize(frame)), with white Titan One text that shrinks to fit; the reward lands on the
 *               coin. Otherwise the flat v3 bar.
 *   settings -- panel shown while paused (Resume, Restart level, Sound on/off); slides and fades in and out.
 *   result   -- win card ("Congratulations!", "+$X", Continue / Play again) or lose card ("Out of space", Retry).
 *               Backdrop fades in, the card pops in with overshoot (softer for a loss, whose title shakes), and the
 *               items enter with a stagger. A button plays the exit animation first and only then sends its command.
 *   buttons  -- squash on pointerdown, bounce back on release.
 *
 * Animations use the Web Animations API on transform and opacity only; times, distances and easings come from
 * Config.ui.anim. UIManager keeps no game state: update(snapshot, dtMs) renders it, and clicks become GameManager or
 * AppFlow commands. It emits cues (src/app/Cues.js) for what the player does and sees -- taps, overlays entering and
 * leaving, Play, the win and lose cards, each money tick -- which the AudioManager turns into sounds. isAnimating() is
 * true while an overlay enters or leaves, so main.js keeps the board's input off. hooks.onWinShown /
 * hooks.onResultClosed let main.js start and stop the win confetti.
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
  #starting = false;
  #settingsOpen = false;
  /** The Renderer's screenFrame() from the last resize: the styled HUD is sized from it. */
  #frame = null;

  /**
   * @param {{ root: HTMLElement, eventBus: object, gameManager: object, config?: object,
   *           flow?: import('../app/AppFlow.js').AppFlow, effects?: import('./EffectsPreference.js').EffectsPreference,
   *           sound?: import('./SoundPreference.js').SoundPreference, cues?: import('../app/Cues.js').CueBus,
   *           startArt?: { background: HTMLImageElement, button: HTMLImageElement } | null,
   *           hudArt?: { settings: HTMLImageElement, levelBar: HTMLImageElement, coinBar: HTMLImageElement,
   *                      coin: HTMLImageElement } | null,
   *           hooks?: { onWinShown?: Function, onResultClosed?: Function } }} deps
   *   startArt: the styled start screen's decoded images (startScreenArt.js); null keeps the flat v3 start screen.
   *   hudArt: the styled HUD's decoded images (hudArt.js); null keeps the flat v3 bar.
   */
  constructor({ root, eventBus, gameManager, config = gameManager.config, flow = null, effects = null, sound = null, cues = null, startArt = null, hudArt = null, hooks = {} }) {
    this.root = root;
    this.eventBus = eventBus;
    this.gameManager = gameManager;
    this.config = config;
    this.flow = flow;
    this.effects = effects;
    this.sound = sound;
    this.cues = cues;
    this.startArt = startArt;
    this.hudArt = hudArt;
    this.hooks = hooks;
  }

  /** True while an overlay is entering or leaving: the board takes no input then. */
  isAnimating() {
    return this.#busy > 0 || this.#closing || this.#starting;
  }

  /** Build the bar, the modals and the flying reward label inside root; subscribe to the level events. */
  mount() {
    if (this.#els) return;
    const { text } = this.config.ui;
    this.#publishTokens();
    this.root.ownerDocument.title = text.title;

    const hud = this.hudArt ? this.#styledBar(this.hudArt) : this.#flatBar();
    const { bar, settingsButton } = hud;

    const settings = this.#modal(text.paused, [
      ['button', text.resume, () => this.gameManager.resume()],
      ['button button-secondary', text.restartLevel, () => this.gameManager.restartLevel()],
      ['button button-secondary', '', () => this.#toggleSound()],
    ]);
    const result = this.#modal('', [['button', '', () => this.#onResultAction()]]);
    const reward = this.#make('div', 'card-reward');
    result.title.after(reward);
    result.reward = reward;
    const start = this.startArt ? this.#styledStart(this.startArt) : this.#flatStart();
    const fly = this.#make('div', 'fly-label');
    fly.hidden = true;

    this.root.append(bar, settings.root, result.root, start.root, fly);
    this.#els = { ...hud, settings, result, start, fly };
    this.#shown = {};
    this.#renderSoundLabel();

    const offs = [
      this.eventBus.on(Events.LEVEL_WON, () => this.#schedule('won')),
      this.eventBus.on(Events.LEVEL_LOST, () => this.#schedule('lost')),
      this.eventBus.on(Events.LEVEL_LOADED, () => this.#onLevelLoaded()),
    ];
    this.#unbind = () => offs.forEach((off) => off());
    if (this.#inMenu()) {
      bar.hidden = true;
      this.#showStart();
    }
  }

  unmount() {
    if (this.#unbind) this.#unbind();
    this.#unbind = null;
    this.hideResult();
    this.#tweens.clear();
    if (this.#els) {
      const { bar, settings, result, start, fly } = this.#els;
      for (const el of [bar, settings.root, result.root, start.root, fly]) el.remove();
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
      this.#fitText(levelLabel);
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
    const counting = this.#shown.money !== undefined;
    if (this.#changed('money', shownMoney)) {
      const label = `${text.currency}${shownMoney}`;
      this.#els.moneyLabel.textContent = label;
      if (this.#changed('moneyLength', label.length)) this.#fitText(this.#els.moneyLabel); // only when it can get wider
      if (counting) this.#cue(Cues.COIN);
    }
    if (snapshot.paused !== this.#settingsOpen) this.#setSettingsOpen(snapshot.paused);
    const playing = snapshot.phase === GamePhase.PLAYING;
    if (this.#changed('playing', playing)) settingsButton.disabled = !playing;
  }

  /**
   * Viewport size changed (main.js, after the Renderer refitted): the styled start screen re-anchors its art and Play
   * button, and the styled HUD takes its sizes from the design frame.
   * @param {{ scale: number, width: number, hud: { h: number } } | null} [frame] Renderer.screenFrame()
   */
  resize(frame = null) {
    if (!this.#els) return;
    if (frame) this.#frame = frame;
    this.#layoutStart();
    this.#layoutHud();
  }

  /** Flat v3 bar: settings (three-line icon), "Level N", money. */
  #flatBar() {
    const { text } = this.config.ui;
    const bar = this.#make('div', 'bar');
    const settingsButton = this.#button('icon-button', '', () => this.gameManager.pause());
    settingsButton.title = text.settings;
    settingsButton.setAttribute('aria-label', text.settings);
    for (let i = 0; i < 3; i += 1) settingsButton.append(this.#make('span', 'icon-bar'));
    const levelLabel = this.#make('div', 'bar-level');
    const moneyLabel = this.#make('div', 'bar-money');
    bar.append(settingsButton, levelLabel, moneyLabel);
    return { bar, settingsButton, levelLabel, moneyLabel, styled: false };
  }

  /**
   * Styled HUD from the sheet: the round settings button (the v3 press and release), the level bar and the coin bar
   * with the coin over its left end. The bars are static containers; each holds a text box (its inset part of the
   * bar) around the label, so the label's own transform is free for the v3 swap and punch animations.
   */
  #styledBar(art) {
    const { text } = this.config.ui;
    const bar = this.#make('div', 'bar hud-styled');
    const settingsButton = this.#button('hud-settings', '', () => this.gameManager.pause());
    settingsButton.title = text.settings;
    settingsButton.setAttribute('aria-label', text.settings);
    settingsButton.style.backgroundImage = `url("${art.settings.src}")`;
    const level = this.#make('div', 'hud-bar');
    level.style.backgroundImage = `url("${art.levelBar.src}")`;
    const levelBox = this.#make('div', 'hud-text-box');
    const levelLabel = this.#make('span', 'hud-text');
    levelBox.append(levelLabel);
    level.append(levelBox);
    const coinBar = this.#make('div', 'hud-bar');
    coinBar.style.backgroundImage = `url("${art.coinBar.src}")`;
    const coinBox = this.#make('div', 'hud-text-box');
    const moneyLabel = this.#make('span', 'hud-text');
    coinBox.append(moneyLabel);
    const coinIcon = art.coin;
    coinIcon.className = 'hud-coin-icon';
    coinIcon.alt = '';
    coinIcon.draggable = false;
    coinBar.append(coinBox, coinIcon);
    bar.append(settingsButton, level, coinBar);
    return { bar, settingsButton, levelLabel, moneyLabel, coinIcon, level, levelBox, coinBar, coinBox, styled: true };
  }

  /** Styled HUD sizes and places (CSS px) from the design frame: Config.ui.hud lengths are design units. */
  #layoutHud() {
    const els = this.#els;
    const frame = this.#frame;
    if (!els.styled || !frame) return;
    const h = this.config.ui.hud;
    const s = frame.scale;
    const band = frame.hud.h;
    els.bar.style.height = `${band}px`;
    const d = h.dropShadow;
    els.bar.style.setProperty('--ui-hud-drop', `drop-shadow(0 ${d.offsetY * s}px ${d.blur * s}px ${d.color})`);
    const size = h.settings.size * s;
    const pad = h.padding * s;
    place(els.settingsButton, { x: pad, y: (band - size) / 2, width: size, height: size });
    const lh = h.levelBar.height * s;
    const lw = lh * h.levelBar.aspect;
    place(els.level, { x: (frame.width - lw) / 2, y: (band - lh) / 2, width: lw, height: lh });
    const ch = h.coinBar.height * s;
    const cw = ch * h.coinBar.aspect;
    place(els.coinBar, { x: frame.width - pad - cw, y: (band - ch) / 2, width: cw, height: ch });
    const coin = h.coin.size * ch;
    place(els.coinIcon, { x: h.coin.centerX * cw - coin / 2, y: h.coin.centerY * ch - coin / 2, width: coin, height: coin });
    const { levelInsets, coinInsets } = h.text;
    for (const [box, width, [left, right], barHeight] of [[els.levelBox, lw, levelInsets, lh], [els.coinBox, cw, coinInsets, ch]]) {
      box.style.left = `${left * width}px`;
      box.style.right = `${right * width}px`;
      box.firstChild.dataset.fontSize = String(h.text.size * barHeight);
    }
    this.#fitText(els.levelLabel);
    this.#fitText(els.moneyLabel);
  }

  /** Styled HUD: the label at its configured size, shrunk to fit its text box if the text is wider. */
  #fitText(label) {
    const base = Number(label.dataset.fontSize);
    if (!this.#els || !this.#els.styled || !base) return;
    label.style.fontSize = `${base}px`;
    const room = label.parentElement.clientWidth;
    const need = label.offsetWidth;
    if (need > room && room > 0) label.style.fontSize = `${(base * room) / need}px`;
  }

  #inMenu() {
    return Boolean(this.flow) && this.flow.state === AppState.MENU;
  }

  /** Flat v3 start screen: the game title and the Play button on a card. */
  #flatStart() {
    const { text } = this.config.ui;
    // Play sounds its own confirm (the PLAY cue), not the tap.
    const start = this.#modal(text.title, [['button button-play', text.play, () => this.#onPlay(), false]]);
    start.root.classList.add('modal-start');
    start.items = [start.title, start.buttons[0]];
    return start;
  }

  /**
   * Styled start screen: the backdrop (the art again, cover-fitted, blurred and darkened), the art itself as the card
   * (its painted title replaces the text title, which stays the aria-label), and the Play button: an anchor placed on
   * the art, a pulse wrapper that breathes, and the button with the v3 press and release. Each layer owns one transform.
   */
  #styledStart(art) {
    const { text } = this.config.ui;
    const root = this.#make('div', 'modal start-styled');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', text.title);
    const backdrop = this.#make('div', 'start-backdrop');
    backdrop.style.backgroundImage = `url("${art.background.src}")`;
    const card = this.#make('div', 'start-art');
    const image = art.background;
    image.className = 'start-art-image';
    image.alt = '';
    image.draggable = false;
    const anchor = this.#make('div', 'start-play-anchor');
    const pulse = this.#make('div', 'start-play-pulse');
    // Play sounds its own confirm (the PLAY cue), not the tap.
    const button = this.#button('start-play', '', () => this.#onPlay(), false);
    button.style.backgroundImage = `url("${art.button.src}")`;
    button.append(this.#make('span', 'start-play-label', text.play));
    pulse.append(button);
    anchor.append(pulse);
    card.append(image, anchor);
    root.append(backdrop, card);
    return { root, card, title: null, buttons: [button], items: [anchor], anchor, pulse, art };
  }

  /** Styled start screen: place the art (contained in the viewport) and the Play button anchored to it. */
  #layoutStart() {
    const start = this.#els.start;
    if (!start.art) return;
    const { background, button } = start.art;
    const layout = computeStartScreenLayout(
      { width: this.root.clientWidth, height: this.root.clientHeight },
      { background: { width: background.naturalWidth, height: background.naturalHeight },
        button: { width: button.naturalWidth, height: button.naturalHeight } },
      this.config.ui.startScreen,
    );
    place(start.card, layout.image);
    place(start.anchor, { ...layout.button, x: layout.button.x - layout.image.x, y: layout.button.y - layout.image.y });
    start.buttons[0].style.fontSize = `${layout.labelSize}px`;
  }

  /**
   * Start screen: the same entrance as the win card (backdrop, card pop with overshoot, then the title and button one
   * after another; the styled screen's card is the art and its only item the button). The styled button then breathes.
   */
  #showStart() {
    const a = this.config.ui.anim;
    const start = this.#els.start;
    start.root.hidden = false;
    this.#layoutStart();
    this.#enterOverlay(start, start.items, a.cardFromScale, a.overshoot);
    // Focused so Enter / Space play at once; on the art, the focus ring waits for keyboard use (:focus-visible).
    start.buttons[0].focus(start.art ? { focusVisible: false } : undefined);
    if (start.pulse && !(this.effects && this.effects.reduced)) {
      const p = this.config.ui.startScreen.playButton;
      this.#animate(start.pulse, [{ transform: 'scale(1)' }, { transform: `scale(${p.pulseScale})` }], p.pulsePeriodMs / 2,
        'ease-in-out', a.cardInMs * 0.35 + (start.items.length - 1) * a.itemStaggerMs + a.itemInMs, false, true,
        { direction: 'alternate', iterations: Infinity });
    }
  }

  /**
   * Play: the PLAY cue goes out inside this click, so the AudioManager can create and resume its AudioContext (browser
   * autoplay policy). The screen plays its exit, then the flow starts: Level 1 loads and its LEVEL_LOADED slides the
   * HUD in.
   */
  #onPlay() {
    if (!this.#inMenu() || this.#starting) return;
    this.#starting = true;
    this.#cue(Cues.PLAY);
    if (this.#els.start.pulse) for (const running of this.#els.start.pulse.getAnimations()) running.cancel();
    this.#exitOverlay(this.#els.start, () => {
      this.#els.start.root.hidden = true;
      this.#starting = false;
      this.flow.play();
    });
  }

  /** Every level start (next level, restart, retry, Play): the bar slides in. */
  #onLevelLoaded() {
    this.hideResult();
    if (this.#inMenu()) return;
    const a = this.config.ui.anim;
    this.#els.bar.hidden = false;
    this.#animate(this.#els.bar, [{ transform: 'translateY(-110%)' }, { transform: 'translateY(0)' }], a.hudInMs, a.overshoot);
  }

  #swapLevelLabel(label) {
    const a = this.config.ui.anim;
    const el = this.#els.levelLabel;
    const out = this.#animate(el, [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-a.labelShift}px)`, opacity: 0 }], a.labelOutMs, a.exit);
    const enter = () => {
      el.textContent = label;
      this.#fitText(el);
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
    this.#cue(open ? Cues.OVERLAY_IN : Cues.OVERLAY_OUT);
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

  #toggleSound() {
    if (this.sound) this.sound.toggle();
    this.#renderSoundLabel();
  }

  #renderSoundLabel() {
    const { text } = this.config.ui;
    const button = this.#els.settings.buttons[2];
    button.hidden = !this.sound;
    button.textContent = this.sound && !this.sound.on ? text.soundOff : text.soundOn;
  }

  /** Win card: title, the reward, and Continue (or Play again on the last level of the cycle). */
  showWin() {
    const { text } = this.config.ui;
    const { reward, isLastLevel } = this.gameManager.getSnapshot().progress;
    this.#els.result.reward.textContent = `+${text.currency}${reward}`;
    this.#els.result.reward.hidden = false;
    this.#showResult('won', text.won, isLastLevel ? text.playAgain : text.continue);
    this.#cue(Cues.WIN);
    if (this.hooks.onWinShown) this.hooks.onWinShown();
  }

  /** Lose card, the same for every loss reason. */
  showLose() {
    const { text } = this.config.ui;
    this.#els.result.reward.hidden = true;
    this.#showResult('lost', text.lost, text.retry);
    this.#cue(Cues.LOSE);
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
    const result = this.#els.result;
    const { root, title, reward, buttons } = result;
    this.#resultKind = kind;
    this.#closing = false;
    root.dataset.result = kind;
    title.textContent = titleText;
    buttons[0].textContent = actionText;
    root.hidden = false;
    const won = kind === 'won';
    this.#enterOverlay(result, won ? [title, reward, buttons[0]] : [title, buttons[0]],
      won ? a.cardFromScale : a.loseCardFromScale, won ? a.overshoot : a.soft);
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
    this.#exitOverlay(this.#els.result, () => {
      if (this.#resultKind !== kind) return;
      this.hideResult();
      if (kind === 'won') this.gameManager.continueToNextLevel();
      else this.gameManager.restartLevel();
    });
  }

  /** Backdrop fades in, the card pops in from `fromScale` with `easing`, then `items` enter one after another. */
  #enterOverlay({ root, card }, items, fromScale, easing) {
    const a = this.config.ui.anim;
    this.#cue(Cues.OVERLAY_IN);
    this.#animate(root, [{ opacity: 0 }, { opacity: 1 }], a.backdropInMs, a.soft, 0, true);
    this.#animate(card, [{ transform: `scale(${fromScale})`, opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], a.cardInMs, easing, 0, true);
    items.forEach((el, i) => {
      this.#animate(el, [{ transform: `translateY(${a.itemShift}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
        a.itemInMs, a.overshoot, a.cardInMs * 0.35 + i * a.itemStaggerMs, true);
    });
  }

  /** The card shrinks and fades with the backdrop; `done` runs once both have finished. */
  #exitOverlay({ root, card }, done) {
    const a = this.config.ui.anim;
    this.#cue(Cues.OVERLAY_OUT);
    this.#animate(card, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.85)', opacity: 0 }], a.cardOutMs, a.exit);
    const fade = this.#animate(root, [{ opacity: 1 }, { opacity: 0 }], a.backdropOutMs, a.exit);
    if (fade) setTimeout(done, Math.max(a.cardOutMs, a.backdropOutMs));
    else done();
  }

  /** "+$X" flies from the win card to the money counter (the coin icon on the styled HUD); the count-up starts when it lands. */
  #flyReward() {
    const a = this.config.ui.anim;
    const { fly, result, moneyLabel, coinIcon } = this.#els;
    const from = result.reward.getBoundingClientRect();
    const to = (coinIcon || moneyLabel).getBoundingClientRect();
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

  /** A button with a squash on press and a bounce on release (transform only); `tap` sends the TAP cue on press. */
  #button(className, label, onClick, tap = true) {
    const button = this.#make('button', className, label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    const a = this.config.ui.anim;
    const press = () => {
      if (button.disabled) return;
      if (tap) this.#cue(Cues.TAP);
      this.#animate(button, [{ transform: 'scale(1)' }, { transform: `scale(${a.buttonDownScale})` }], a.buttonDownMs, 'ease-out');
    };
    const release = () => this.#animate(button, [{ transform: `scale(${a.buttonDownScale})` }, { transform: 'scale(1)' }], a.buttonUpMs, a.overshoot);
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', (e) => {
      if (e.buttons) release();
    });
    return button;
  }

  #cue(type) {
    if (this.cues) this.cues.emit(type);
  }

  /**
   * Web Animations API helper (transform and opacity only). `track` counts it as an overlay animation for
   * isAnimating(); `replace` cancels the element's running animations first; `timing` adds options (e.g. a loop).
   * @returns {Animation | null}
   */
  #animate(el, keyframes, duration, easing, delay = 0, track = false, replace = true, timing = null) {
    if (!el || typeof el.animate !== 'function') return null;
    if (replace) for (const running of el.getAnimations()) running.cancel();
    const anim = el.animate(keyframes, { duration, easing, delay, fill: 'both', ...timing });
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

  /** Full-screen modal with a centred card: title + buttons ([className, label, onClick, tap?]). Hidden until shown. */
  #modal(titleText, buttonSpecs) {
    const root = this.#make('div', 'modal');
    root.hidden = true;
    const card = this.#make('div', 'card');
    const title = this.#make('h2', 'card-title', titleText);
    const buttons = buttonSpecs.map(([className, label, onClick, tap]) => this.#button(className, label, onClick, tap));
    card.append(title, ...buttons);
    root.append(card);
    return { root, card, title, buttons };
  }

  /** Config.ui -> CSS custom properties on root (colours as-is, sizes in px; the styled start screen as --ui-start-*). */
  #publishTokens() {
    const { colors, sizes, disabledOpacity, startScreen } = this.config.ui;
    const { style } = this.root;
    for (const [key, value] of Object.entries(colors)) style.setProperty(`--ui-color-${kebab(key)}`, value);
    for (const [key, value] of Object.entries(sizes)) style.setProperty(`--ui-size-${kebab(key)}`, `${value}px`);
    style.setProperty('--ui-disabled-opacity', String(disabledOpacity));
    const { font, backdrop, playButton: p } = startScreen;
    style.setProperty('--ui-start-font', `"${font.family}", ${font.fallback}`);
    style.setProperty('--ui-start-backdrop-color', backdrop.color);
    style.setProperty('--ui-start-backdrop-filter', `blur(${backdrop.blurPx}px) brightness(${backdrop.brightness}) saturate(${backdrop.saturate})`);
    style.setProperty('--ui-start-backdrop-scale', String(backdrop.scale));
    style.setProperty('--ui-start-label-color', p.labelColor);
    style.setProperty('--ui-start-label-offset', `${p.labelOffsetY}em`);
    style.setProperty('--ui-start-outline', `${p.outlineWidth}em ${p.outlineColor}`);
    style.setProperty('--ui-start-shadow', p.shadow);
    style.setProperty('--ui-start-button-shadow', `drop-shadow(0 ${p.dropShadow.offsetY}em ${p.dropShadow.blur}em ${p.dropShadow.color})`);
    style.setProperty('--ui-start-hover', `brightness(${p.hoverBrightness})`);
    style.setProperty('--ui-start-focus', `${p.focusWidth}px solid ${p.focusColor}`);
    style.setProperty('--ui-start-focus-offset', `${p.focusOffset}px`);
    const { text: t, focusColor, focusWidth, focusOffset } = this.config.ui.hud;
    style.setProperty('--ui-hud-text-color', t.color);
    style.setProperty('--ui-hud-outline', `${t.outlineWidth}em ${t.outlineColor}`);
    style.setProperty('--ui-hud-shadow', t.shadow);
    style.setProperty('--ui-hud-offset', `${t.offsetY}em`);
    style.setProperty('--ui-hud-focus', `${focusWidth}px solid ${focusColor}`);
    style.setProperty('--ui-hud-focus-offset', `${focusOffset}px`);
  }
}
