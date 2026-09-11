import { OverlayBase } from './OverlayBase.js';
import { OverlayAction } from './OverlayController.js';

const pct = (value) => `${value * 100}%`;

/**
 * The lose overlay: "DEFEAT!", "Out of Space!", the sad block (cut from the defeat mockup) in a glass bubble rebuilt in
 * CSS (a radial-gradient body, a static outer glow, two highlight arcs) with small bubbles around it, and Retry, which
 * restarts the level. The v3 soft entrance and the small title shake; the bubble and block float gently while it is up.
 * Inside the art box everything is placed in percentages of the bubble, so only the arcs' line width follows the layout.
 */
export class LoseOverlay extends OverlayBase {
  constructor(deps) {
    super({ ...deps, kind: 'lose' });
    const { text } = this.config.ui;
    const { lose } = this.o;
    const { bubble, block } = lose;
    this.root.setAttribute('aria-label', text.loseTitle);
    this.heading = this.title(text.loseTitle, this.o.titleY);
    this.subtitle = this.text('subtitle', text.loseSubtitle, this.o.subtitleY);
    const { box, loop } = this.artBox({ x: bubble.x, y: bubble.y, width: bubble.size }, 1);
    this.artEl = box;
    this.floatLoop = loop;

    const body = this.kit.make('div', 'ov-bubble');
    body.style.background = bubble.fill;
    this.arcs = bubble.arcs.map((arc) => {
      const el = this.kit.make('span', 'ov-arc');
      el.style.inset = pct(arc.inset);
      el.style.borderTopColor = arc.color;
      el.style.transform = `rotate(${arc.angle}deg)`;
      body.append(el);
      return { el, width: arc.width * bubble.size };
    });
    const smalls = lose.floating.map(([dx, dy, r, kind]) => {
      const el = this.kit.make('span', 'ov-small');
      Object.assign(el.style, { left: pct(0.5 + (dx - r) / 2), top: pct(0.5 + (dy - r) / 2), width: pct(r), height: pct(r), background: lose.smallFill[kind] });
      return el;
    });
    const image = this.art.sadBlock;
    image.className = 'ov-block';
    image.alt = '';
    image.draggable = false;
    const w = block.width / bubble.size;
    const h = w / (image.naturalWidth / image.naturalHeight);
    Object.assign(image.style, {
      width: pct(w),
      height: pct(h),
      left: pct(0.5 + (block.x - bubble.x) / bubble.size - w / 2),
      top: pct(0.5 + (block.y - bubble.y) / bubble.size - h / 2),
    });
    loop.append(...smalls, body, image);
    this.retry = this.button(text.retry, OverlayAction.RETRY, lose.buttonY);
  }

  layout(frame) {
    super.layout(frame);
    if (!this.layoutState) return;
    for (const { el, width } of this.arcs) el.style.borderWidth = `${width * this.layoutState.scale}px`;
  }

  items() {
    return [this.heading, this.subtitle, this.artEl, this.retry];
  }

  enterAnimations() {
    const a = this.config.ui.anim;
    const anims = this.enter({ fromScale: a.loseCardFromScale, easing: a.soft });
    if (!this.reduced) {
      const p = a.shakePx;
      // Added on top of the title's entrance (not replacing it), once that has landed.
      anims.push(this.kit.animate(this.heading, [0, -p, p, -p * 0.6, p * 0.6, -p * 0.25, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        a.shakeMs, 'ease-out', a.cardInMs * 0.35 + a.itemInMs, false));
    }
    return anims;
  }

  startIdle() {
    const drift = this.o.lose.floatPx * this.layoutState.scale;
    this.loop(this.floatLoop, [{ transform: 'translateY(0)' }, { transform: `translateY(${-drift}px)` }], this.o.lose.floatPeriodMs);
  }
}
