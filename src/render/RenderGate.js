/**
 * Render on demand (pure): whether main.js syncs and draws the scene this frame. While the scene is still (the game
 * paused: the presentation clock is frozen; or the opaque styled start screen hides it), a frame is drawn only when
 * what the scene shows changed: the level, the grid or inventory version, the phase or the pause flag (so the frame
 * after pausing still draws the frozen picture), or after invalidate() (a resize cleared the canvas). Otherwise every
 * frame is drawn. It reads those snapshot fields and allocates nothing.
 */
export class RenderGate {
  constructor() {
    this._forced = true;
    this._level = undefined;
    this._grid = -1;
    this._inventory = -1;
    this._phase = undefined;
    this._paused = undefined;
  }

  /** Something outside the snapshot changed the picture (a resize): draw the next frame. */
  invalidate() {
    this._forced = true;
  }

  /**
   * @param {boolean} still  nothing in the scene moves this frame
   * @param {{ levelId: string, phase: string, paused: boolean, grid: { version: number },
   *           inventory: { version: number } }} snapshot
   * @returns {boolean} sync and draw the scene this frame
   */
  shouldDraw(still, snapshot) {
    const changed = snapshot.levelId !== this._level || snapshot.grid.version !== this._grid
      || snapshot.inventory.version !== this._inventory || snapshot.phase !== this._phase || snapshot.paused !== this._paused;
    if (changed) {
      this._level = snapshot.levelId;
      this._grid = snapshot.grid.version;
      this._inventory = snapshot.inventory.version;
      this._phase = snapshot.phase;
      this._paused = snapshot.paused;
    }
    if (!still || changed || this._forced) {
      this._forced = false;
      return true;
    }
    return false;
  }
}
