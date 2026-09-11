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

  it('every colour of every level has a render colour (Config.render.levels[id].palette or render.palette)', () => {
    for (const level of levels) {
      const palette = { ...Config.render.palette, ...(Config.render.levels[level.id] || {}).palette };
      const colours = [...new Set(level.grid.flat().filter((v) => v !== Config.grid.emptyValue))];
      expect([level.id, colours.filter((c) => palette[c] === undefined)]).toEqual([level.id, []]);
    }
  });

  it('level files hold only data: id, name, grid, units', () => {
    for (const level of levels) {
      expect(Object.keys(level).sort()).toEqual(['grid', 'id', 'name', 'units']);
      expect(typeof level.name === 'string' && level.name.length > 0).toBe(true);
    }
  });

  it('every level is balanced: per colour, unit capacity equals the block count (GameManager.validateLevel)', () => {
    for (const level of levels) expect([level.id, GameManager.validateLevel(level, Config)]).toEqual([level.id, { ok: true, errors: [] }]);
  });
});
