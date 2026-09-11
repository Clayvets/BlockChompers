import { describe, it, expect } from 'vitest';
import { createTestGame } from '../helpers/createTestGame.js';
import { TWO_COLORS_LEVEL, CONTENTION_LEVEL } from '../fixtures/levels.js';
import { watermelon } from '../../src/core/levels/index.js';
import { UnitState } from '../../src/core/Unit.js';
import { Config } from '../../src/config/Config.js';
import { createGame } from '../../src/core/createGame.js';

const ON_TRACK = new Set([UnitState.RUNNING, UnitState.EATING]);
const unit = (game, id) => game.getSnapshot().units.find((u) => u.id === id);
/** Smallest along-track gap between consecutive on-track units (Infinity with fewer than two). */
const smallestGap = (game) => {
  const run = game.getSnapshot().units.filter((u) => ON_TRACK.has(u.state)).map((u) => u.distanceTraveled).sort((a, b) => b - a);
  return run.slice(1).reduce((min, d, i) => Math.min(min, run[i] - d), Infinity);
};

describe('follow distance (track.launchSpacing)', () => {
  it('holds a runner behind a unit that is eating, never closer than launchSpacing', () => {
    const { game } = createTestGame({ level: TWO_COLORS_LEVEL, config: { track: { launchSpacing: 1 }, timing: { eatDuration: 3 } } });
    game.activateUnit('u0'); // red 5: eats (2,0) at distance 1 in step 1, then pauses 3 steps
    game.activateUnit('u1'); // blue 4: may launch once u0 is 1 cell ahead
    game.step(2);
    expect(unit(game, 'u0')).toMatchObject({ state: UnitState.EATING, distanceTraveled: 1 });
    expect(unit(game, 'u1')).toMatchObject({ state: UnitState.RUNNING, distanceTraveled: 0 }); // held at the gap
    game.step();
    expect(unit(game, 'u1').distanceTraveled).toBe(0); // still waiting while u0 eats
    for (let i = 0; i < 40 && smallestGap(game) !== Infinity; i += 1) {
      game.step();
      expect(smallestGap(game)).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it('with the shipped config, units launched in quick succession never come within launchSpacing', () => {
    const { game } = createGame({ config: Config, level: watermelon });
    let min = Infinity;
    for (let frame = 0; frame < 1600; frame += 1) {
      if (frame % 7 === 0 && frame < 28) game.activateUnit(`u${frame / 7}`); // four fronts, ~120 ms apart
      game.update(1 / 60);
      min = Math.min(min, smallestGap(game));
    }
    expect(Config.track.launchSpacing).toBeGreaterThanOrEqual(Config.render.unitSize);
    expect(min).toBeGreaterThanOrEqual(Config.track.launchSpacing - 1e-9);
  });

  it('launchSpacing 0 keeps pass-through: units launched together share the lane in launch order', () => {
    const { game } = createTestGame({ level: CONTENTION_LEVEL }); // test base: launchSpacing 0
    game.activateUnit('u0');
    game.activateUnit('u1');
    game.step();
    expect(unit(game, 'u0').state).toBe(UnitState.DEAD); // launched first, ate (0,0) first
    expect(unit(game, 'u1')).toMatchObject({ distanceTraveled: 1, capacity: 1 });
  });
});
