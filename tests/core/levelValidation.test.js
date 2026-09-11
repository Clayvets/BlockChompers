import { describe, it, expect } from 'vitest';
import { GameManager, GamePhase } from '../../src/core/GameManager.js';
import { Config } from '../../src/config/Config.js';
import { createTestGame } from '../helpers/createTestGame.js';
import * as fixtures from '../fixtures/levels.js';

const validate = (grid, units) => GameManager.validateLevel({ id: 'test', grid, units }, Config);
const unit = (color, capacity) => ({ color, capacity });

describe('level validation: per-colour unit capacity must equal the block count', () => {
  it('accepts an exact match for every colour, whether one unit or several carry it', () => {
    expect(validate([[1, 1, 2]], [unit(1, 2), unit(2, 1)])).toEqual({ ok: true, errors: [] });
    expect(validate([[1, 1, 1]], [unit(1, 1), unit(1, 2)])).toEqual({ ok: true, errors: [] });
  });

  it('rejects more capacity than blocks for a colour', () => {
    expect(validate([[1, 1]], [unit(1, 3)])).toEqual({
      ok: false,
      errors: ['colour 1: unit capacity 3 exceeds its 2 block(s) by 1'],
    });
  });

  it('rejects less capacity than blocks for a colour', () => {
    expect(validate([[2, 2, 2]], [unit(2, 1)])).toEqual({
      ok: false,
      errors: ['colour 2: unit capacity 1 is 2 short of its 3 block(s)'],
    });
  });

  it('checks every colour independently and reports each imbalance', () => {
    // colour 1 balanced, colour 2 over by 1, colour 3 (no unit at all) short by 2
    const result = validate([[1, 2, 3, 3]], [unit(1, 1), unit(2, 2)]);
    expect(result.errors).toEqual([
      'colour 2: unit capacity 2 exceeds its 1 block(s) by 1',
      'colour 3: unit capacity 0 is 2 short of its 2 block(s)',
    ]);
  });

  it('treats a colour present on only one side as 0 on the other', () => {
    expect(validate([[1, 2]], [unit(1, 1), unit(3, 1)]).errors).toEqual([
      'colour 2: unit capacity 0 is 1 short of its 1 block(s)',
      'colour 3: unit capacity 1 exceeds its 0 block(s) by 1',
    ]);
  });

  it('counts an omitted capacity as units.defaultCapacity', () => {
    const row = (n) => [Array.from({ length: n }, () => 1)];
    const { defaultCapacity } = Config.units;
    expect(validate(row(defaultCapacity), [{ color: 1 }]).ok).toBe(true);
    expect(validate(row(defaultCapacity + 1), [{ color: 1 }]).errors).toEqual([
      `colour 1: unit capacity ${defaultCapacity} is 1 short of its ${defaultCapacity + 1} block(s)`,
    ]);
  });

  it('reports structural problems instead of a misleading balance error', () => {
    expect(validate([[1]], [unit(1, 0)]).errors).toEqual(['unit 0: capacity must be an integer >= 1']);
    expect(validate([[1]], [{ color: 0, capacity: 1 }]).errors).toEqual(['unit 0: color must be a positive integer']);
    expect(validate([[1, 1], [1]], [unit(1, 3)]).errors).toEqual(['row 1 has 1 cells, expected 2']);
  });

  it('makes loadLevel throw on an unbalanced level before touching any state', () => {
    const { game } = createTestGame();
    expect(() => game.loadLevel({ id: 'greedy', grid: [[1, 1]], units: [unit(1, 3)] })).toThrow(/greedy.*exceeds its 2 block/);
    expect(() => game.loadLevel({ id: 'hungry', grid: [[1, 1]], units: [unit(1, 1)] })).toThrow(/hungry.*1 short of its 2 block/);
    expect(game.phase).toBe(GamePhase.IDLE);
    expect(game.level).toBeNull();
    expect(game.grid.version).toBe(0);
    expect(game.inventory.version).toBe(0);
  });

  it('holds for every test fixture level', () => {
    const levels = Object.entries(fixtures).filter(([, value]) => value && Array.isArray(value.grid));
    expect(levels.length).toBeGreaterThan(0);
    for (const [name, level] of levels) expect([name, GameManager.validateLevel(level, Config)]).toEqual([name, { ok: true, errors: [] }]);
  });
});
