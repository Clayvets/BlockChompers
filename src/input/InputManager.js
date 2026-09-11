/**
 * Translates pointer input into logical commands. Knows nothing about Three.js: the renderer does
 * the raycast (pick); this class only forwards unit hits to GameManager.activateUnit.
 */
export class InputManager {
  #enabled = true;
  #onPointerDown = (event) => this.handlePointerDown(event);

  /**
   * @param {{ canvas: HTMLCanvasElement,
   *           renderer: { pick(ndcX: number, ndcY: number): object|null },
   *           gameManager: { activateUnit(id: string): { ok: boolean, reason?: string } } }} deps
   */
  constructor({ canvas, renderer, gameManager }) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.gameManager = gameManager;
  }

  attach() {
    this.canvas.addEventListener('pointerdown', this.#onPointerDown);
  }

  detach() {
    this.canvas.removeEventListener('pointerdown', this.#onPointerDown);
  }

  /** Disable while overlays (win/lose) are up. */
  setEnabled(enabled) {
    this.#enabled = enabled;
  }

  /** Pointer event -> normalised device coords in [-1, 1] (y up). */
  toNdc(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  /**
   * Primary-button press on a unit => gameManager.activateUnit(id). Everything else is ignored.
   * @returns {{ ok: boolean, reason?: string } | null} the command result, or null when nothing was issued
   */
  handlePointerDown(event) {
    if (!this.#enabled || event.button > 0) return null;
    const { x, y } = this.toNdc(event);
    const hit = this.renderer.pick(x, y);
    return hit && hit.kind === 'unit' ? this.gameManager.activateUnit(hit.id) : null;
  }
}
