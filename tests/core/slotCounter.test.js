import { describe, it, expect } from 'vitest';
import { createTestGame } from '../helpers/createTestGame.js';
import { DIE_AND_PARK_LEVEL, TWO_COLORS_LEVEL } from '../fixtures/levels.js';
import { countAvailableSlots } from '../../src/core/InventoryManager.js';
import { Config } from '../../src/config/Config.js';

const counter = (game) => {
  const snapshot = game.getSnapshot();
  const derived = countAvailableSlots(snapshot.units, snapshot.slots.length);
  expect(derived.free).toBe(snapshot.inventory.available); // the pure helper and the snapshot agree
  return `${derived.free}/${derived.total}`;
};

describe('available-slot counter ("N/5" = activeSlots - (moving + parked))', () => {
  it('starts at 5/5, drops by 1 on each launch, rises when a unit dies, and a parked or relaunched unit stays counted', () => {
    const { game } = createTestGame({ level: DIE_AND_PARK_LEVEL });
    const seen = [counter(game)];
    game.activateUnit('u0'); // blue 1 launches
    seen.push(counter(game));
    game.activateUnit('u1'); // red 1 (walled) launches
    seen.push(counter(game));
    game.step(); // u0 eats (2,0) and dies
    seen.push(counter(game));
    game.step(15); // u1 parks in slot 0: still used
    seen.push(counter(game));
    game.launchFromSlot(0); // parked -> moving, slot 0 free: still used
    seen.push(counter(game));
    expect(seen).toEqual(['5/5', '4/5', '3/5', '4/5', '4/5', '4/5']);
    expect(game.getSnapshot().slots.length).toBe(Config.inventory.activeSlots);
  });

  it('counts moving units even though they hold no slot', () => {
    const { game } = createTestGame({ level: TWO_COLORS_LEVEL });
    game.activateUnit('u0');
    game.activateUnit('u1');
    game.step();
    expect(game.getSnapshot().slots.every((s) => s.status === 'free')).toBe(true);
    expect(counter(game)).toBe('3/5');
  });
});
