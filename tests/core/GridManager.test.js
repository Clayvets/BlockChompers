import { describe, it } from 'vitest';
import { GridManager } from '../../src/core/GridManager.js';
import { Config } from '../../src/config/Config.js';
import { Side } from '../../src/core/Sides.js';
import { SINGLE_LANE, TWO_COLORS_3x3, PADDED_5x5, ASYMMETRIC_4x2, RAGGED, ALL_ZERO } from '../fixtures/grids.js';

describe('GridManager', () => {
  describe('validate', () => {
    it.todo('accepts a rectangular matrix of non-negative integers');
    it.todo('rejects an empty matrix');
    it.todo('rejects a ragged matrix (RAGGED)');
    it.todo('rejects an all-zero matrix (ALL_ZERO) -- a level cannot start already won');
    it.todo('rejects non-integer or negative values');
  });

  describe('load', () => {
    it.todo('deep-copies the matrix so the level file is never mutated');
    it.todo('derives rows/cols and the per-colour histogram');
    it.todo('bumps version');
  });

  describe('peekFromEdge (ASYMMETRIC_4x2 catches row/col swaps)', () => {
    it.todo('N side: lane = column index, walks downward');
    it.todo('S side: lane = column index, walks upward');
    it.todo('W side: lane = row index, walks rightward');
    it.todo('E side: lane = row index, walks leftward');
    it.todo('skips zero padding and returns the first non-empty cell (PADDED_5x5)');
    it.todo('returns null for an empty lane');
  });

  describe('consumeFromEdge', () => {
    it.todo('consumes exactly one block when max = 1 even if deeper blocks match');
    it.todo('returns [] and leaves the grid untouched when the outermost block is another colour');
    it.todo('returns [] for an empty lane');
    it.todo('chains inward until the colour changes when max = Infinity');
    it.todo('bumps version and updates countRemaining on every consume');
  });

  describe('isCleared', () => {
    it.todo('is false while any cell is non-empty');
    it.todo('is true once every block has been consumed');
  });
});
