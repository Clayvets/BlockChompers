import { containRect } from './layout/containRect.js';

/**
 * Gameplay background art (Config.render.backgroundArt), in the DOM beneath the transparent game canvas: the image is
 * contained in the portrait design frame (layout/containRect.js; never cropped or stretched), and a blurred, darkened
 * cover copy of it fills the rest of the viewport, as on the start screen. layout() follows the Renderer's
 * screenFrame() after every resize.
 */
export class GameBackground {
  #els = null;

  /**
   * @param {{ root: HTMLElement, config: object, image: HTMLImageElement }} deps root: the #game-bg element,
   *   config: Config.render.backgroundArt, image: the decoded art (AssetLoader.loadImage)
   */
  constructor({ root, config, image }) {
    this.root = root;
    this.config = config;
    this.image = image;
  }

  mount() {
    if (this.#els) return;
    const { backdrop } = this.config;
    const doc = this.root.ownerDocument;
    const blur = doc.createElement('div');
    blur.className = 'game-bg-blur';
    blur.style.backgroundImage = `url("${this.image.src}")`;
    blur.style.filter = `blur(${backdrop.blurPx}px) brightness(${backdrop.brightness}) saturate(${backdrop.saturate})`;
    blur.style.transform = `scale(${backdrop.scale})`;
    const art = this.image;
    art.className = 'game-bg-art';
    art.alt = '';
    art.draggable = false;
    this.root.style.backgroundColor = backdrop.color;
    this.root.append(blur, art);
    this.root.hidden = false;
    this.#els = { blur, art };
  }

  /** @param {{ design: { x: number, y: number, w: number, h: number } } | null} frame Renderer.screenFrame() */
  layout(frame) {
    if (!this.#els || !frame) return;
    const { design } = frame;
    const rect = containRect({ x: design.x, y: design.y, width: design.w, height: design.h },
      { width: this.image.naturalWidth, height: this.image.naturalHeight });
    const { style } = this.#els.art;
    style.left = `${rect.x}px`;
    style.top = `${rect.y}px`;
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
    // Fade the edges that have the blurred copy beside them (not those at the viewport's edge), so there is no seam.
    const f = this.config.edgeFade * 100;
    const fade = (dir, on) => (on ? `linear-gradient(${dir}, transparent, #000 ${f}%, #000 ${100 - f}%, transparent)` : 'linear-gradient(#000, #000)');
    const mask = `${fade('to bottom', rect.y > 0.5 || rect.y + rect.height < frame.height - 0.5)}, ${fade('to right', rect.x > 0.5 || rect.x + rect.width < frame.width - 0.5)}`;
    style.maskImage = mask;
    style.maskComposite = 'intersect';
    style.webkitMaskImage = mask;
    style.webkitMaskComposite = 'source-in';
  }

  unmount() {
    if (!this.#els) return;
    this.#els.blur.remove();
    this.#els.art.remove();
    this.root.hidden = true;
    this.#els = null;
  }
}
