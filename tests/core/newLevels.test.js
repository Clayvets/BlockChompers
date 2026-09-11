import { describe, it, expect } from 'vitest';
import { panda, carrot, levelLibrary } from '../../src/core/levels/index.js';
import { GameManager, GamePhase } from '../../src/core/GameManager.js';
import { Config } from '../../src/config/Config.js';
import { createGame } from '../../src/core/createGame.js';
import { createTestGame } from '../helpers/createTestGame.js';
import { playScripted } from '../helpers/playScripted.js';

const countBy = (values) => values.reduce((acc, v) => ({ ...acc, [v]: (acc[v] || 0) + 1 }), {});
const CASES = [
  { level: panda, rows: 24, cols: 22, blocks: { 1: 236, 2: 158, 3: 26 }, units: 15, testSteps: 1173 },
  { level: carrot, rows: 39, cols: 23, blocks: { 1: 236, 2: 77, 3: 201, 4: 11, 5: 99, 6: 8 }, units: 25, testSteps: 2522 },
];

describe.each(CASES)('level: $level.name', ({ level, rows, cols, blocks, units, testSteps }) => {
  it('matches the extracted matrix: size and blocks per colour', () => {
    expect(level.grid).toHaveLength(rows);
    expect(level.grid.every((row) => row.length === cols)).toBe(true);
    expect(countBy(level.grid.flat().filter((v) => v !== 0))).toEqual(blocks);
  });

  it('is pure data with a compact, balanced reserve that passes validation', () => {
    expect(Object.keys(level).sort()).toEqual(['grid', 'id', 'name', 'units']);
    expect(level.units).toHaveLength(units);
    const capacity = {};
    for (const unit of level.units) capacity[unit.color] = (capacity[unit.color] || 0) + unit.capacity;
    expect(capacity).toEqual(blocks);
    expect(GameManager.validateLevel(level, Config)).toEqual({ ok: true, errors: [] });
    expect(levelLibrary[level.id]).toBe(level);
  });

  it('has its palette and a mid-tone background in render config, keyed by id', () => {
    const style = Config.render.levels[level.id];
    expect(style.background).toBe(0x9cc3d5);
    expect(Object.keys(style.palette).map(Number).sort()).toEqual(Object.keys(blocks).map(Number).sort());
  });

  it('plays to WIN with the scripted launch order (test timing)', () => {
    const { game } = createTestGame({ level });
    expect(playScripted(game)).toEqual([]);
    expect(game.phase).toBe(GamePhase.WON);
    expect(game.getSnapshot().grid.remaining).toBe(0);
    expect(game.stepCount).toBe(testSteps);
  });

  it('plays to WIN with the same order under the shipped timing (60 Hz, eat pauses, spacing)', () => {
    const { game } = createGame({ config: Config, level });
    expect(playScripted(game, (g) => g.update(Config.timing.fixedStep))).toEqual([]);
    expect(game.phase).toBe(GamePhase.WON);
  });
});
