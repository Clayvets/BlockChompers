import { Side, INWARD } from './Sides.js';

/** Edge cell where an inward walk starts, per side; `limit` is the valid lane range. */
const EDGE_START = {
  N: (rows, cols, lane) => ({ row: 0, col: lane, limit: cols }),
  S: (rows, cols, lane) => ({ row: rows - 1, col: lane, limit: cols }),
  W: (rows, cols, lane) => ({ row: lane, col: 0, limit: rows }),
  E: (rows, cols, lane) => ({ row: lane, col: cols - 1, limit: rows }),
};

/**
 * Owns the block matrix. Pure data + queries; no rendering, no unit knowledge.
 *
 * Level matrices are number[][]: config.grid.emptyValue (0) = empty, any other positive integer
 * is a colour id. Zero rows/columns are legal padding: those lanes simply have no target.
 * `version` is monotonic for the life of the manager (a reload never resets it).
 */
export class GridManager {
  /** @type {number[][]} */
  #cells = [];
  /** @type {Map<number, number>} colour id -> remaining blocks */
  #colorCounts = new Map();
  #colors = [];
  #remaining = 0;
  #stateCache = null;

  constructor({ config }) {
    this.config = config;
    this.rows = 0;
    this.cols = 0;
    this.version = 0;
  }

  /**
   * Structural validation. Errors: not a non-empty array of rows, ragged, non-integer or negative
   * values, and (unless allowCleared) no blocks at all -- a level cannot start already won.
   * @param {number[][]} matrix
   * @param {{ emptyValue?: number, allowCleared?: boolean }} [opts]
   * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
   */
  static validate(matrix, { emptyValue = 0, allowCleared = false } = {}) {
    if (!Array.isArray(matrix) || matrix.length === 0) {
      return { ok: false, errors: ['matrix must be a non-empty array of rows'], warnings: [] };
    }
    const errors = [];
    const cols = Array.isArray(matrix[0]) ? matrix[0].length : 0;
    if (cols === 0) errors.push('row 0 must be a non-empty array');
    let blocks = 0;
    matrix.forEach((row, r) => {
      if (!Array.isArray(row)) {
        errors.push(`row ${r} is not an array`);
        return;
      }
      if (row.length !== cols) errors.push(`row ${r} has ${row.length} cells, expected ${cols}`);
      row.forEach((value, c) => {
        if (!Number.isInteger(value) || value < 0) errors.push(`cell (${r},${c}) must be a non-negative integer`);
        else if (value !== emptyValue) blocks += 1;
      });
    });
    if (!allowCleared && errors.length === 0 && blocks === 0) {
      errors.push('matrix has no blocks; a level cannot start already cleared');
    }
    return { ok: errors.length === 0, errors, warnings: [] };
  }

  /** Ingest a level matrix: deep copy (the level file is never mutated), rows/cols, colour histogram. */
  load(matrix) {
    const emptyValue = this.config.grid.emptyValue;
    const { ok, errors } = GridManager.validate(matrix, { emptyValue, allowCleared: true });
    if (!ok) throw new Error(`GridManager.load: ${errors.join('; ')}`);
    this.#cells = matrix.map((row) => row.slice());
    this.rows = this.#cells.length;
    this.cols = this.#cells[0].length;
    this.#colorCounts = new Map();
    this.#remaining = 0;
    for (const row of this.#cells) {
      for (const value of row) {
        if (value === emptyValue) continue;
        this.#colorCounts.set(value, (this.#colorCounts.get(value) || 0) + 1);
        this.#remaining += 1;
      }
    }
    this.#colors = [...this.#colorCounts.keys()].sort((a, b) => a - b);
    this.#bump();
  }

  #bump() {
    this.version += 1;
    this.#stateCache = null;
  }

  /** Cell value, or undefined outside the grid. */
  getCell(row, col) {
    return this.isInside(row, col) ? this.#cells[row][col] : undefined;
  }

  isInside(row, col) {
    return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  }

  /**
   * Every cell of a lane ordered from the given edge INWARD (zero padding included); [] for an
   * unknown side or an out-of-range lane.
   * @returns {Array<{ row: number, col: number, value: number }>}
   */
  laneCells(side, laneIndex) {
    const start = EDGE_START[side];
    if (!start) return [];
    const { row, col, limit } = start(this.rows, this.cols, laneIndex);
    if (!Number.isInteger(laneIndex) || laneIndex < 0 || laneIndex >= limit) return [];
    const { dr, dc } = INWARD[side];
    const out = [];
    for (let r = row, c = col; this.isInside(r, c); r += dr, c += dc) out.push({ row: r, col: c, value: this.#cells[r][c] });
    return out;
  }

  /** @returns {{ row: number, col: number, color: number } | null} first non-empty cell walking inward */
  peekFromEdge(side, laneIndex) {
    const emptyValue = this.config.grid.emptyValue;
    for (const cell of this.laneCells(side, laneIndex)) {
      if (cell.value !== emptyValue) return { row: cell.row, col: cell.col, color: cell.value };
    }
    return null;
  }

  /**
   * Repeatedly take the outermost block of the lane while it is `color`, at most `max` times.
   * Returns [] and touches nothing when the outermost block is another colour or the lane is empty.
   * max = Infinity chains inward (gaps are skipped, a different colour stops the chain).
   * @returns {Array<{ row: number, col: number, color: number }>} consumed cells, outermost first
   */
  consumeFromEdge(side, laneIndex, color, { max = 1 } = {}) {
    const consumed = [];
    while (consumed.length < max) {
      const head = this.peekFromEdge(side, laneIndex);
      if (!head || head.color !== color) break;
      this.#clear(head.row, head.col);
      consumed.push(head);
    }
    if (consumed.length > 0) this.#bump();
    return consumed;
  }

  #clear(row, col) {
    const value = this.#cells[row][col];
    if (value === this.config.grid.emptyValue) return false;
    this.#cells[row][col] = this.config.grid.emptyValue;
    this.#colorCounts.set(value, this.#colorCounts.get(value) - 1);
    this.#remaining -= 1;
    return true;
  }

  clearCell(row, col) {
    if (this.isInside(row, col) && this.#clear(row, col)) this.#bump();
  }

  /** Remaining blocks, optionally for one colour. */
  countRemaining(color) {
    return color === undefined ? this.#remaining : this.#colorCounts.get(color) || 0;
  }

  /**
   * Colours that are the first non-empty cell of at least one lane, from any side: exactly what a unit on a
   * full lap could eat. Used by the deadlock (LOSE) check.
   * @returns {number[]} ascending colour ids
   */
  exposedColors() {
    const colors = new Set();
    const lanes = [[Side.N, this.cols], [Side.S, this.cols], [Side.W, this.rows], [Side.E, this.rows]];
    for (const [side, count] of lanes) {
      for (let lane = 0; lane < count; lane += 1) {
        const head = this.peekFromEdge(side, lane);
        if (head) colors.add(head.color);
      }
    }
    return [...colors].sort((a, b) => a - b);
  }

  /** Win condition: a loaded grid with no blocks left. */
  isCleared() {
    return this.rows > 0 && this.#remaining === 0;
  }

  /** Colour ids present at load time, ascending. */
  getColors() {
    return this.#colors.slice();
  }

  /** Deep copy of the current matrix. */
  toMatrix() {
    return this.#cells.map((row) => row.slice());
  }

  /**
   * Memoised per version and deep-frozen, so callers can keep it without copying and any
   * accidental mutation throws instead of corrupting later snapshots.
   * @returns {{ rows: number, cols: number, cells: number[][], remaining: number, version: number }}
   */
  toState() {
    if (!this.#stateCache) {
      const cells = Object.freeze(this.#cells.map((row) => Object.freeze(row.slice())));
      this.#stateCache = Object.freeze({ rows: this.rows, cols: this.cols, cells, remaining: this.#remaining, version: this.version });
    }
    return this.#stateCache;
  }
}
