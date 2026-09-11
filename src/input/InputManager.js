/**
 * Translates pointer input into logical commands. Knows nothing about Three.js: the renderer does
 * the raycast (pick); this class only forwards the result to GameManager.
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

  /** Pointer event -> normalised device coords in [-1, 1]. */
  toNdc(event) {
    // TODO(impl)
    return { x: 0, y: 0 };
  }

  /** if enabled: renderer.pick(ndc) -> kind === 'unit' => gameManager.activateUnit(id). Everything else is ignored. */
  handlePointerDown(event) {
    // TODO(impl)
  }
}
