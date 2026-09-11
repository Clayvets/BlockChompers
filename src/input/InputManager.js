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
   *           gameManager: { activateUnit(id: string): object, launchFromSlot(slotIndex: number): object } }} deps
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
   * Primary-button press: a front reserve unit => gameManager.activateUnit(id); a parked unit or its slot =>
   * gameManager.launchFromSlot(slotIndex). Nothing else is a raycast target.
   * @returns {{ ok: boolean, reason?: string } | null} the command result, or null when nothing was issued
   */
  handlePointerDown(event) {
    if (!this.#enabled || event.button > 0) return null;
    const { x, y } = this.toNdc(event);
    const hit = this.renderer.pick(x, y);
    if (!hit) return null;
    if (hit.kind === 'unit') return this.gameManager.activateUnit(hit.id);
    if (hit.kind === 'slot') return this.gameManager.launchFromSlot(hit.id);
    return null;
  }
}
