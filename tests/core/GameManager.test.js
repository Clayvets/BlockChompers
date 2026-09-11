import { describe, it, expect } from 'vitest';
import { createTestGame } from '../helpers/createTestGame.js';
import { captureEvents } from '../helpers/captureEvents.js';
import { runUntil } from '../helpers/runUntil.js';
import {
  SINGLE_LANE_LEVEL, TWO_COLORS_LEVEL, LOSE_ALL_BLOCKED_LEVEL, LOSE_RESERVE_EMPTY_LEVEL, LONE_RUNNER_LEVEL,
  TWO_RUNNERS_LEVEL, SIX_UNITS_LEVEL, WIN_WAITS_LEVEL, CONTENTION_LEVEL, SHIELDED_LEVEL, PADDED_LEVEL,
  BIG_APPETITE_LEVEL, SLOT_MEMORY_LEVEL, MIXED_LEVEL, WALLED_LEVEL,
} from '../fixtures/levels.js';
import { GamePhase } from '../../src/core/GameManager.js';
import { UnitState } from '../../src/core/Unit.js';
import { Events, RejectReason, LoseReason } from '../../src/core/Events.js';

const types = (events) => events.map((e) => e.type);
const unit = (game, id) => game.getSnapshot().units.find((u) => u.id === id);
const finish = (game, max = 100) => runUntil(game, (g) => g.phase !== GamePhase.PLAYING, max);
const consumedBy = (events) => events.filter((e) => e.type === Events.BLOCK_CONSUMED).map((e) => e.payload);

/**
 * Drives the game purely through GameManager: no canvas, no Three.js, no DOM.
 * Test base (createTestGame): speed 1, fixedStep 1, no launch/eat delay => one step == one cell.
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
      expect(events).toEqual([{ type: Events.UNIT_ACTIVATED, payload: { unitId: 'u0', slotIndex: 0 } }]);
    });

    it('rejects with NO_FREE_SLOT when all 5 slots are occupied', () => {
      const { game, eventBus } = createTestGame({ level: SIX_UNITS_LEVEL });
      for (let i = 0; i < 5; i += 1) expect(game.activateUnit(`u${i}`).ok).toBe(true);
      const events = captureEvents(eventBus);
      expect(game.activateUnit('u5')).toEqual({ ok: false, reason: RejectReason.NO_FREE_SLOT });
      expect(events).toEqual([{ type: Events.MOVE_REJECTED, payload: { unitId: 'u5', reason: RejectReason.NO_FREE_SLOT } }]);
    });

    it('rejects with NOT_IN_RESERVE for units that are active, dead or returned', () => {
      const { game } = createTestGame({ level: MIXED_LEVEL });
      game.activateUnit('u0');
      game.activateUnit('u1');
      expect(game.activateUnit('u0')).toEqual({ ok: false, reason: RejectReason.NOT_IN_RESERVE }); // active
      game.step(2); // W row1 is colour 2, W row0 feeds u0 its single block
      expect(unit(game, 'u0').state).toBe(UnitState.DEAD);
      expect(game.activateUnit('u0').reason).toBe(RejectReason.NOT_IN_RESERVE);
      game.step(12); // lap of 14 completes for u1, which never found a target
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
      const { game } = createTestGame({ level: TWO_RUNNERS_LEVEL, config: { track: { launchSpacing: 2 } } });
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
      finish(game);
      expect(game.phase).toBe(GamePhase.LOST);
      expect(game.stepCount).toBe(10);
      expect(unit(game, 'u0')).toMatchObject({ state: UnitState.RETURNED, capacity: 2 });
    });

    it('ignores empty and zero-padded lanes', () => {
      const { game } = createTestGame({ level: PADDED_LEVEL });
      game.activateUnit('u0');
      expect(types(game.step(3))).not.toContain(Events.BLOCK_CONSUMED); // W rows 4, 3, 2: empty, colour 2, empty
      expect(consumedBy(game.step()).map((p) => [p.row, p.col])).toEqual([[1, 1]]);
      finish(game);
      expect(game.stepCount).toBe(16);
      expect(unit(game, 'u0').state).toBe(UnitState.DEAD);
      expect(game.getSnapshot().grid.remaining).toBe(2);
    });

    it('scans each lane exactly once per lap even when one step covers the whole lap', () => {
      const { game } = createTestGame({ level: BIG_APPETITE_LEVEL, config: { track: { speed: 30 } } });
      game.activateUnit('u0');
      const events = game.step();
      expect(consumedBy(events)).toHaveLength(3);
      expect(unit(game, 'u0')).toMatchObject({ state: UnitState.RETURNED, capacity: 2, distanceTraveled: 12, t: 12 });
      expect(game.phase).toBe(GamePhase.WON);
    });

    it('resolves same-lane contention in slot order', () => {
      const { game } = createTestGame({ level: CONTENTION_LEVEL });
      game.activateUnit('u0');
      game.activateUnit('u1');
      const events = game.step();
      expect(consumedBy(events).map((p) => [p.unitId, p.col])).toEqual([['u0', 0], ['u1', 1]]);
      expect(unit(game, 'u0').state).toBe(UnitState.DEAD);
      expect(unit(game, 'u1').capacity).toBe(2);
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

  describe('death and return', () => {
    it('marks the unit DEAD and frees its slot when capacity reaches 0', () => {
      const { game } = createTestGame({ level: LOSE_RESERVE_EMPTY_LEVEL });
      game.activateUnit('u0');
      const events = game.step();
      expect(unit(game, 'u0').state).toBe(UnitState.DEAD);
      expect(game.getSnapshot().slots[0]).toEqual({ index: 0, status: 'free', unitId: null });
      expect(events.find((e) => e.type === Events.UNIT_DIED).payload).toEqual({ unitId: 'u0', slotIndex: 0 });
      expect(events.find((e) => e.type === Events.SLOT_FREED).payload).toEqual({ slotIndex: 0 });
    });

    it('marks the unit RETURNED and blocks its slot after a full lap with capacity > 0', () => {
      const { game } = createTestGame({ level: LONE_RUNNER_LEVEL });
      game.activateUnit('u0');
      game.step(7);
      expect(unit(game, 'u0').state).toBe(UnitState.RUNNING);
      const events = game.step();
      expect(unit(game, 'u0')).toMatchObject({ state: UnitState.RETURNED, capacity: 1, distanceTraveled: 8 });
      expect(game.getSnapshot().slots[0]).toEqual({ index: 0, status: 'blocked', unitId: 'u0' });
      expect(types(events)).toEqual(expect.arrayContaining([Events.UNIT_RETURNED, Events.SLOT_BLOCKED]));
      expect(events.find((e) => e.type === Events.SLOT_BLOCKED).payload).toEqual({ slotIndex: 0, unitId: 'u0' });
    });

    it('returns the unit to the SAME slot it was activated into', () => {
      const { game } = createTestGame({ level: SLOT_MEMORY_LEVEL });
      game.activateUnit('u0'); // slot 0, dies at step 1
      game.activateUnit('u1'); // slot 1, no target, returns at step 10
      finish(game);
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

    it('honours rules.winWaitsForRunners', () => {
      const eager = createTestGame({ level: WIN_WAITS_LEVEL }).game;
      eager.activateUnit('u0');
      eager.activateUnit('u1');
      expect(finish(eager)).toBe(1);
      expect(unit(eager, 'u1').state).toBe(UnitState.RUNNING); // won with runners still out

      const patient = createTestGame({ level: WIN_WAITS_LEVEL, config: { rules: { winWaitsForRunners: true } } }).game;
      patient.activateUnit('u0');
      patient.activateUnit('u1');
      expect(finish(patient)).toBe(8);
      expect(patient.phase).toBe(GamePhase.WON);
      expect(patient.getSnapshot().units.map((u) => u.state)).toEqual([UnitState.RETURNED, UnitState.RETURNED]);
    });

    it('enters LOST when all 5 slots are blocked and no unit is running', () => {
      const { game, eventBus } = createTestGame({ level: LOSE_ALL_BLOCKED_LEVEL });
      const events = captureEvents(eventBus);
      for (let i = 0; i < 5; i += 1) expect(game.activateUnit(`u${i}`).ok).toBe(true);
      expect(finish(game)).toBe(8);
      expect(game.phase).toBe(GamePhase.LOST);
      expect(game.isLost()).toBe(true);
      expect(game.getSnapshot().slots.map((s) => s.status)).toEqual(Array(5).fill('blocked'));
      expect(events.find((e) => e.type === Events.LEVEL_LOST).payload).toEqual({ reason: LoseReason.ALL_SLOTS_BLOCKED });
      expect(game.canActivate('u0')).toEqual({ ok: false, reason: RejectReason.NOT_PLAYING });
    });

    it('enters LOST when the reserve is empty, nothing is running and blocks remain', () => {
      const { game, eventBus } = createTestGame({ level: LOSE_RESERVE_EMPTY_LEVEL });
      const events = captureEvents(eventBus);
      game.activateUnit('u0');
      expect(finish(game)).toBe(1);
      expect(game.phase).toBe(GamePhase.LOST);
      expect(game.getSnapshot().grid.remaining).toBe(1);
      expect(events.find((e) => e.type === Events.LEVEL_LOST).payload).toEqual({ reason: LoseReason.RESERVE_EMPTY });
    });

    it('does NOT lose while a runner is still on the track', () => {
      const { game } = createTestGame({ level: LONE_RUNNER_LEVEL });
      game.activateUnit('u0');
      game.step(7);
      expect(game.phase).toBe(GamePhase.PLAYING);
      expect(game.isLost()).toBe(false);
      game.step();
      expect(game.phase).toBe(GamePhase.LOST);
    });

    it('rejects NO_TARGET and loses with NO_VALID_MOVES when allowNoTargetActivation is off', () => {
      const { game } = createTestGame({ level: LONE_RUNNER_LEVEL, config: { rules: { allowNoTargetActivation: false } } });
      expect(game.activateUnit('u0')).toEqual({ ok: false, reason: RejectReason.NO_TARGET });
      const events = game.step();
      expect(game.phase).toBe(GamePhase.LOST);
      expect(events.find((e) => e.type === Events.LEVEL_LOST).payload).toEqual({ reason: LoseReason.NO_VALID_MOVES });
    });

    it('uses the Simulator dry run when rules.detectDeadEndsEarly is on', () => {
      const relaxed = createTestGame({ level: WALLED_LEVEL }).game;
      relaxed.step();
      expect(relaxed.phase).toBe(GamePhase.PLAYING);
      expect(relaxed.getValidMoves()).toEqual([]);
      const strict = createTestGame({ level: WALLED_LEVEL, config: { rules: { detectDeadEndsEarly: true } } }).game;
      const events = strict.step();
      expect(strict.phase).toBe(GamePhase.LOST);
      expect(events.find((e) => e.type === Events.LEVEL_LOST).payload).toEqual({ reason: LoseReason.NO_VALID_MOVES });
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
      expect(game.phase).toBe(GamePhase.IDLE);
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

    it('records levelWarnings for colour mismatches', () => {
      const level = { id: 'mismatch', grid: [[1, 2]], units: [{ color: 1, capacity: 1 }, { color: 3, capacity: 1 }] };
      expect(createTestGame({ level }).game.levelWarnings).toEqual(['colour 2 has blocks but no unit', 'unit colour 3 has no blocks']);
    });
  });
});
