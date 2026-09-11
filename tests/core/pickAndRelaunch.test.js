import { describe, it, expect } from 'vitest';
import { createTestGame } from '../helpers/createTestGame.js';
import { captureEvents } from '../helpers/captureEvents.js';
import { runUntil } from '../helpers/runUntil.js';
import { WALLED_LEVEL, STACKED_LEVEL, ALL_BLOCKED_LEVEL, DEAD_END_LEVEL } from '../fixtures/levels.js';
import { GridManager } from '../../src/core/GridManager.js';
import { GamePhase } from '../../src/core/GameManager.js';
import { UnitState } from '../../src/core/Unit.js';
import { Events, RejectReason, LoseReason } from '../../src/core/Events.js';
import { Config } from '../../src/config/Config.js';

const unit = (game, id) => game.getSnapshot().units.find((u) => u.id === id);
const slot = (game, index) => game.getSnapshot().slots[index];
const finish = (game) => runUntil(game, (g) => g.phase !== GamePhase.PLAYING, 200);
const ofType = (events, type) => events.filter((e) => e.type === type).map((e) => e.payload);

// ALL_BLOCKED reserve (4 columns): row 0 = u0 u1 u2 u3, row 1 = u4 u5 (behind u0 and u1).

describe('front-only picks (inventory.frontOnlyPick)', () => {
  it('rejects a unit that is not at the front of its column with LAUNCH_REJECTED / NOT_FRONT', () => {
    expect(Config.inventory.frontOnlyPick).toBe(true);
    const { game, eventBus } = createTestGame({ level: ALL_BLOCKED_LEVEL });
    const events = captureEvents(eventBus);
    expect(game.canActivate('u4')).toEqual({ ok: false, reason: RejectReason.NOT_FRONT });
    expect(game.activateUnit('u4')).toEqual({ ok: false, reason: RejectReason.NOT_FRONT });
    expect(events).toEqual([{ type: Events.LAUNCH_REJECTED, payload: { unitId: 'u4', reason: RejectReason.NOT_FRONT } }]);
    expect(unit(game, 'u4')).toMatchObject({ state: UnitState.RESERVE, reservePos: { col: 0, row: 1 } });
  });

  it('shifts the column up when its front leaves, making the next unit pickable', () => {
    const { game, eventBus } = createTestGame({ level: ALL_BLOCKED_LEVEL });
    const events = captureEvents(eventBus);
    expect(game.activateUnit('u0')).toEqual({ ok: true, slotIndex: 0 });
    expect(ofType(events, Events.RESERVE_SHIFTED)).toEqual([
      { column: 0, moves: [{ unitId: 'u4', from: { col: 0, row: 1 }, to: { col: 0, row: 0 } }] },
    ]);
    expect(unit(game, 'u4').reservePos).toEqual({ col: 0, row: 0 }); // logic shifts instantly
    expect(unit(game, 'u5').reservePos).toEqual({ col: 1, row: 1 }); // other columns untouched
    expect(game.activateUnit('u4')).toEqual({ ok: true, slotIndex: 1 });
    expect(game.activateUnit('u2')).toMatchObject({ ok: true }); // nothing behind u2: no shift event
    expect(ofType(events, Events.RESERVE_SHIFTED)).toHaveLength(1);
  });

  it('allows any reserve unit when frontOnlyPick is off (the column still closes up)', () => {
    const { game, eventBus } = createTestGame({ level: ALL_BLOCKED_LEVEL, config: { inventory: { frontOnlyPick: false } } });
    const events = captureEvents(eventBus);
    expect(game.activateUnit('u5')).toEqual({ ok: true, slotIndex: 0 });
    expect(ofType(events, Events.RESERVE_SHIFTED)).toEqual([]);
    expect(game.activateUnit('u1')).toEqual({ ok: true, slotIndex: 1 });
  });
});

describe('relaunching parked units (rules.allowRelaunchParked)', () => {
  it('keeps the capacity and the slot, which stays OCCUPIED while the unit moves', () => {
    const { game, eventBus } = createTestGame({ level: STACKED_LEVEL });
    game.activateUnit('u0'); // red 2: one lap reaches only (1,0) -> parks with 1 in slot 0 at step 16
    game.step(16);
    expect(unit(game, 'u0')).toMatchObject({ state: UnitState.RETURNED, capacity: 1, slotIndex: 0 });
    expect(slot(game, 0)).toEqual({ index: 0, status: 'blocked', unitId: 'u0' });
    const events = captureEvents(eventBus);
    expect(game.launchFromSlot(0)).toEqual({ ok: true, unitId: 'u0' });
    expect(events).toEqual([{ type: Events.UNIT_RELAUNCHED, payload: { unitId: 'u0', slotIndex: 0, capacity: 1 } }]);
    expect(slot(game, 0)).toEqual({ index: 0, status: 'occupied', unitId: 'u0' });
    game.step();
    expect(unit(game, 'u0')).toMatchObject({ state: UnitState.RUNNING, capacity: 1, slotIndex: 0, distanceTraveled: 1 });
    expect(slot(game, 0).status).toBe('occupied');
  });

  it('dies at capacity 0 and frees its slot', () => {
    const { game, eventBus } = createTestGame({ level: STACKED_LEVEL });
    game.activateUnit('u0');
    game.step(16);
    game.launchFromSlot(0);
    const events = captureEvents(eventBus);
    game.step(2); // W row1 now shows (1,1) first
    expect(unit(game, 'u0')).toMatchObject({ state: UnitState.DEAD, capacity: 0 });
    expect(slot(game, 0)).toEqual({ index: 0, status: 'free', unitId: null });
    expect(ofType(events, Events.BLOCK_CONSUMED)).toEqual([expect.objectContaining({ unitId: 'u0', row: 1, col: 1 })]);
    expect(ofType(events, Events.SLOT_FREED)).toEqual([{ slotIndex: 0 }]);
  });

  it('parks again in the same slot when it still cannot reach 0', () => {
    const { game } = createTestGame({ level: WALLED_LEVEL });
    game.activateUnit('u0'); // red centre is walled in by blue
    game.step(16);
    game.launchFromSlot(0);
    game.step(16);
    expect(unit(game, 'u0')).toMatchObject({ state: UnitState.RETURNED, capacity: 1, slotIndex: 0 });
    expect(slot(game, 0)).toEqual({ index: 0, status: 'blocked', unitId: 'u0' });
    expect(game.stepCount).toBe(32);
  });

  it('rejects slots without a parked unit, unknown slots, a disabled rule, pause and a finished level', () => {
    const { game, eventBus } = createTestGame({ level: WALLED_LEVEL });
    const events = captureEvents(eventBus);
    expect(game.launchFromSlot(0)).toEqual({ ok: false, reason: RejectReason.NOT_PARKED }); // free
    game.activateUnit('u0');
    expect(game.launchFromSlot(0)).toEqual({ ok: false, reason: RejectReason.NOT_PARKED }); // occupied
    expect(game.launchFromSlot(7)).toEqual({ ok: false, reason: RejectReason.UNKNOWN_SLOT });
    game.step(16);
    game.pause();
    expect(game.launchFromSlot(0)).toEqual({ ok: false, reason: RejectReason.PAUSED });
    expect(events[0]).toEqual({ type: Events.LAUNCH_REJECTED, payload: { slotIndex: 0, reason: RejectReason.NOT_PARKED } });

    const off = createTestGame({ level: WALLED_LEVEL, config: { rules: { allowRelaunchParked: false } } }).game;
    off.activateUnit('u0');
    off.step(16);
    expect(off.launchFromSlot(0)).toEqual({ ok: false, reason: RejectReason.RELAUNCH_DISABLED });

    const { game: over } = createTestGame({ level: ALL_BLOCKED_LEVEL });
    for (const id of ['u0', 'u1', 'u2', 'u3', 'u4']) over.activateUnit(id);
    finish(over);
    expect(over.launchFromSlot(0)).toEqual({ ok: false, reason: RejectReason.NOT_PLAYING });
  });
});

describe('LOSE is a deadlock', () => {
  it('triggers when every slot holds a parked unit whose colour is first on no lane', () => {
    const { game, eventBus } = createTestGame({ level: ALL_BLOCKED_LEVEL });
    const events = captureEvents(eventBus);
    for (const id of ['u0', 'u1', 'u2', 'u3', 'u4']) game.activateUnit(id); // five walled red units
    expect(finish(game)).toBe(24);
    expect(game.getSnapshot().slots.map((s) => s.status)).toEqual(Array(5).fill('blocked'));
    expect(game.grid.exposedColors()).toEqual([2]); // only blue is reachable, and blue waits in the reserve
    expect(game.phase).toBe(GamePhase.LOST);
    expect(ofType(events, Events.LEVEL_LOST)).toEqual([{ reason: LoseReason.SLOTS_BLOCKED }]);
  });

  it('does not trigger while a parked unit could still eat, and relaunching it wins', () => {
    const { game } = createTestGame({ level: WALLED_LEVEL });
    game.activateUnit('u0'); // slot 0 parks at 16: blue was still in the way on every lane it checked
    game.activateUnit('u1'); // blue eats all 8 and dies at 14, uncovering the red centre
    game.step(16);
    expect(game.phase).toBe(GamePhase.PLAYING);
    expect(slot(game, 0)).toEqual({ index: 0, status: 'blocked', unitId: 'u0' });
    expect(game.isLost()).toBe(false); // reserve empty, nothing moving, but red is exposed and u0 is red
    game.launchFromSlot(0);
    expect(finish(game)).toBe(2);
    expect(game.phase).toBe(GamePhase.WON);
    expect(slot(game, 0).status).toBe('free');
  });

  it('recovers from a dead end by relaunching the parked blocker', () => {
    const { game } = createTestGame({ level: DEAD_END_LEVEL });
    game.activateUnit('u0'); // blue 8, never sees an opening on its first lap
    game.activateUnit('u1'); // red 16 eats the outer ring
    game.step(24);
    expect(unit(game, 'u0')).toMatchObject({ state: UnitState.RETURNED, capacity: 8 });
    expect(game.getValidMoves()).toEqual([]); // the reserve unit alone could not reach the centre...
    expect(game.isLost()).toBe(false); // ...but the parked blue unit can now eat the blue ring
    game.launchFromSlot(0);
    runUntil(game, (g) => unit(g, 'u0').state === UnitState.DEAD);
    expect(game.stepCount).toBe(45);
    expect(game.activateUnit('u2')).toEqual({ ok: true, slotIndex: 0 });
    finish(game);
    expect(game.phase).toBe(GamePhase.WON);
    expect(game.stepCount).toBe(48);
  });
});

describe('GridManager.exposedColors', () => {
  it('lists the colours that are first on at least one lane from any side', () => {
    const grid = new GridManager({ config: Config });
    grid.load([
      [2, 2, 2],
      [2, 1, 2],
      [2, 2, 3],
    ]);
    expect(grid.exposedColors()).toEqual([2, 3]);
    grid.clearCell(1, 0);
    expect(grid.exposedColors()).toEqual([1, 2, 3]);
  });
});
