import { Events } from '../core/Events.js';

const toCss = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

/**
 * DOM overlay (HUD, win/lose panel, restart). Reads snapshots for numbers, listens to
 * LEVEL_WON / LEVEL_LOST / LEVEL_LOADED for the overlay. Never touches Three.js.
 *
 * Copy and colours come from Config.ui (and slot colours from Config.render.slotColors); they are
 * published as CSS custom properties on `root`, and index.html's stylesheet only does layout.
 */
export class UIManager {
  #unbind = null;
  #onRestart = null;
  #els = null;
  #shown = { remaining: null, slots: null };

  /** @param {{ root: HTMLElement, eventBus: import('../core/EventBus.js').EventBus, gameManager: object, config?: object }} deps */
  constructor({ root, eventBus, gameManager, config = gameManager.config }) {
    this.root = root;
    this.eventBus = eventBus;
    this.gameManager = gameManager;
    this.config = config;
  }

  /** Build the HUD/overlay elements inside root and subscribe to the level events. */
  mount() {
    if (this.#els) return;
    const { ui, render } = this.config;
    const vars = {
      '--ui-text': ui.colors.text,
      '--ui-panel': ui.colors.panel,
      '--ui-backdrop': ui.colors.backdrop,
      '--ui-won': ui.colors.won,
      '--ui-lost': ui.colors.lost,
      '--ui-button': ui.colors.button,
      '--ui-button-text': ui.colors.buttonText,
      '--slot-free': toCss(render.slotColors.free),
      '--slot-occupied': toCss(render.slotColors.occupied),
      '--slot-blocked': toCss(render.slotColors.blocked),
    };
    for (const [name, value] of Object.entries(vars)) this.root.style.setProperty(name, value);

    const make = (tag, className, text) => {
      const node = this.root.ownerDocument.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const hud = make('div', 'hud');
    const blocksValue = make('span', 'hud-value', '0');
    const dots = make('span', 'hud-dots');
    const blocksRow = make('div', 'hud-row');
    blocksRow.append(make('span', 'hud-label', `${ui.text.blocksLeft}:`), blocksValue);
    const slotsRow = make('div', 'hud-row');
    slotsRow.append(make('span', 'hud-label', `${ui.text.slots}:`), dots);
    hud.append(blocksRow, slotsRow);

    const overlay = make('div', 'overlay');
    overlay.hidden = true;
    const card = make('div', 'overlay-card');
    const title = make('h2', 'overlay-title');
    const reason = make('p', 'overlay-reason');
    const button = make('button', 'overlay-button', ui.text.restart);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (this.#onRestart) this.#onRestart();
    });
    card.append(title, reason, button);
    overlay.append(card);

    this.root.append(hud, overlay);
    this.#els = { hud, blocksValue, dots, overlay, title, reason, button, make };
    this.#shown = { remaining: null, slots: null };

    const offs = [
      this.eventBus.on(Events.LEVEL_WON, () => this.showWin()),
      this.eventBus.on(Events.LEVEL_LOST, ({ reason: why }) => this.showLose(why)),
      this.eventBus.on(Events.LEVEL_LOADED, () => this.hideOverlay()),
    ];
    this.#unbind = () => offs.forEach((off) => off());
  }

  unmount() {
    if (this.#unbind) this.#unbind();
    this.#unbind = null;
    if (this.#els) {
      this.#els.hud.remove();
      this.#els.overlay.remove();
    }
    this.#els = null;
  }

  /** Per-frame HUD refresh; touches the DOM only when a value changed. */
  update(snapshot) {
    if (!this.#els || !snapshot) return;
    const { remaining } = snapshot.grid;
    if (remaining !== this.#shown.remaining) {
      this.#els.blocksValue.textContent = String(remaining);
      this.#shown.remaining = remaining;
    }
    const slotsKey = snapshot.slots.map((slot) => slot.status).join(',');
    if (slotsKey !== this.#shown.slots) {
      this.#els.dots.replaceChildren(...snapshot.slots.map((slot) => {
        const dot = this.#els.make('span', `dot dot-${slot.status}`);
        dot.title = `${slot.index + 1}: ${slot.status}`;
        return dot;
      }));
      this.#shown.slots = slotsKey;
    }
  }

  showWin() {
    this.#showOverlay('won', this.config.ui.text.won, '');
  }

  showLose(reason) {
    this.#showOverlay('lost', this.config.ui.text.lost, this.config.ui.loseReasons[reason] || '');
  }

  hideOverlay() {
    if (this.#els) this.#els.overlay.hidden = true;
  }

  /** Register the restart callback (main.js passes () => game.reset()). */
  onRestart(callback) {
    this.#onRestart = callback;
  }

  #showOverlay(result, titleText, reasonText) {
    if (!this.#els) return;
    const { overlay, title, reason, button } = this.#els;
    overlay.dataset.result = result;
    title.textContent = titleText;
    reason.textContent = reasonText;
    reason.hidden = !reasonText;
    overlay.hidden = false;
    button.focus();
  }
}
