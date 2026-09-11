import { describe, it, expect } from 'vitest';
import { GridManager } from '../../src/core/GridManager.js';
import { Config } from '../../src/config/Config.js';
import { Side } from '../../src/core/Sides.js';
import { SINGLE_LANE, TWO_COLORS_3x3, PADDED_5x5, ASYMMETRIC_4x2, RAGGED, ALL_ZERO } from '../fixtures/grids.js';

const load = (matrix) => {
  const grid = new GridManager({ config: Config });
  grid.load(matrix);
  return grid;
};

describe('GridManager', () => {
  describe('validate', () => {
    it('accepts a rectangular matrix of non-negative integers', () => {
      expect(GridManager.validate(TWO_COLORS_3x3)).toEqual({ ok: true, errors: [], warnings: [] });
      expect(GridManager.validate(PADDED_5x5).ok).toBe(true);
    });

    it('rejects an empty or non-array matrix', () => {
      expect(GridManager.validate([]).ok).toBe(false);
      expect(GridManager.validate(null).ok).toBe(false);
      expect(GridManager.validate([[]]).ok).toBe(false);
    });

    it('rejects a ragged matrix (RAGGED)', () => {
      const result = GridManager.validate(RAGGED);
      expect(result.ok).toBe(false);
      expect(result.errors.join()).toMatch(/row 1 has 1 cells, expected 2/);
    });

    it('rejects an all-zero matrix unless allowCleared is set', () => {
      expect(GridManager.validate(ALL_ZERO).errors.join()).toMatch(/no blocks/);
      expect(GridManager.validate(ALL_ZERO, { allowCleared: true }).ok).toBe(true);
    });

    it('rejects non-integer or negative values', () => {
      expect(GridManager.validate([[1.5]]).errors.join()).toMatch(/cell \(0,0\)/);
      expect(GridManager.validate([[-1]]).ok).toBe(false);
      expect(GridManager.validate([['1']]).ok).toBe(false);
    });
  });

  describe('load', () => {
    it('deep-copies the matrix so the level file is never mutated', () => {
      const source = [[1, 1, 1]];
      const grid = load(source);
      grid.consumeFromEdge(Side.W, 0, 1);
      expect(source).toEqual([[1, 1, 1]]);
      expect(grid.toMatrix()).toEqual([[0, 1, 1]]);
    });

    it('derives rows/cols and the per-colour histogram', () => {
      const grid = load(ASYMMETRIC_4x2);
      expect([grid.rows, grid.cols]).toEqual([2, 4]);
      expect(grid.countRemaining()).toBe(6);
      expect(grid.countRemaining(1)).toBe(3);
      expect(grid.countRemaining(2)).toBe(3);
      expect(grid.countRemaining(7)).toBe(0);
      expect(grid.getColors()).toEqual([1, 2]);
    });

    it('bumps version, accepts a cleared matrix, and throws on a structurally invalid one', () => {
      const grid = new GridManager({ config: Config });
      expect(grid.version).toBe(0);
      grid.load(SINGLE_LANE);
      expect(grid.version).toBe(1);
      grid.load(ALL_ZERO); // structurally fine; the Simulator loads cleared snapshots
      expect(grid.version).toBe(2);
      expect(grid.isCleared()).toBe(true);
      expect(() => grid.load(RAGGED)).toThrow(/expected 2/);
    });
  });

  describe('lane walks (ASYMMETRIC_4x2 catches row/col swaps)', () => {
    // [[1, 2, 2, 1],
    //  [2, 0, 0, 1]]
    it('N side: lane = column index, walks downward', () => {
      const grid = load(ASYMMETRIC_4x2);
      expect(grid.laneCells(Side.N, 1)).toEqual([{ row: 0, col: 1, value: 2 }, { row: 1, col: 1, value: 0 }]);
      expect(grid.peekFromEdge(Side.N, 1)).toEqual({ row: 0, col: 1, color: 2 });
    });

    it('S side: lane = column index, walks upward', () => {
      const grid = load(ASYMMETRIC_4x2);
      expect(grid.laneCells(Side.S, 1).map((c) => c.row)).toEqual([1, 0]);
      expect(grid.peekFromEdge(Side.S, 1)).toEqual({ row: 0, col: 1, color: 2 }); // skips the empty (1,1)
      expect(grid.peekFromEdge(Side.S, 0)).toEqual({ row: 1, col: 0, color: 2 });
    });

    it('W side: lane = row index, walks rightward', () => {
      const grid = load(ASYMMETRIC_4x2);
      expect(grid.laneCells(Side.W, 1).map((c) => c.col)).toEqual([0, 1, 2, 3]);
      expect(grid.peekFromEdge(Side.W, 1)).toEqual({ row: 1, col: 0, color: 2 });
    });

    it('E side: lane = row index, walks leftward', () => {
      const grid = load(ASYMMETRIC_4x2);
      expect(grid.laneCells(Side.E, 0).map((c) => c.col)).toEqual([3, 2, 1, 0]);
      expect(grid.peekFromEdge(Side.E, 1)).toEqual({ row: 1, col: 3, color: 1 });
    });

    it('skips zero padding and returns the first non-empty cell (PADDED_5x5)', () => {
      const grid = load(PADDED_5x5);
      expect(grid.peekFromEdge(Side.W, 1)).toEqual({ row: 1, col: 1, color: 1 });
      expect(grid.peekFromEdge(Side.N, 3)).toEqual({ row: 1, col: 3, color: 2 });
      expect(grid.peekFromEdge(Side.E, 3)).toEqual({ row: 3, col: 3, color: 1 });
    });

    it('returns null for an empty lane and [] for an out-of-range or unknown one', () => {
      const grid = load(PADDED_5x5);
      expect(grid.peekFromEdge(Side.W, 0)).toBeNull();
      expect(grid.laneCells(Side.N, 5)).toEqual([]);
      expect(grid.laneCells(Side.N, -1)).toEqual([]);
      expect(grid.laneCells('X', 0)).toEqual([]);
      expect(grid.peekFromEdge(Side.N, 9)).toBeNull();
      expect(grid.getCell(9, 9)).toBeUndefined();
    });
  });

  describe('consumeFromEdge', () => {
    it('consumes exactly one block when max = 1 even if deeper blocks match', () => {
      const grid = load(SINGLE_LANE);
      expect(grid.consumeFromEdge(Side.W, 0, 1, { max: 1 })).toEqual([{ row: 0, col: 0, color: 1 }]);
      expect(grid.toMatrix()).toEqual([[0, 1, 1]]);
      expect(grid.consumeFromEdge(Side.W, 0, 1)).toEqual([{ row: 0, col: 1, color: 1 }]); // default max is 1
    });

    it('returns [] and leaves the grid untouched when the outermost block is another colour', () => {
      const grid = load(ASYMMETRIC_4x2);
      const { version } = grid;
      expect(grid.consumeFromEdge(Side.N, 1, 1)).toEqual([]);
      expect(grid.toMatrix()).toEqual(ASYMMETRIC_4x2);
      expect(grid.version).toBe(version);
    });

    it('returns [] for an empty lane', () => {
      expect(load(PADDED_5x5).consumeFromEdge(Side.W, 0, 1)).toEqual([]);
    });

    it('chains inward past gaps until the colour changes when max = Infinity', () => {
      const grid = load([[1, 0, 1, 2, 1]]);
      expect(grid.consumeFromEdge(Side.W, 0, 1, { max: Infinity }).map((c) => c.col)).toEqual([0, 2]);
      expect(grid.toMatrix()).toEqual([[0, 0, 0, 2, 1]]);
      expect(load(SINGLE_LANE).consumeFromEdge(Side.E, 0, 1, { max: Infinity })).toHaveLength(3);
    });

    it('bumps version once per call and keeps remaining in sync', () => {
      const grid = load(SINGLE_LANE);
      const before = grid.toState();
      grid.consumeFromEdge(Side.W, 0, 1, { max: 2 });
      const after = grid.toState();
      expect(after.version).toBe(before.version + 1);
      expect(after.remaining).toBe(1);
      expect(grid.countRemaining(1)).toBe(1);
      expect(grid.toState()).toBe(after); // memoised while unchanged
      expect(Object.isFrozen(after.cells)).toBe(true);
      grid.clearCell(0, 2);
      expect(grid.toState().version).toBe(after.version + 1);
      expect(grid.toState().remaining).toBe(0);
    });
  });

  describe('isCleared', () => {
    it('is false before load and while any cell is non-empty', () => {
      expect(new GridManager({ config: Config }).isCleared()).toBe(false);
      expect(load(SINGLE_LANE).isCleared()).toBe(false);
    });

    it('is true once every block has been consumed', () => {
      const grid = load(SINGLE_LANE);
      grid.consumeFromEdge(Side.W, 0, 1, { max: Infinity });
      expect(grid.isCleared()).toBe(true);
      expect(grid.countRemaining()).toBe(0);
    });
  });
});
