import { UnitState } from '../../src/core/Unit.js';

const stateOf = (game, id) => game.getSnapshot().units.find((u) => u.id === id).state;

/**
 * Scripted launch order: every reserve unit in reading order, each launched only after the previous one finished
 * its lap. Returns the ids of units that parked instead of dying (empty = the script worked).
 */
export function playScripted(game, tick = (g) => g.step(), maxTicks = 100000) {
  const parked = [];
  for (const { id } of game.getSnapshot().units) {
    if (!game.activateUnit(id).ok) throw new Error(`could not launch ${id}`);
    for (let i = 0; ![UnitState.DEAD, UnitState.RETURNED].includes(stateOf(game, id)); i += 1) {
      if (i > maxTicks) throw new Error(`${id} never finished its lap`);
      tick(game);
    }
    if (stateOf(game, id) === UnitState.RETURNED) parked.push(id);
  }
  return parked;
}
