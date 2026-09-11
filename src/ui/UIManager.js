import { Events } from '../core/Events.js';
import { GamePhase } from '../core/GameManager.js';
import { AppState } from '../app/AppFlow.js';
import { Cues } from '../app/Cues.js';
import { TweenScheduler } from '../render/anim/TweenScheduler.js';
import { computeStartScreenLayout } from './layout/computeStartScreenLayout.js';
import { OverlayController, OverlayState, OverlayAction, OverlayCommand } from './overlays/OverlayController.js';
import { UiKit } from './overlays/UiKit.js';
import { SettingsPanel } from './overlays/SettingsPanel.js';
import { WinOverlay } from './overlays/WinOverlay.js';
import { LoseOverlay } from './overlays/LoseOverlay.js';
import { FlatOverlay } from './overlays/FlatOverlay.js';

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const now = () => globalThis.performance.now();
const place = (el, { x, y, width, height }) => {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
};

/**
 * DOM UI in #ui-root, with juice:
 *   start    -- start screen while the app flow is in MENU (page load), with the HUD hidden. Styled (Fish of Fortune,
 *               Config.ui.startScreen) when main.js passes its loaded art: the key art with the painted title, contained
 *               in the viewport over a blurred copy of itself, and an image Play button anchored to the art
 *               (layout/computeStartScreenLayout.js) that breathes while idle. Otherwise the flat v3 screen: the game
 *               title and a big Play button on a card. Play plays the exit animation, then starts the flow
 *               (AppFlow.play: Level 1 loads and the HUD slides in).
 *   bar      -- settings button, "Level N", coins. Slides in at every level start; the level label swaps with a slide;
 *               the coins count up with a punch when the flying "+X" lands on them. Styled (Fish of Fortune,
 *               Config.ui.hud) when main.js passes its loaded images: the round settings button, the level bar and the
 *               coin bar with the coin over its left end, sized in design units from the Renderer's screenFrame()
 *               (resize(frame)), with white Titan One text that shrinks to fit. Otherwise the flat v3 bar.
 *   overlays -- settings (pause), win and lose: one container each (src/ui/overlays). Styled (Fish of Fortune,
 *               Config.ui.overlays: a glass panel on a dim, Titan One titles, the Play button's pill) when main.js
 *               passes their images; otherwise the flat v3 cards. The pure OverlayController decides what is up and what
 *               each press does; this class only renders it and sends the commands: the settings button (again, or
 *               Escape) toggles the pause panel, whose buttons resume, restart or toggle the sound; Continue and Retry
 *               play their overlay's exit first, then continue or restart. The HUD piece that matters stays above the
 *               dim: the settings button (highlighted) over the pause panel, the coins over a result.
 *   buttons  -- real <button>s: squash on press (pointer, Enter, Space), bounce back on release, the tap sound.
 *
 * Animations use the Web Animations API on transform and opacity only; times, distances and easings come from
 * Config.ui.anim. UIManager keeps no game state: update(snapshot, dtMs) renders it, and clicks become GameManager or
 * AppFlow commands. It emits cues (src/app/Cues.js) for what the player does and sees -- taps, overlays entering and
 * leaving, Play, the win and lose overlays, each coin tick -- which the AudioManager turns into sounds. isAnimating()
 * is true while an overlay enters or leaves, so main.js keeps the board's input off. hooks.onWinShown /
 * hooks.onResultClosed let main.js start and stop the win confetti.
 */
export class UIManager {
  #els = null;
  #unbind = null;
  #timer = null;
  #shown = {};
  #tweens = new TweenScheduler(16);
  #money = { value: 0 };
  #flyLandsAt = 0;
  #busy = 0;
  #starting = false;
  /** The Renderer's screenFrame() from the last resize: the styled HUD and overlays are sized from it. */
  #frame = null;
  #overlay = new OverlayController();
  /** One view per OverlayState (styled or flat); #shownState is the one on screen or leaving. */
  #views = null;
  #shownState = OverlayState.NONE;
  /** Bumped whenever an overlay is dropped at once, so a late animation callback does nothing. */
  #overlaySeq = 0;
  #kit = null;

  /**
   * @param {{ root: HTMLElement, eventBus: object, gameManager: object, config?: object,
   *           flow?: import('../app/AppFlow.js').AppFlow, effects?: import('./EffectsPreference.js').EffectsPreference,
   *           sound?: import('./SoundPreference.js').SoundPreference, cues?: import('../app/Cues.js').CueBus,
   *           startArt?: { background: HTMLImageElement, button: HTMLImageElement } | null,
   *           hudArt?: { settings: HTMLImageElement, levelBar: HTMLImageElement, coinBar: HTMLImageElement,
   *                      coin: HTMLImageElement } | null,
   *           overlayArt?: { coin: HTMLImageElement, sadBlock: HTMLImageElement, button: HTMLImageElement } | null,
   *           hooks?: { onWinShown?: Function, onResultClosed?: Function } }} deps
   *   startArt: the styled start screen's decoded images (startScreenArt.js); null keeps the flat v3 start screen.
   *   hudArt: the styled HUD's decoded images (hudArt.js); null keeps the flat v3 bar.
   *   overlayArt: the styled overlays' decoded images (overlayArt.js); null keeps the flat v3 cards.
   */
  constructor({ root, eventBus, gameManager, config = gameManager.config, flow = null, effects = null, sound = null, cues = null, startArt = null, hudArt = null, overlayArt = null, hooks = {} }) {
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
    this.overlayArt = overlayArt;
    this.hooks = hooks;
    this.#kit = new UiKit({ doc: root.ownerDocument, config, cues });
  }

  /** Debug panel: tweens (coin count-up) and Web Animations running in the UI. */
  stats() {
    const doc = this.root.ownerDocument;
    return { tweens: this.#tweens.activeCount, animations: typeof doc.getAnimations === 'function' ? doc.getAnimations().length : 0 };
  }

  /** True while an overlay is entering or leaving: the board takes no input then. */
  isAnimating() {
    return this.#busy > 0 || this.#starting || this.#overlay.busy;
  }

  /**
   * True while the styled start screen fully hides the scene (shown, its entrance done, Play not pressed): main.js then
   * stops drawing the scene (RenderGate). The flat v3 start screen lets the level show faintly, so it never covers it.
   */
  coversScene() {
    return Boolean(this.#els && this.#els.start.art) && this.#inMenu() && !this.#els.start.root.hidden && !this.isAnimating();
  }

  /** Build the bar, the overlays, the start screen and the flying reward label inside root; subscribe to the level events. */
  mount() {
    if (this.#els) return;
    const { text } = this.config.ui;
    this.#publishTokens();
    this.root.ownerDocument.title = text.title;

    const hud = this.hudArt ? this.#styledBar(this.hudArt) : this.#flatBar();
    const { bar } = hud;
    this.#views = this.overlayArt ? this.#styledOverlays(this.overlayArt) : this.#flatOverlays();
    const start = this.startArt ? this.#styledStart(this.startArt) : this.#flatStart();
    const fly = this.#make('div', this.overlayArt ? 'fly-label ov-font ov-reward' : 'fly-label');
    fly.hidden = true;

    const overlays = [this.#views[OverlayState.PAUSE], this.#views[OverlayState.WIN], this.#views[OverlayState.LOSE]];
    this.root.append(bar, ...overlays.map((view) => view.root), start.root, fly);
    this.#els = { ...hud, start, fly };
    this.#shown = {};
    this.#renderSoundLabel();

    const doc = this.root.ownerDocument;
    const onKey = (e) => {
      if (e.key === 'Escape') this.#act(OverlayAction.ESCAPE);
    };
    doc.addEventListener('keydown', onKey);
    const offs = [
      this.eventBus.on(Events.LEVEL_WON, () => this.#schedule(OverlayState.WIN)),
      this.eventBus.on(Events.LEVEL_LOST, () => this.#schedule(OverlayState.LOSE)),
      this.eventBus.on(Events.LEVEL_LOADED, () => this.#onLevelLoaded()),
      () => doc.removeEventListener('keydown', onKey),
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
    this.#dropOverlay();
    this.#tweens.clear();
    if (this.#els) {
      const { bar, start, fly } = this.#els;
      for (const el of [bar, start.root, fly, ...Object.values(this.#views).map((view) => view.root)]) el.remove();
    }
    this.#els = null;
    this.#views = null;
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
      const label = String(shownMoney);
      this.#els.moneyLabel.textContent = label;
      if (this.#changed('moneyLength', label.length)) this.#fitText(this.#els.moneyLabel); // only when it can get wider
      if (counting) this.#cue(Cues.COIN);
    }
    this.#followPause(snapshot);
    const playing = snapshot.phase === GamePhase.PLAYING;
    // Usable over a running level, and to close the pause panel; presses while an overlay animates do nothing.
    if (this.#changed('settingsUsable', playing || this.#overlay.state === OverlayState.PAUSE)) {
      settingsButton.disabled = !this.#shown.settingsUsable;
    }
  }

  /**
   * Viewport size changed (main.js, after the Renderer refitted): the styled start screen re-anchors its art and Play
   * button, and the styled HUD and overlays take their sizes from the design frame.
   * @param {{ scale: number, width: number, hud: { h: number }, design: object } | null} [frame] Renderer.screenFrame()
   */
  resize(frame = null) {
    if (!this.#els) return;
    if (frame) this.#frame = frame;
    this.#layoutStart();
    this.#layoutHud();
    if (this.#frame) for (const view of Object.values(this.#views)) view.layout(this.#frame);
  }

  // ---- HUD -------------------------------------------------------------------------------------------------------

  /** Flat v3 bar: settings (three-line icon), "Level N", coins. */
  #flatBar() {
    const { text } = this.config.ui;
    const bar = this.#make('div', 'bar');
    const settingsButton = this.#button('icon-button', '', () => this.#act(OverlayAction.SETTINGS));
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
    const settingsButton = this.#button('hud-settings', '', () => this.#act(OverlayAction.SETTINGS));
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

  /** The HUD piece above the overlay's dim: 'settings' (highlighted), 'coins', or none. Styled HUD only. */
  #raise(piece) {
    const els = this.#els;
    if (!els || !els.styled) return;
    els.settingsButton.classList.toggle('is-raised', piece === 'settings');
    els.coinBar.classList.toggle('is-raised', piece === 'coins');
  }

  #inMenu() {
    return Boolean(this.flow) && this.flow.state === AppState.MENU;
  }

  // ---- start screen ------------------------------------------------------------------------------------------------

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
   * Start screen: the same entrance as the v3 win card (backdrop, card pop with overshoot, then the title and button
   * one after another; the styled screen's card is the art and its only item the button). The styled button then
   * breathes.
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

  // ---- level start, labels, coins ------------------------------------------------------------------------------------

  /**
   * Every level start (next level, restart, retry, Play): whatever overlay was up is gone, and the bar slides in. The
   * slide's transform is dropped once it lands, so the bar stays no stacking context and a raised HUD piece can sit
   * above an overlay's dim.
   */
  #onLevelLoaded() {
    this.#dropOverlay();
    if (this.#inMenu()) return;
    const a = this.config.ui.anim;
    this.#els.bar.hidden = false;
    const slide = this.#animate(this.#els.bar, [{ transform: 'translateY(-110%)' }, { transform: 'translateY(0)' }], a.hudInMs, a.overshoot);
    if (slide) slide.finished.then(() => slide.cancel(), () => {});
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

  /** Count the shown coins up to `target` once the flying reward lands, then punch the counter. */
  #countMoneyTo(target) {
    const a = this.config.ui.anim;
    const delay = Math.max(0, this.#flyLandsAt - now());
    this.#tweens.cancelTarget(this.#money);
    this.#tweens.start(this.#money, 'value', this.#money.value, target, a.countUpMs, delay, 'easeOutQuad');
    const el = this.#els.moneyLabel;
    this.#animate(el, [{ transform: 'scale(1)' }, { transform: `scale(${a.moneyPunchScale})`, offset: 0.3 }, { transform: 'scale(1)' }],
      a.moneyPunchMs, a.overshoot, delay);
  }

  // ---- overlays ----------------------------------------------------------------------------------------------------

  /** Styled overlays (Config.ui.overlays): settings, win and lose, each its own container. */
  #styledOverlays(art) {
    const deps = { kit: this.#kit, config: this.config, art, effects: this.effects, onAction: (action) => this.#act(action) };
    return { [OverlayState.PAUSE]: new SettingsPanel(deps), [OverlayState.WIN]: new WinOverlay(deps), [OverlayState.LOSE]: new LoseOverlay(deps) };
  }

  /** Flat v3 cards: the fallback when the overlays' images did not load. */
  #flatOverlays() {
    const deps = { kit: this.#kit, config: this.config, effects: this.effects, onAction: (action) => this.#act(action) };
    return {
      [OverlayState.PAUSE]: new FlatOverlay({ ...deps, kind: 'pause' }),
      [OverlayState.WIN]: new FlatOverlay({ ...deps, kind: 'win' }),
      [OverlayState.LOSE]: new FlatOverlay({ ...deps, kind: 'lose' }),
    };
  }

  /** A player action on the overlays (an overlay button, the HUD settings button, Escape), through the controller. */
  #act(action) {
    if (!this.#els) return;
    const snapshot = this.gameManager.getSnapshot();
    const playing = !this.#inMenu() && snapshot.phase === GamePhase.PLAYING && !this.#starting;
    const result = this.#overlay.press(action, { playing });
    if (!result) return;
    if (result.opens) {
      this.#send(result.command);
      this.#present(result.opens);
    } else if (result.closes) {
      this.#close();
    } else {
      this.#send(result.command);
    }
  }

  /** An OverlayCommand to the game (or the settings' sound toggle). */
  #send(command) {
    const game = this.gameManager;
    if (command === OverlayCommand.PAUSE) game.pause();
    else if (command === OverlayCommand.RESUME) game.resume();
    else if (command === OverlayCommand.RESTART_LEVEL) game.restartLevel();
    else if (command === OverlayCommand.CONTINUE) game.continueToNextLevel();
    else if (command === OverlayCommand.TOGGLE_SOUND) this.#toggleSound();
  }

  /** Put the controller's overlay on screen; its buttons work once it is in. */
  #present(state, data = null) {
    const view = this.#views[state];
    const seq = this.#overlaySeq;
    this.#shownState = state;
    this.#raise(this.#overlay.raised());
    this.#cue(Cues.OVERLAY_IN);
    view.show(data).then(() => {
      if (seq !== this.#overlaySeq || this.#overlay.state !== state || this.#overlay.closing) return;
      this.#overlay.entered();
      view.setEnabled(true);
      view.focus();
    });
  }

  /** The overlay's exit (the win's reward flies to the coins meanwhile), then its command. */
  #close() {
    const state = this.#overlay.state;
    const view = this.#views[state];
    const seq = this.#overlaySeq;
    this.#cue(Cues.OVERLAY_OUT);
    if (state === OverlayState.WIN) this.#flyReward(view);
    view.hide().then(() => {
      if (seq !== this.#overlaySeq) return;
      this.#shownState = OverlayState.NONE;
      this.#raise(null);
      const command = this.#overlay.closed();
      if (state !== OverlayState.PAUSE && this.hooks.onResultClosed) this.hooks.onResultClosed();
      this.#send(command);
    });
  }

  /** Whatever overlay is up or leaving is gone at once, with no command (a level loaded underneath, teardown). */
  #dropOverlay() {
    clearTimeout(this.#timer);
    this.#timer = null;
    const state = this.#shownState;
    this.#overlaySeq += 1;
    this.#overlay.reset();
    this.#shownState = OverlayState.NONE;
    if (!this.#views || state === OverlayState.NONE) return;
    this.#views[state].dismiss();
    this.#raise(null);
    if (state !== OverlayState.PAUSE && this.hooks.onResultClosed) this.hooks.onResultClosed();
  }

  /** The win and lose overlays wait ui.timing after LEVEL_WON / LEVEL_LOST, so the last move stays visible. */
  #schedule(state) {
    const { winOverlayDelay, loseOverlayDelay } = this.config.ui.timing;
    clearTimeout(this.#timer);
    const delay = (state === OverlayState.WIN ? winOverlayDelay : loseOverlayDelay) * 1000;
    this.#timer = setTimeout(() => this.#openResult(state), delay);
  }

  #openResult(state) {
    this.#timer = null;
    if (!this.#els || !this.#overlay.open(state)) return;
    const { reward, isLastLevel } = this.gameManager.getSnapshot().progress;
    this.#present(state, { reward, isLastLevel });
    const won = state === OverlayState.WIN;
    this.#cue(won ? Cues.WIN : Cues.LOSE);
    if (won && this.hooks.onWinShown) this.hooks.onWinShown();
  }

  /**
   * The pause panel follows the game: paused by something else (e.g. a debug script) opens it, and a resume from
   * elsewhere closes it, with no command either way.
   */
  #followPause(snapshot) {
    const state = this.#overlay.state;
    if (snapshot.paused && state === OverlayState.NONE && !this.#overlay.busy && !this.#timer) {
      if (this.#overlay.open(OverlayState.PAUSE)) this.#present(OverlayState.PAUSE);
    } else if (!snapshot.paused && state === OverlayState.PAUSE && !this.#overlay.closing) {
      this.#dropOverlay();
    }
  }

  #toggleSound() {
    if (this.sound) this.sound.toggle();
    this.#renderSoundLabel();
  }

  #renderSoundLabel() {
    this.#views[OverlayState.PAUSE].setSound(!this.sound || this.sound.on, Boolean(this.sound));
  }

  /** "+X" flies from the win overlay's coin to the coins (the coin icon on the styled HUD); the count-up starts when it lands. */
  #flyReward(view) {
    const a = this.config.ui.anim;
    const { fly, moneyLabel, coinIcon } = this.#els;
    const { reward } = this.gameManager.getSnapshot().progress;
    const from = view.flyFrom();
    const to = (coinIcon || moneyLabel).getBoundingClientRect();
    fly.textContent = `+${reward}`;
    if (this.overlayArt) fly.style.fontSize = `${this.config.ui.overlays.typography.reward.size * (view.layoutState ? view.layoutState.scale : 1)}px`;
    fly.hidden = false;
    const x1 = to.left + to.width / 2;
    const y1 = to.top + to.height / 2;
    const at = (x, y, s) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
    const anim = this.#animate(fly, [
      { transform: at(from.x, from.y, 1), opacity: 1 },
      { transform: at((from.x + x1) / 2, Math.min(from.y, y1) - 40, 1.15), opacity: 1, offset: 0.45 },
      { transform: at(x1, y1, 0.6), opacity: 0.2 },
    ], a.flyMs, a.soft);
    this.#flyLandsAt = now() + a.flyMs;
    const hide = () => {
      fly.hidden = true;
    };
    if (anim) anim.finished.then(hide, hide);
    else hide();
  }

  // ---- helpers -----------------------------------------------------------------------------------------------------

  /** A button with the v3 press (UiKit.button); `tap` sends the TAP cue on press. */
  #button(className, label, onClick, tap = true) {
    return this.#kit.button(className, label, onClick, tap);
  }

  #cue(type) {
    this.#kit.cue(type);
  }

  /**
   * Web Animations (UiKit.animate). `track` counts it as a start-screen animation for isAnimating(); `replace` cancels
   * the element's running animations first; `timing` adds options (e.g. a loop).
   * @returns {Animation | null}
   */
  #animate(el, keyframes, duration, easing, delay = 0, track = false, replace = true, timing = null) {
    const anim = this.#kit.animate(el, keyframes, duration, easing, delay, replace, timing);
    if (anim && track) {
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
    return this.#kit.make(tag, className, textContent);
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

  /**
   * Config.ui -> CSS custom properties on root (colours as-is, sizes in px; the styled start screen as --ui-start-*,
   * the styled HUD as --ui-hud-*, the styled overlays as --ui-ov-*, their lengths in artboard px).
   */
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
    const { text: t, focusColor, focusWidth, focusOffset, raisedRing } = this.config.ui.hud;
    style.setProperty('--ui-hud-text-color', t.color);
    style.setProperty('--ui-hud-outline', `${t.outlineWidth}em ${t.outlineColor}`);
    style.setProperty('--ui-hud-shadow', t.shadow);
    style.setProperty('--ui-hud-offset', `${t.offsetY}em`);
    style.setProperty('--ui-hud-focus', `${focusWidth}px solid ${focusColor}`);
    style.setProperty('--ui-hud-focus-offset', `${focusOffset}px`);
    style.setProperty('--ui-hud-raised-ring', raisedRing);
    const o = this.config.ui.overlays;
    const { panel, typography: ty } = o;
    style.setProperty('--ui-ov-backdrop', o.backdrop);
    style.setProperty('--ui-ov-radius', String(panel.radius));
    style.setProperty('--ui-ov-fill', panel.fill);
    style.setProperty('--ui-ov-rim-width', String(panel.rimWidth));
    style.setProperty('--ui-ov-rim-light', panel.rimLight);
    style.setProperty('--ui-ov-rim-dark', panel.rimDark);
    style.setProperty('--ui-ov-glow', panel.glow);
    style.setProperty('--ui-ov-glow-width', String(panel.glowWidth));
    style.setProperty('--ui-ov-glow-blur', String(panel.glowBlur));
    for (const [key, value] of Object.entries(panel.glint)) style.setProperty(`--ui-ov-glint-${kebab(key)}`, typeof value === 'number' ? String(value) : value);
    style.setProperty('--ui-ov-title-fill', ty.title.fill);
    style.setProperty('--ui-ov-title-outline', `${ty.title.outlineWidth}em ${ty.title.outlineColor}`);
    style.setProperty('--ui-ov-title-outline-color', ty.title.outlineColor);
    style.setProperty('--ui-ov-title-shadow', ty.title.shadow);
    for (const key of ['subtitle', 'reward']) {
      style.setProperty(`--ui-ov-${key}-color`, ty[key].color);
      style.setProperty(`--ui-ov-${key}-outline`, `${ty[key].outlineWidth}em ${ty[key].outlineColor}`);
      style.setProperty(`--ui-ov-${key}-shadow`, ty[key].shadow);
    }
    style.setProperty('--ui-ov-bubble-glow', o.lose.bubble.glow);
    style.setProperty('--ui-ov-bubble-glow-blur', String(o.lose.bubble.glowBlur));
  }
}
