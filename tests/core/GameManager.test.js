import { describe, it, expect } from 'vitest';
import { createTestGame } from '../helpers/createTestGame.js';
import { captureEvents } from '../helpers/captureEvents.js';
import { runUntil } from '../helpers/runUntil.js';
import {
  SINGLE_LANE_LEVEL, TWO_COLORS_LEVEL, CONTENTION_LEVEL, TWO_SINGLES_LEVEL, SHIELDED_LEVEL, PADDED_LEVEL,
  WALLED_LEVEL, DIE_AND_PARK_LEVEL, STACKED_LEVEL, ALL_BLOCKED_LEVEL,
} from '../fixtures/levels.js';
import { GamePhase } from '../../src/core/GameManager.js';
import { UnitState } from '../../src/core/Unit.js';
import { Events, RejectReason, LoseReason } from '../../src/core/Events.js';

const types = (events) => events.map((e) => e.type);
const unit = (game, id) => game.getSnapshot().units.find((u) => u.id === id);
const finish = (game, max = 100) => runUntil(game, (g) => g.phase !== GamePhase.PLAYING, max);
const consumedBy = (events) => events.filter((e) => e.type === Events.BLOCK_CONSUMED).map((e) => e.payload);
const WALLED_BORDER = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]];

/**
 * Drives the game purely through GameManager: no canvas, no Three.js, no DOM.
 * Test base (createTestGame): speed 1, fixedStep 1, no launch/eat delay => one step == one cell.
 * All fixtures are balanced levels (see tests/fixtures/levels.js); units park only when walled in.
 */
describe('GameManager', () => {
  it('constructs and steps without Three.js or a DOM', () => {
    const { game } = createTestGame();
    expect(typeof globalThis.document).toBe('undefined');
    expect(() => game.step()).not.toThrow();
    expect(game.phase).toBe(GamePhase.IDLE);
  });

  describe('activation', () => {
    it('moves a reserve unit into the lowest free slot and emits UNIT_ACTIVATED at once', () => {
      const { game, eventBus } = createTestGame({ level: SINGLE_LANE_LEVEL });
      const events = captureEvents(eventBus);
      expect(game.activateUnit('u0')).toEqual({ ok: true, slotIndex: 0 });
      const u0 = unit(game, 'u0');
      expect(u0.state).toBe(UnitState.ACTIVE);
      expect(u0.slotIndex).toBe(0);
      expect(game.getSnapshot().slots[0]).toEqual({ index: 0, status: 'occupied', unitId: 'u0' });
      expect(events.map((e) => e.type)).toEqual([Events.UNIT_ACTIVATED, Events.SLOT_STATE_CHANGED]);
      expect(events[0].payload).toEqual({ unitId: 'u0', slotIndex: 0 });
      expect(events[1].payload).toMatchObject({ slotIndex: 0, from: 'free', to: 'occupied' });
    });

    it('rejects with NO_FREE_SLOT when all 5 slots are occupied', () => {
      const { game, eventBus } = createTestGame({ level: ALL_BLOCKED_LEVEL });
      for (let i = 0; i < 5; i += 1) expect(game.activateUnit(`u${i}`).ok).toBe(true);
      const events = captureEvents(eventBus);
      expect(game.activateUnit('u5')).toEqual({ ok: false, reason: RejectReason.NO_FREE_SLOT });
      expect(events).toEqual([{ type: Events.LAUNCH_REJECTED, payload: { unitId: 'u5', reason: RejectReason.NO_FREE_SLOT } }]);
    });

    it('rejects with NOT_IN_RESERVE for units that are active, dead or returned', () => {
      const { game } = createTestGame({ level: DIE_AND_PARK_LEVEL });
      game.activateUnit('u0');
      game.activateUnit('u1');
      expect(game.activateUnit('u0')).toEqual({ ok: false, reason: RejectReason.NOT_IN_RESERVE }); // active
      game.step(); // u0 (blue 1) eats (2,0) and dies
      expect(unit(game, 'u0').state).toBe(UnitState.DEAD);
      expect(game.activateUnit('u0').reason).toBe(RejectReason.NOT_IN_RESERVE);
      game.step(15); // u1 (walled red) completes its lap of 16 and parks
      expect(unit(game, 'u1').state).toBe(UnitState.RETURNED);
      expect(game.phase).toBe(GamePhase.PLAYING);
      expect(game.activateUnit('u1').reason).toBe(RejectReason.NOT_IN_RESERVE);
    });

    it('rejects with NOT_PLAYING before a level is loaded and after the level ends', () => {
      expect(createTestGame().game.activateUnit('u0')).toEqual({ ok: false, reason: RejectReason.NOT_PLAYING });
      const { game } = createTestGame({ level: SINGLE_LANE_LEVEL });
      game.activateUnit('u0');
      finish(game);
      expect(game.phase).toBe(GamePhase.WON);
      expect(game.canActivate('u0')).toEqual({ ok: false, reason: RejectReason.NOT_PLAYING });
    });

    it('rejects UNKNOWN_UNIT for an id that does not exist', () => {
      const { game } = createTestGame({ level: SINGLE_LANE_LEVEL });
      expect(game.activateUnit('nope')).toEqual({ ok: false, reason: RejectReason.UNKNOWN_UNIT });
    });

    it('launches the unit at track.entryT after timing.launchDelay and moves in that same step', () => {
      const { game } = createTestGame({ level: SINGLE_LANE_LEVEL, config: { timing: { launchDelay: 2 } } });
      game.activateUnit('u0');
      game.step();
      expect(unit(game, 'u0')).toMatchObject({ state: UnitState.ACTIVE, pose: null });
      const events = game.step();
      expect(events.find((e) => e.type === Events.UNIT_LAUNCHED).payload).toEqual({ unitId: 'u0', t: 0 });
      expect(unit(game, 'u0')).toMatchObject({ state: UnitState.RUNNING, t: 1, distanceTraveled: 1 });
    });

    it('accepts activations while other units are running (pass-through concurrency)', () => {
      const { game } = createTestGame({ level: TWO_COLORS_LEVEL });
      game.activateUnit('u0');
      game.step(2);
      expect(unit(game, 'u0').state).toBe(UnitState.RUNNING);
      expect(game.activateUnit('u1')).toEqual({ ok: true, slotIndex: 1 });
      game.step();
      expect(game.inventory.getRunners().map((u) => u.id)).toEqual(['u0', 'u1']);
    });

    it('holds later launches until the previous runner is track.launchSpacing ahead', () => {
      const { game } = createTestGame({ level: WALLED_LEVEL, config: { track: { launchSpacing: 2 } } });
      game.activateUnit('u0');
      game.activateUnit('u1');
      game.step(2);
      expect(unit(game, 'u1').state).toBe(UnitState.ACTIVE);
      game.step();
      expect(unit(game, 'u1')).toMatchObject({ state: UnitState.RUNNING, distanceTraveled: 1 });
      expect(unit(game, 'u0').distanceTraveled).toBe(3);
    });
  });

  describe('running and consuming', () => {
    it('consumes only the outermost block of its own colour (blocksPerLanePass = 1)', () => {
      const { game } = createTestGame({ level: SINGLE_LANE_LEVEL });
      game.activateUnit('u0');
      const events = game.step();
      expect(game.getSnapshot().grid.cells).toEqual([[0, 1, 1]]);
      expect(unit(game, 'u0').capacity).toBe(2);
      expect(consumedBy(events)).toEqual([{ unitId: 'u0', row: 0, col: 0, color: 1, side: 'W', laneIndex: 0, capacityLeft: 2 }]);
    });

    it('chains inward when rules.blocksPerLanePass is Infinity', () => {
      const { game } = createTestGame({ level: SINGLE_LANE_LEVEL, config: { rules: { blocksPerLanePass: Infinity } } });
      game.activateUnit('u0');
      game.step();
      expect(game.getSnapshot().grid.remaining).toBe(0);
      expect(unit(game, 'u0').state).toBe(UnitState.DEAD);
      expect(game.phase).toBe(GamePhase.WON);
    });

    it('ignores lanes whose outermost block is another colour', () => {
      const { game } = createTestGame({ level: SHIELDED_LEVEL });
      game.activateUnit('u0');
      game.step(3); // W row0 and N col0 both show colour 2 first
      expect(game.getSnapshot().grid.cells).toEqual([[2, 1]]);
      game.step(); // N col1 exposes the colour-1 block
      expect(game.getSnapshot().grid.cells).toEqual([[2, 0]]);
      expect(unit(game, 'u0').state).toBe(UnitState.DEAD);
      game.activateUnit('u1');
      finish(game);
      expect(game.phase).toBe(GamePhase.WON);
      expect(game.stepCount).toBe(5);
    });

    it('ignores empty and zero-padded lanes', () => {
      const { game } = createTestGame({ level: PADDED_LEVEL });
      game.activateUnit('u0');
      expect(types(game.step(3))).not.toContain(Events.BLOCK_CONSUMED); // W rows 4, 3, 2: empty, colour 2, empty
      expect(consumedBy(game.step()).map((p) => [p.row, p.col])).toEqual([[1, 1]]);
      runUntil(game, (g) => unit(g, 'u0').state === UnitState.DEAD);
      expect(game.stepCount).toBe(16);
      expect(game.getSnapshot().grid.remaining).toBe(2);
      expect(game.phase).toBe(GamePhase.PLAYING);
    });

    it('scans each lane exactly once per lap even when one step covers more than a whole lap', () => {
      const { game } = createTestGame({ level: STACKED_LEVEL, config: { track: { speed: 30 } } });
      game.activateUnit('u0');
      const events = game.step(); // 30 cells requested, clamped to the 16-cell lap
      expect(consumedBy(events).map((p) => [p.row, p.col])).toEqual([[1, 0]]); // (1,1) waits behind it on W row1
      expect(unit(game, 'u0')).toMatchObject({ state: UnitState.RETURNED, capacity: 1, distanceTraveled: 16, t: 16 });
      expect(game.phase).toBe(GamePhase.PLAYING);
    });

    it('resolves same-lane contention in slot order', () => {
      const { game } = createTestGame({ level: CONTENTION_LEVEL });
      game.activateUnit('u0');
      game.activateUnit('u1');
      const events = game.step();
      expect(consumedBy(events).map((p) => [p.unitId, p.col])).toEqual([['u0', 0], ['u1', 1]]);
      expect(unit(game, 'u0').state).toBe(UnitState.DEAD);
      expect(unit(game, 'u1').capacity).toBe(1);
    });

    it('pauses on the lane for timing.eatDuration when it is non-zero', () => {
      const { game } = createTestGame({ level: SINGLE_LANE_LEVEL, config: { timing: { eatDuration: 2 } } });
      game.activateUnit('u0');
      game.step(); // eats (0,0) and stops at the lane centre
      expect(unit(game, 'u0')).toMatchObject({ state: UnitState.EATING, t: 1 });
      game.step(); // timer 2 -> 1
      expect(unit(game, 'u0').state).toBe(UnitState.EATING);
      game.step(); // timer -> 0: resumes and moves on
      expect(unit(game, 'u0')).toMatchObject({ state: UnitState.RUNNING, t: 2 });
    });
  });

  describe('death and parking', () => {
    it('marks the unit DEAD and frees its slot when capacity reaches 0', () => {
      const { game } = createTestGame({ level: TWO_SINGLES_LEVEL });
      game.activateUnit('u0');
      const events = game.step();
      expect(unit(game, 'u0').state).toBe(UnitState.DEAD);
      expect(game.getSnapshot().slots[0]).toEqual({ index: 0, status: 'free', unitId: null });
      expect(events.find((e) => e.type === Events.UNIT_DIED).payload).toEqual({ unitId: 'u0', slotIndex: 0 });
      expect(events.find((e) => e.type === Events.SLOT_FREED).payload).toEqual({ slotIndex: 0 });
      expect(game.phase).toBe(GamePhase.PLAYING);
    });

    it('parks the unit (RETURNED) and blocks its slot after a full lap with capacity > 0', () => {
      const { game } = createTestGame({ level: WALLED_LEVEL });
      game.activateUnit('u0'); // red, walled in: nothing to eat
      game.step(15);
      expect(unit(game, 'u0').state).toBe(UnitState.RUNNING);
      const events = game.step();
      expect(unit(game, 'u0')).toMatchObject({ state: UnitState.RETURNED, capacity: 1, distanceTraveled: 16 });
      expect(game.getSnapshot().slots[0]).toEqual({ index: 0, status: 'blocked', unitId: 'u0' });
      expect(types(events)).toEqual(expect.arrayContaining([Events.UNIT_RETURNED, Events.SLOT_BLOCKED]));
      expect(events.find((e) => e.type === Events.SLOT_BLOCKED).payload).toEqual({ slotIndex: 0, unitId: 'u0' });
    });

    it('parks the unit in the SAME slot it was activated into', () => {
      const { game } = createTestGame({ level: DIE_AND_PARK_LEVEL });
      game.activateUnit('u0'); // slot 0, dies at step 1
      game.activateUnit('u1'); // slot 1, walled in, parks at step 16
      game.step(16);
      const { slots } = game.getSnapshot();
      expect(slots[0]).toEqual({ index: 0, status: 'free', unitId: null });
      expect(slots[1]).toEqual({ index: 1, status: 'blocked', unitId: 'u1' });
      expect(unit(game, 'u1').slotIndex).toBe(1);
    });
  });

  describe('win and lose', () => {
    it('enters WON when the matrix is entirely empty', () => {
      const { game, eventBus } = createTestGame({ level: SINGLE_LANE_LEVEL });
      const events = captureEvents(eventBus);
      game.activateUnit('u0');
      expect(finish(game)).toBe(5);
      expect(game.phase).toBe(GamePhase.WON);
      expect(game.isWon()).toBe(true);
      expect(consumedBy(events)).toHaveLength(3);
      expect(events.find((e) => e.type === Events.LEVEL_WON).payload).toEqual({ stepCount: 5 });
      expect(events.find((e) => e.type === Events.PHASE_CHANGED).payload).toEqual({ from: GamePhase.PLAYING, to: GamePhase.WON });
    });

    // In a balanced level the grid only clears once every unit has eaten to 0 (and died), so no runner can be
    // left over; the blocks are removed directly here to exercise the rule on its own.
    it('honours rules.winWaitsForRunners', () => {
      const clearRest = (game) => {
        game.grid.clearCell(0, 1);
        game.grid.clearCell(0, 2);
      };
      const eager = createTestGame({ level: SINGLE_LANE_LEVEL }).game;
      eager.activateUnit('u0');
      eager.step(); // eats (0,0)
      clearRest(eager);
      eager.step();
      expect(eager.phase).toBe(GamePhase.WON);
      expect(unit(eager, 'u0').state).toBe(UnitState.RUNNING); // won with a runner still out

      const patient = createTestGame({ level: SINGLE_LANE_LEVEL, config: { rules: { winWaitsForRunners: true } } }).game;
      patient.activateUnit('u0');
      patient.step();
      clearRest(patient);
      expect(finish(patient)).toBe(11); // waits for the lap of 12 to finish
      expect(patient.phase).toBe(GamePhase.WON);
      expect(unit(patient, 'u0')).toMatchObject({ state: UnitState.RETURNED, capacity: 2 });
    });

    it('enters LOST when all 5 slots are blocked and no unit is running', () => {
      const { game, eventBus } = createTestGame({ level: ALL_BLOCKED_LEVEL });
      const events = captureEvents(eventBus);
      for (let i = 0; i < 5; i += 1) expect(game.activateUnit(`u${i}`).ok).toBe(true);
      expect(finish(game)).toBe(24);
      expect(game.phase).toBe(GamePhase.LOST);
      expect(game.isLost()).toBe(true);
      expect(game.getSnapshot().slots.map((s) => s.status)).toEqual(Array(5).fill('blocked'));
      expect(events.find((e) => e.type === Events.LEVEL_LOST).payload).toEqual({ reason: LoseReason.SLOTS_BLOCKED });
      expect(game.canActivate('u5')).toEqual({ ok: false, reason: RejectReason.NOT_PLAYING });
    });

    it('enters LOST (out of units) when a slot is free, the reserve is empty and relaunching is off', () => {
      const { game, eventBus } = createTestGame({ level: WALLED_LEVEL, config: { rules: { allowRelaunchParked: false } } });
      const events = captureEvents(eventBus);
      game.activateUnit('u0'); // slot 0: checks every lane before u1 opens it, so it parks
      game.activateUnit('u1'); // slot 1: eats all 8 blue and dies at step 14
      expect(finish(game)).toBe(16);
      expect(game.phase).toBe(GamePhase.LOST);
      expect(game.getSnapshot().grid.cells).toEqual([[0, 0, 0], [0, 1, 0], [0, 0, 0]]);
      expect(events.find((e) => e.type === Events.LEVEL_LOST).payload).toEqual({ reason: LoseReason.OUT_OF_UNITS });
    });

    it('does NOT lose while a runner is still on the track', () => {
      const { game } = createTestGame({ level: WALLED_LEVEL, config: { rules: { allowRelaunchParked: false } } });
      game.activateUnit('u0');
      game.activateUnit('u1');
      game.step(15); // reserve empty and u1 dead, but u0 is still running
      expect(unit(game, 'u1').state).toBe(UnitState.DEAD);
      expect(unit(game, 'u0').state).toBe(UnitState.RUNNING);
      expect(game.phase).toBe(GamePhase.PLAYING);
      expect(game.isLost()).toBe(false);
      game.step();
      expect(game.phase).toBe(GamePhase.LOST);
    });

    // A balanced level never exhausts a colour while one of its units waits in the reserve, so the blue
    // blocks are removed directly to reach NO_TARGET.
    it('rejects NO_TARGET with LAUNCH_REJECTED (a unit left in the reserve is not out_of_units)', () => {
      const { game, eventBus } = createTestGame({
        level: DIE_AND_PARK_LEVEL,
        config: { rules: { allowNoTargetActivation: false, allowRelaunchParked: false } },
      });
      game.activateUnit('u0');
      game.activateUnit('u1');
      game.step(16); // u0 died, u1 parked on the red centre; u2 (blue 7) can still act
      expect(game.canActivate('u2')).toEqual({ ok: true });
      for (const [r, c] of WALLED_BORDER) game.grid.clearCell(r, c);
      const events = captureEvents(eventBus);
      expect(game.activateUnit('u2')).toEqual({ ok: false, reason: RejectReason.NO_TARGET });
      expect(events[0]).toEqual({ type: Events.LAUNCH_REJECTED, payload: { unitId: 'u2', reason: RejectReason.NO_TARGET } });
      game.step();
      expect(game.phase).toBe(GamePhase.PLAYING); // out_of_units needs an empty reserve
    });
  });

  describe('determinism', () => {
    const script = (game) => {
      const frames = [];
      game.activateUnit('u0');
      for (let i = 0; i < 40 && game.phase === GamePhase.PLAYING; i += 1) {
        if (i === 3) game.activateUnit('u1');
        frames.push({ events: game.step(), snapshot: game.getSnapshot() });
      }
      return JSON.stringify(frames);
    };

    it('identical commands and steps yield identical snapshots and event sequences', () => {
      const a = script(createTestGame({ level: TWO_COLORS_LEVEL }).game);
      const b = script(createTestGame({ level: TWO_COLORS_LEVEL }).game);
      expect(a).toBe(b);
      expect(a.length).toBeGreaterThan(1000);
    });

    it('update(dt) with an accumulated dt equals the same number of explicit step() calls', () => {
      const config = { timing: { maxFrameDt: 100 } };
      const viaUpdate = createTestGame({ level: SINGLE_LANE_LEVEL, config }).game;
      const viaStep = createTestGame({ level: SINGLE_LANE_LEVEL, config }).game;
      viaUpdate.activateUnit('u0');
      viaStep.activateUnit('u0');
      viaUpdate.update(3);
      viaStep.step(3);
      expect(viaUpdate.stepCount).toBe(3);
      expect(JSON.stringify(viaUpdate.getSnapshot())).toBe(JSON.stringify(viaStep.getSnapshot()));
      viaUpdate.update(0.5);
      viaUpdate.update(0.5); // accumulates to exactly one more step
      expect(viaUpdate.stepCount).toBe(4);
    });

    it('clamps a single frame to timing.maxFrameDt', () => {
      const { game } = createTestGame({ level: SINGLE_LANE_LEVEL, config: { timing: { maxFrameDt: 2 } } });
      game.activateUnit('u0');
      game.update(10);
      expect(game.stepCount).toBe(2);
    });
  });

  describe('snapshot and lifecycle', () => {
    it('is plain JSON with a frozen grid state and poses only for units on the track', () => {
      const { game } = createTestGame({ level: TWO_COLORS_LEVEL });
      game.activateUnit('u0');
      game.step(2);
      const snapshot = game.getSnapshot();
      expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
      expect(Object.isFrozen(snapshot.grid)).toBe(true);
      expect(Object.isFrozen(snapshot.grid.cells[0])).toBe(true);
      expect(() => { snapshot.grid.cells[0][0] = 9; }).toThrow(TypeError);
      expect(unit(game, 'u0').pose).toMatchObject({ facing: 'N', side: 'W' });
      expect(unit(game, 'u1').pose).toBeNull();
      expect(snapshot.track).toMatchObject({ length: 16, entryT: 0, margin: 1, direction: 'cw' });
      expect(snapshot.track.corners).toHaveLength(4);
    });

    it('throws on an invalid level and stays IDLE', () => {
      const { game } = createTestGame();
      expect(() => game.loadLevel({ id: 'bad', grid: [[0, 0]], units: [{ color: 1 }] })).toThrow(/no blocks/);
      expect(() => game.loadLevel({ id: 'bad', grid: [[1]], units: [] })).toThrow(/units/);
      expect(() => game.loadLevel({ id: 'bad', grid: [[1]], units: [{ color: 1, capacity: 0 }] })).toThrow(/capacity/);
      expect(() => game.loadLevel(null)).toThrow(/level must be an object/);
      expect(game.phase).toBe(GamePhase.IDLE);
      expect(game.level).toBeNull();
    });

    it('reset reloads the same level and keeps versions monotonic', () => {
      const { game, eventBus } = createTestGame({ level: SINGLE_LANE_LEVEL });
      game.activateUnit('u0');
      finish(game);
      const { version } = game.grid;
      const events = captureEvents(eventBus);
      game.reset();
      expect(game.phase).toBe(GamePhase.PLAYING);
      expect(game.stepCount).toBe(0);
      expect(game.getSnapshot().grid.cells).toEqual([[1, 1, 1]]);
      expect(game.grid.version).toBeGreaterThan(version);
      expect(types(events)).toEqual([Events.PHASE_CHANGED, Events.LEVEL_LOADED]);
      expect(unit(game, 'u0').state).toBe(UnitState.RESERVE);
    });
  });
});
