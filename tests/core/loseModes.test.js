import { describe, it, expect } from 'vitest';
import { createTestGame } from '../helpers/createTestGame.js';
import { captureEvents } from '../helpers/captureEvents.js';
import { JAM_LEVEL, ALL_BLOCKED_LEVEL, WALLED_LEVEL } from '../fixtures/levels.js';
import { GamePhase } from '../../src/core/GameManager.js';
import { Events, LoseReason, RejectReason } from '../../src/core/Events.js';
import { Config } from '../../src/config/Config.js';

const FIVE = ['u0', 'u1', 'u2', 'u3', 'u4'];
const ofType = (events, type) => events.filter((e) => e.type === type).map((e) => e.payload);
const play = (level, loseMode, steps = 24) => {
  const { game, eventBus } = createTestGame({ level, config: { rules: { loseMode } } });
  const events = captureEvents(eventBus);
  for (const id of FIVE) game.activateUnit(id);
  game.step(steps);
  return { game, events };
};

describe("rules.loseMode 'allSlotsBlocked' (default)", () => {
  it('loses with slots_blocked once all 5 slots are blocked, even if a parked unit could be relaunched', () => {
    expect(Config.rules.loseMode).toBe('allSlotsBlocked');
    const { game, events } = play(JAM_LEVEL, 'allSlotsBlocked');
    expect(game.getSnapshot().slots.map((s) => s.status)).toEqual(Array(5).fill('blocked'));
    expect(game.grid.exposedColors()).toEqual([1, 2]); // red and blue parked units could still hit
    expect(game.phase).toBe(GamePhase.LOST);
    expect(game.stepCount).toBe(24);
    expect(ofType(events, Events.LEVEL_LOST)).toEqual([{ reason: LoseReason.SLOTS_BLOCKED }]);
    expect(LoseReason.SLOTS_BLOCKED).toBe('slots_blocked');
  });
});

describe("rules.loseMode 'deadlock'", () => {
  it('keeps playing while a parked unit could hit a block', () => {
    const { game, events } = play(JAM_LEVEL, 'deadlock', 30);
    expect(game.phase).toBe(GamePhase.PLAYING);
    expect(game.isLost()).toBe(false);
    expect(ofType(events, Events.LEVEL_LOST)).toEqual([]);
    expect(game.launchFromSlot(0)).toMatchObject({ ok: true }); // red relaunch eats (1,1)...
    game.step(4);
    expect(game.getSnapshot().slots[0].status).toBe('free'); // ...and dies, freeing its slot
  });

  it('loses with slots_blocked when no parked unit can hit any block', () => {
    const { game, events } = play(ALL_BLOCKED_LEVEL, 'deadlock');
    expect(game.grid.exposedColors()).toEqual([2]); // only blue, and the blue unit is still in the reserve
    expect(game.phase).toBe(GamePhase.LOST);
    expect(ofType(events, Events.LEVEL_LOST)).toEqual([{ reason: LoseReason.SLOTS_BLOCKED }]);
  });
});

describe('out_of_units (both modes)', () => {
  for (const loseMode of ['allSlotsBlocked', 'deadlock']) {
    it(`${loseMode}: reserve empty, nothing moving, blocks left and no parked unit can hit`, () => {
      const { game, eventBus } = createTestGame({ level: WALLED_LEVEL, config: { rules: { loseMode, allowRelaunchParked: false } } });
      const events = captureEvents(eventBus);
      game.activateUnit('u0'); // red parks at 16 in slot 0
      game.activateUnit('u1'); // blue eats all 8 and dies at 14
      game.step(16);
      expect(game.getSnapshot().slots[0].status).toBe('blocked');
      expect(game.getSnapshot().slots[1].status).toBe('free');
      expect(ofType(events, Events.LEVEL_LOST)).toEqual([{ reason: LoseReason.OUT_OF_UNITS }]);
      expect(LoseReason.OUT_OF_UNITS).toBe('out_of_units');
    });
  }
});

describe('end of level', () => {
  it('fires LEVEL_LOST exactly once and blocks further commands until Retry', () => {
    const { game, events } = play(ALL_BLOCKED_LEVEL, 'allSlotsBlocked');
    game.step(10);
    game.update(5);
    expect(ofType(events, Events.LEVEL_LOST)).toHaveLength(1);
    expect(game.activateUnit('u5')).toEqual({ ok: false, reason: RejectReason.NOT_PLAYING });
    expect(game.launchFromSlot(0)).toEqual({ ok: false, reason: RejectReason.NOT_PLAYING });
    expect(game.pause()).toEqual({ ok: false, reason: RejectReason.NOT_PLAYING });
    expect(game.continueToNextLevel()).toEqual({ ok: false, reason: RejectReason.NOT_WON });
    expect(game.restartLevel()).toEqual({ ok: true }); // the "Out of space" card's Retry
    expect(game.phase).toBe(GamePhase.PLAYING);
  });

  it('checks WIN before LOSE when both hold at the end of the same step', () => {
    const { game, eventBus } = createTestGame({ level: ALL_BLOCKED_LEVEL });
    const events = captureEvents(eventBus);
    for (const id of FIVE) game.activateUnit(id);
    game.step(23); // all five are one cell from finishing their lap
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 7; c += 1) game.grid.clearCell(r, c);
    game.step(); // they all park (every slot blocked, nothing moving) and the grid is empty
    expect(game.isLost()).toBe(true); // the lose condition holds...
    expect(game.phase).toBe(GamePhase.WON); // ...but the win is evaluated first
    expect(ofType(events, Events.LEVEL_WON)).toHaveLength(1);
    expect(ofType(events, Events.LEVEL_LOST)).toEqual([]);
  });

  it('rejects an unknown loseMode when the game is built', () => {
    expect(() => createTestGame({ config: { rules: { loseMode: 'sometimes' } } })).toThrow(/loseMode must be one of/);
  });
});
