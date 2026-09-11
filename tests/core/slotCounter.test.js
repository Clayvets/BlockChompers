import { describe, it, expect } from 'vitest';
import { createTestGame } from '../helpers/createTestGame.js';
import { captureEvents } from '../helpers/captureEvents.js';
import { DIE_AND_PARK_LEVEL } from '../fixtures/levels.js';
import { countFreeSlots } from '../../src/core/InventoryManager.js';
import { Events } from '../../src/core/Events.js';
import { Config } from '../../src/config/Config.js';

const slots = (...statuses) => statuses.map((status, index) => ({ index, status, unitId: status === 'free' ? null : `u${index}` }));
const counter = (game) => countFreeSlots(game.getSnapshot().slots);

describe('available-slot counter ("N/5")', () => {
  it('counts only FREE slots; occupied (moving) and blocked (parked) slots are used', () => {
    expect(countFreeSlots(slots('free', 'free', 'free', 'free', 'free'))).toEqual({ free: 5, total: 5 });
    expect(countFreeSlots(slots('occupied', 'free', 'free', 'free', 'free'))).toEqual({ free: 4, total: 5 });
    expect(countFreeSlots(slots('blocked', 'occupied', 'free', 'blocked', 'free'))).toEqual({ free: 2, total: 5 });
    expect(countFreeSlots(slots('blocked', 'blocked', 'blocked', 'blocked', 'blocked'))).toEqual({ free: 0, total: 5 });
    expect(countFreeSlots([])).toEqual({ free: 0, total: 0 });
  });

  it('starts at 5/5, drops when a unit takes a slot, rises when one dies, and a parked unit stays counted', () => {
    const { game, eventBus } = createTestGame({ level: DIE_AND_PARK_LEVEL });
    const events = captureEvents(eventBus);
    const seen = [counter(game)];
    game.activateUnit('u0'); // blue 1 -> slot 0
    seen.push(counter(game));
    game.activateUnit('u1'); // red 1 (walled) -> slot 1
    seen.push(counter(game));
    game.step(); // u0 eats (2,0) and dies: slot 0 free again
    seen.push(counter(game));
    game.step(15); // u1 parks: slot 1 blocked, still used
    seen.push(counter(game));
    game.launchFromSlot(1); // parked -> occupied: still used
    seen.push(counter(game));
    expect(seen.map(({ free, total }) => `${free}/${total}`)).toEqual(['5/5', '4/5', '3/5', '4/5', '4/5', '4/5']);
    expect(seen[0].total).toBe(Config.inventory.activeSlots);

    const changes = events.filter((e) => e.type === Events.SLOT_STATE_CHANGED).map((e) => e.payload);
    expect(changes.map((c) => `${c.slotIndex}:${c.from}->${c.to}`)).toEqual([
      '0:free->occupied', '1:free->occupied', '0:occupied->free', '1:occupied->blocked', '1:blocked->occupied',
    ]);
    // each event carries the new slot list, so the counter can be derived from the event alone
    expect(changes.map((c) => countFreeSlots(c.slots).free)).toEqual([4, 3, 4, 4, 4]);
  });
});
