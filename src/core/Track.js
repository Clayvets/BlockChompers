import { Side, INWARD, Corner } from './Sides.js';

const CORNER_BY_SIGN = { '-1,-1': Corner.NW, '1,-1': Corner.NE, '1,1': Corner.SE, '-1,1': Corner.SW };

function outwardOf(side) {
  const { dr, dc } = INWARD[side];
  return { dx: 0 - dc, dy: 0 - dr }; // 0 - x avoids a negative zero
}

function facingOf(dx, dy) {
  if (dx > 0) return Side.E;
  if (dx < 0) return Side.W;
  if (dy > 0) return Side.S;
  return Side.N;
}

/** Ring cells clockwise from the NW corner. Grid cell (r, c) has centre (c + 0.5, r + 0.5). */
function buildRing(rows, cols, m) {
  const x0 = -m + 0.5;
  const x1 = cols + m - 0.5;
  const y0 = -m + 0.5;
  const y1 = rows + m - 0.5;

  const make = (x, y, ringSide) => {
    const isCorner = (x === x0 || x === x1) && (y === y0 || y === y1);
    const alongX = ringSide === Side.N || ringSide === Side.S;
    const idx = alongX ? x - 0.5 : y - 0.5;
    const limit = alongX ? cols : rows;
    const laneIndex = !isCorner && Number.isInteger(idx) && idx >= 0 && idx < limit ? idx : null;
    let outward = outwardOf(ringSide);
    let corner = null;
    if (isCorner) {
      const sx = x === x0 ? -1 : 1;
      const sy = y === y0 ? -1 : 1;
      outward = { dx: sx * Math.SQRT1_2, dy: sy * Math.SQRT1_2 };
      corner = CORNER_BY_SIGN[`${sx},${sy}`];
    }
    return { x, y, side: isCorner ? null : ringSide, laneIndex, isCorner, corner, outward, facing: null };
  };

  const cells = [];
  for (let x = x0; x < x1; x += 1) cells.push(make(x, y0, Side.N));
  for (let y = y0; y < y1; y += 1) cells.push(make(x1, y, Side.E));
  for (let x = x1; x > x0; x -= 1) cells.push(make(x, y1, Side.S));
  for (let y = y1; y > y0; y -= 1) cells.push(make(x0, y, Side.W));
  return cells;
}

/**
 * The fixed one-way loop around the OUTSIDE of the grid: an explicit ring of cells at distance
 * `margin`, one cell unit per index. Pure geometry; knows nothing about pixels, meshes or units.
 *
 * length = 2(cols + 2m - 1) + 2(rows + 2m - 1). The ring is built clockwise from the NW corner,
 * reversed for 'ccw', then rotated so the entry corner is index 0 -- so entryT is always 0 and a
 * unit's t equals its distance travelled for the whole lap.
 *
 * A cell has a lane iff its centre projects onto a grid column (N/S) or row (W/E); laneIndex is
 * ALWAYS a grid row/col index, never a track-local one (S and W run backwards relative to t).
 * Corners have side null and no lane.
 */
export class Track {
  #cells;

  /**
   * @param {{ rows: number, cols: number, margin: number, direction?: 'cw'|'ccw',
   *           entry?: { corner: string }, minMargin?: number, epsilon?: number }} opts
   */
  constructor({ rows, cols, margin, direction = 'cw', entry = { corner: Corner.SW }, minMargin = 1, epsilon = 0 }) {
    if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(cols) || cols < 1) {
      throw new RangeError('Track: rows and cols must be integers >= 1');
    }
    if (!Number.isInteger(margin) || margin < minMargin) {
      throw new RangeError(`Track: margin must be an integer >= ${minMargin}`);
    }
    if (direction !== 'cw' && direction !== 'ccw') throw new RangeError(`Track: unknown direction ${direction}`);

    this.rows = rows;
    this.cols = cols;
    this.margin = margin;
    this.direction = direction;
    this.entry = { ...entry };
    this.epsilon = epsilon;

    let cells = buildRing(rows, cols, margin);
    if (direction === 'ccw') cells.reverse();
    const start = cells.findIndex((cell) => cell.corner === this.entry.corner);
    if (start < 0) throw new RangeError(`Track: unknown entry corner ${this.entry.corner}`);
    cells = cells.slice(start).concat(cells.slice(0, start));
    cells.forEach((cell, i) => {
      const next = cells[(i + 1) % cells.length];
      cell.facing = facingOf(next.x - cell.x, next.y - cell.y);
      Object.freeze(cell.outward);
      Object.freeze(cell);
    });
    this.#cells = Object.freeze(cells);
  }

  /** Perimeter length in cell units (= number of ring cells). */
  get length() {
    return this.#cells.length;
  }

  /** Track parameter of the shared entry corner: always 0 by construction. */
  get entryT() {
    return 0;
  }

  #index(k) {
    const n = this.#cells.length;
    return ((k % n) + n) % n;
  }

  /** Wrap any t into [0, length). */
  normalize(t) {
    const n = this.#cells.length;
    const r = t % n;
    if (r < 0) return r + n;
    return r === 0 ? 0 : r;
  }

  /** @returns {number} t after moving `distance` cells in the loop direction (wrapped). */
  advance(t, distance) {
    return this.normalize(t + distance);
  }

  /** The ring cell under t (frozen). */
  cellAt(t) {
    return this.#cells[this.#index(Math.floor(t))];
  }

  /**
   * Position and heading at t, in cell units (origin = grid top-left, y down); linear between cells.
   * @returns {{ x: number, y: number, facing: string, side: string|null, outward: { dx: number, dy: number }, isCorner: boolean }}
   */
  poseAt(t) {
    const i = Math.floor(t);
    const f = t - i;
    const a = this.#cells[this.#index(i)];
    const b = this.#cells[this.#index(i + 1)];
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      facing: a.facing,
      side: a.side,
      outward: { ...a.outward },
      isCorner: a.isCorner,
    };
  }

  /**
   * Distance along the loop -> position on the track path (cell units) and heading. Wrap-safe: any distance is
   * normalised first, so length + d is the same place as d. Positions are linear between neighbouring ring cells,
   * which are always on the path, so a moving unit never cuts a corner.
   * @returns {{ x: number, y: number, facing: string }}
   */
  positionAt(distance) {
    const { x, y, facing } = this.poseAt(this.normalize(distance));
    return { x, y, facing };
  }

  /** @returns {{ side: string, laneIndex: number } | null} the grid lane faced at t, null at corners/margin cells */
  laneAt(t) {
    const cell = this.cellAt(t);
    return cell.laneIndex === null ? null : { side: cell.side, laneIndex: cell.laneIndex };
  }

  /**
   * Lanes whose centre (an integer t) lies in (tFrom, tTo]. tTo is un-normalised and may exceed
   * length; tCenter is returned un-normalised so callers can do arithmetic without wrap logic.
   * This is the ONLY scan trigger: each lane is crossed exactly once per lap.
   * @returns {Array<{ side: string, laneIndex: number, tCenter: number }>}
   */
  lanesCrossed(tFrom, tTo) {
    const out = [];
    for (let k = Math.floor(tFrom) + 1; k <= Math.floor(tTo); k += 1) {
      const cell = this.#cells[this.#index(k)];
      if (cell.laneIndex !== null) out.push({ side: cell.side, laneIndex: cell.laneIndex, tCenter: k });
    }
    return out;
  }

  /** Every lane once, in traversal order from the entry (used by the Simulator). */
  laneSequence() {
    const out = [];
    this.#cells.forEach((cell, k) => {
      if (cell.laneIndex !== null) out.push({ side: cell.side, laneIndex: cell.laneIndex, tCenter: k });
    });
    return out;
  }

  /** A lap is complete when the distance travelled reaches the perimeter length. */
  isLapComplete(distanceTraveled) {
    return distanceTraveled >= this.#cells.length - this.epsilon;
  }

  /** The four corner cells in traversal order from the entry. */
  getCorners() {
    return this.#cells.filter((cell) => cell.isCorner).map(({ x, y, corner }) => ({ x, y, corner }));
  }

  /** Copies of every ring cell in traversal order (debug / renderer guide). */
  getCells() {
    return this.#cells.map((cell) => ({ ...cell, outward: { ...cell.outward } }));
  }
}
