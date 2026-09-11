import { describe, it, expect } from 'vitest';
import { levels } from '../../src/core/levels/index.js';
import { GridManager } from '../../src/core/GridManager.js';
import { GameManager } from '../../src/core/GameManager.js';
import { Config } from '../../src/config/Config.js';
import { createTestGame } from '../helpers/createTestGame.js';

describe('shipped levels', () => {
  it('every level has an id, a grid and a unit list', () => {
    expect(levels.length).toBeGreaterThan(0);
    for (const level of levels) {
      expect(typeof level.id).toBe('string');
      expect(Array.isArray(level.grid)).toBe(true);
      expect(Array.isArray(level.units)).toBe(true);
    }
  });

  it('every level passes GridManager.validate', () => {
    for (const level of levels) {
      expect(GridManager.validate(level.grid, { emptyValue: Config.grid.emptyValue })).toEqual({ ok: true, errors: [], warnings: [] });
    }
  });

  it('every level loads into PLAYING and does not start already cleared', () => {
    for (const level of levels) {
      const { game } = createTestGame({ level });
      expect(game.phase).toBe('playing');
      expect(game.getSnapshot().grid.remaining).toBeGreaterThan(0);
    }
  });

  it('every level is balanced: per colour, unit capacity equals the block count (GameManager.validateLevel)', () => {
    for (const level of levels) expect([level.id, GameManager.validateLevel(level, Config)]).toEqual([level.id, { ok: true, errors: [] }]);
  });
});
