import { describe, it, expect } from 'vitest';
import { watermelon } from '../../src/core/levels/index.js';
import { GameManager, GamePhase } from '../../src/core/GameManager.js';
import { UnitState } from '../../src/core/Unit.js';
import { Config } from '../../src/config/Config.js';
import { createGame } from '../../src/core/createGame.js';
import { createTestGame } from '../helpers/createTestGame.js';

const countBy = (values) => values.reduce((acc, v) => ({ ...acc, [v]: (acc[v] || 0) + 1 }), {});
const unitState = (game, id) => game.getSnapshot().units.find((u) => u.id === id);

/**
 * Scripted launch order: the reserve in reading order, each unit launched only after the previous one has
 * finished its lap. A unit that parks (RETURNED) instead of dying fails the script.
 */
function playScripted(game, tick) {
  const ids = game.getSnapshot().units.map((u) => u.id);
  for (const id of ids) {
    expect(game.activateUnit(id)).toMatchObject({ ok: true });
    for (let guard = 0; ![UnitState.DEAD, UnitState.RETURNED].includes(unitState(game, id).state); guard += 1) {
      if (guard > 5000) throw new Error(`${id} never finished its lap`);
      tick(game);
    }
    expect([id, unitState(game, id).state, unitState(game, id).capacity]).toEqual([id, UnitState.DEAD, 0]);
  }
  return game;
}

describe('level: watermelon', () => {
  it('matches the pixel art: 17 x 18 with the expected blocks per colour', () => {
    expect(watermelon.grid).toHaveLength(17);
    expect(watermelon.grid.every((row) => row.length === 18)).toBe(true);
    const blocks = countBy(watermelon.grid.flat().filter((v) => v !== 0));
    expect(blocks).toEqual({ 1: 50, 2: 18, 3: 66, 4: 14, 5: 28, 6: 16 });
  });

  it('keeps presentation out of the core level file', () => {
    expect(Object.keys(watermelon).sort()).toEqual(['grid', 'id', 'units']);
    expect(Config.render.levels.watermelon.background).toBe(0xc5ecfb);
  });

  it('has a 4-column reserve whose capacity per colour equals the block count', () => {
    const { reserveCols } = Config.inventory;
    expect(reserveCols).toBe(4);
    expect(watermelon.units).toHaveLength(20); // 5 full reserve rows
    const capacity = {};
    for (const { color, capacity: c } of watermelon.units) capacity[color] = (capacity[color] || 0) + c;
    expect(capacity).toEqual({ 1: 50, 2: 18, 3: 66, 4: 14, 5: 28, 6: 16 });
    expect(GameManager.validateLevel(watermelon, Config)).toEqual({ ok: true, errors: [] });
  });

  it('plays to WIN with the scripted launch order (test timing: one step = one cell)', () => {
    const { game } = createTestGame({ level: watermelon });
    playScripted(game, (g) => g.step());
    expect(game.phase).toBe(GamePhase.WON);
    expect(game.getSnapshot().grid.remaining).toBe(0);
    expect(game.stepCount).toBe(671);
  });

  it('plays to WIN with the same order under the shipped timing (60 Hz, eat pauses, launch delay)', () => {
    const { game } = createGame({ config: Config, level: watermelon });
    playScripted(game, (g) => g.update(Config.timing.fixedStep));
    expect(game.phase).toBe(GamePhase.WON);
    expect(game.getSnapshot().grid.remaining).toBe(0);
  });

  it('is the second level of the progression', async () => {
    const { levels } = await import('../../src/core/levels/index.js');
    expect(levels.map((l) => l.id)).toEqual(['level-01', 'watermelon']);
  });
});
