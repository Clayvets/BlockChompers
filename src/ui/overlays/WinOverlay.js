import { OverlayBase } from './OverlayBase.js';
import { OverlayAction, OverlayController } from './OverlayController.js';

/**
 * The win overlay: "VICTORY!", "LEVEL CLEAR!", the big coin (cut from the victory mockup) that pops in and then bobs,
 * the reward "+X" under it, and Continue ("Play again" after the last level of the cycle). The card pops in with
 * overshoot like the v3 win card, and the confetti rains above it (main.js, through UIManager's hooks). When Continue is
 * pressed the "+X" flies from the coin to the HUD coin (flyFrom()) while the overlay leaves.
 */
export class WinOverlay extends OverlayBase {
  constructor(deps) {
    super({ ...deps, kind: 'win' });
    const { text } = this.config.ui;
    const { win } = this.o;
    this.root.setAttribute('aria-label', text.winTitle);
    this.heading = this.title(text.winTitle, this.o.titleY);
    this.subtitle = this.text('subtitle', text.winSubtitle, this.o.subtitleY);
    const coin = this.art.coin;
    coin.className = 'ov-coin';
    coin.alt = '';
    coin.draggable = false;
    const { box, loop } = this.artBox(win.coin, coin.naturalWidth / coin.naturalHeight);
    loop.append(coin);
    this.coin = coin;
    this.coinBox = box;
    this.coinLoop = loop;
    this.reward = this.text('reward', '', win.rewardY);
    this.action = this.button(text.continue, OverlayAction.CONTINUE, win.buttonY);
  }

  /** @param {{ reward: number, isLastLevel: boolean }} data snapshot.progress */
  fill({ reward, isLastLevel }) {
    this.setText(this.reward, `+${reward}`);
    this.setButtonLabel(this.action, this.config.ui.text[OverlayController.winLabelKey(isLastLevel)]);
  }

  items() {
    return [this.heading, this.subtitle, this.coinBox, this.reward, this.action];
  }

  enterAnimations() {
    const a = this.config.ui.anim;
    const anims = this.enter({ fromScale: a.cardFromScale, easing: a.overshoot });
    // The coin pops as its box enters (the third item).
    anims.push(this.kit.animate(this.coin, [{ transform: `scale(${this.o.win.popFromScale})` }, { transform: 'scale(1)' }],
      a.cardInMs, a.overshoot, a.cardInMs * 0.35 + 2 * a.itemStaggerMs));
    return anims;
  }

  startIdle() {
    const bob = this.o.win.bobPx * this.layoutState.scale;
    this.loop(this.coinLoop, [{ transform: 'translateY(0)' }, { transform: `translateY(${-bob}px)` }], this.o.win.bobPeriodMs);
  }

  /** Where the reward's fly starts: the big coin's centre on screen (CSS px). */
  flyFrom() {
    const r = this.coinBox.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
}
