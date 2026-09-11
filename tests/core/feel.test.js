import { describe, it, expect } from 'vitest';
import { createTestGame } from '../helpers/createTestGame.js';
import { captureEvents } from '../helpers/captureEvents.js';
import { runUntil } from '../helpers/runUntil.js';
import { ALL_BLOCKED_LEVEL, WALLED_LEVEL, NESTED_LEVEL } from '../fixtures/levels.js';
import { createGame } from '../../src/core/createGame.js';
import { GamePhase } from '../../src/core/GameManager.js';
import { UnitState } from '../../src/core/Unit.js';
import { Events, RejectReason } from '../../src/core/Events.js';
import { Config } from '../../src/config/Config.js';

const unit = (game, id) => game.getSnapshot().units.find((u) => u.id === id);
const statuses = (game) => game.getSnapshot().slots.map((s) => s.status);
const ofType = (events, type) => events.filter((e) => e.type === type).map((e) => e.payload);
const stepsFor = (ms) => Math.round(ms / 1000 / Config.timing.fixedStep);
/** Shipped Config: real launch flight, acceleration ramp, eat pause, follow distance and final rush. */
const shipped = (level) => createGame({ config: Config, level });

describe('v2: launch straight to the track', () => {
  it('flies from the reserve to the entry for timing.launchToEntryMs, then runs, and never occupies a slot', () => {
    const { game } = shipped(WALLED_LEVEL);
    const launchSteps = stepsFor(Config.timing.launchToEntryMs);
    expect(game.getSnapshot().launchSteps).toBe(launchSteps);
    game.activateUnit('u0');
    for (let i = 1; i < launchSteps; i += 1) {
      game.step();
      expect(unit(game, 'u0')).toMatchObject({ state: UnitState.LAUNCHING, timer: launchSteps - i });
      expect(statuses(game)).toEqual(Array(5).fill('free'));
    }
    game.step();
    expect(unit(game, 'u0')).toMatchObject({ state: UnitState.RUNNING, slotIndex: null, trackSteps: 1 });
    expect(unit(game, 'u0').distanceTraveled).toBeGreaterThan(0);
    expect(statuses(game)).toEqual(Array(5).fill('free'));
  });

  it('is rejected when moving + parked = 5, even with a slot still free', () => {
    const { game, eventBus } = createTestGame({ level: ALL_BLOCKED_LEVEL });
    for (const id of ['u0', 'u1', 'u2', 'u3']) game.activateUnit(id);
    game.step(24); // four walled red units park in slots 0-3
    expect(statuses(game)).toEqual(['blocked', 'blocked', 'blocked', 'blocked', 'free']);
    expect(game.activateUnit('u4')).toEqual({ ok: true }); // 4 parked + 1 moving
    expect(game.getSnapshot().inventory).toMatchObject({ inUse: 5, available: 0 });
    const events = captureEvents(eventBus);
    expect(game.activateUnit('u5')).toEqual({ ok: false, reason: RejectReason.NO_FREE_SLOT });
    expect(events).toEqual([{ type: Events.LAUNCH_REJECTED, payload: { unitId: 'u5', reason: RejectReason.NO_FREE_SLOT } }]);
    expect(statuses(game)[4]).toBe('free'); // the free slot waits for a unit that finishes a lap
  });

  it('a returning unit takes the leftmost FREE slot, not the one it left', () => {
    const { game } = createTestGame({ level: ALL_BLOCKED_LEVEL });
    game.activateUnit('u0');
    game.activateUnit('u1');
    game.step(24); // u0 -> slot 0, u1 -> slot 1
    game.launchFromSlot(1); // u1 leaves slot 1 first...
    game.launchFromSlot(0); // ...then u0 leaves slot 0; both walled, lockstep
    expect(statuses(game)).toEqual(Array(5).fill('free'));
    game.step(24);
    expect(unit(game, 'u1').slotIndex).toBe(0); // launched first, parks first: leftmost free
    expect(unit(game, 'u0').slotIndex).toBe(1);
  });
});

describe('v2: acceleration on entering the track (units.accelMs)', () => {
  it('ramps from units.launchSpeed and reaches track.speed exactly at units.accelMs, never snapping', () => {
    const { game } = shipped(WALLED_LEVEL); // u0 is walled in: it runs a whole lap without eating
    game.activateUnit('u0');
    runUntil(game, (g) => unit(g, 'u0').state === UnitState.RUNNING, 200);
    const accelSteps = stepsFor(Config.units.accelMs);
    expect(accelSteps * Config.timing.fixedStep * 1000).toBeCloseTo(Config.units.accelMs, 6);
    const speeds = [unit(game, 'u0').speed]; // speeds[k - 1] = speed on track step k
    for (let i = 0; i < accelSteps + 5; i += 1) {
      game.step();
      speeds.push(unit(game, 'u0').speed);
    }
    expect(speeds[0]).toBeGreaterThan(Config.units.launchSpeed);
    expect(speeds[0]).toBeLessThan(Config.track.speed / 2);
    for (let k = 1; k < accelSteps; k += 1) expect(speeds[k]).toBeGreaterThan(speeds[k - 1]);
    expect(speeds[accelSteps - 2]).toBeLessThan(Config.track.speed);
    expect(speeds.slice(accelSteps - 1)).toEqual(Array(speeds.length - accelSteps + 1).fill(Config.track.speed));
  });
});

describe('v2: no lane is ever skipped', () => {
  it('scans every lane once per lap at cruise speed and at final-rush speed', () => {
    const { game } = shipped(NESTED_LEVEL);
    const expected = game.track.laneSequence().map((l) => `${l.side}${l.laneIndex}`);
    const scans = [];
    const consume = game.grid.consumeFromEdge.bind(game.grid);
    game.grid.consumeFromEdge = (side, lane, color, opts) => {
      scans.push({ color, lane: `${side}${lane}` });
      return consume(side, lane, color, opts);
    };
    const redLap = () => scans.filter((s) => s.color === 1).map((s) => s.lane);
    const until = (id, state) => runUntil(game, (g) => unit(g, id).state === state, 20000);

    game.activateUnit('u0'); // red, walled in: a full lap at cruise (after its ramp), then it parks
    until('u0', UnitState.RETURNED);
    expect(redLap()).toEqual(expected);
    game.activateUnit('u1'); // blue, walled in by green: parks
    until('u1', UnitState.RETURNED);
    game.activateUnit('u2'); // green is the last reserve unit: final rush; it eats its ring in one lap and dies
    until('u2', UnitState.DEAD);
    expect(game.getSnapshot().finalRush.multiplier).toBe(Config.rules.finalRushSpeedMultiplier);

    scans.length = 0;
    game.launchFromSlot(unit(game, 'u0').slotIndex); // red again, still walled in by blue, now at rush speed
    let top = 0;
    while (unit(game, 'u0').state !== UnitState.RETURNED) {
      game.step();
      top = Math.max(top, unit(game, 'u0').speed);
    }
    expect(redLap()).toEqual(expected);
    expect(top).toBeCloseTo(Config.track.speed * Config.rules.finalRushSpeedMultiplier, 9);
    expect(game.phase).toBe(GamePhase.PLAYING);
  });
});

describe('v2: final rush (rules.finalRushSpeedMultiplier)', () => {
  it('starts exactly once, when the reserve empties, and never before', () => {
    const { game, eventBus } = shipped(NESTED_LEVEL);
    const events = captureEvents(eventBus);
    const rushes = () => ofType(events, Events.FINAL_RUSH_STARTED);
    game.activateUnit('u0');
    game.step(30);
    game.activateUnit('u1');
    game.step(30);
    expect(rushes()).toEqual([]);
    expect(game.getSnapshot().finalRush).toEqual({ active: false, startStep: null, multiplier: 1 });

    game.activateUnit('u2'); // the reserve is now empty
    const { finalRushSpeedMultiplier: multiplier, finalRushRampMs: rampMs } = Config.rules;
    expect(rushes()).toEqual([{ stepCount: 60, multiplier, rampMs }]);
    runUntil(game, (g) => unit(g, 'u0').state === UnitState.RETURNED, 20000);
    game.launchFromSlot(unit(game, 'u0').slotIndex); // a relaunch does not restart it
    game.step(60);
    expect(rushes()).toHaveLength(1);
    expect(game.getSnapshot().finalRush).toMatchObject({ active: true, startStep: 60 });

    game.restartLevel(); // a new attempt gets its own rush, once
    expect(game.getSnapshot().finalRush.active).toBe(false);
    for (const id of ['u0', 'u1', 'u2']) game.activateUnit(id);
    game.step(10);
    expect(rushes()).toHaveLength(2);
  });

  it('ramps up with easing over finalRushRampMs, with no jump, and speeds up units already on the track', () => {
    const { game } = shipped(NESTED_LEVEL);
    game.activateUnit('u0');
    game.activateUnit('u1');
    game.step(120); // both past their acceleration ramp (neither can eat)
    expect(unit(game, 'u0').speed).toBe(Config.track.speed);
    game.activateUnit('u2');
    const rampSteps = stepsFor(Config.rules.finalRushRampMs);
    const max = Config.rules.finalRushSpeedMultiplier;
    const factors = [];
    for (let i = 0; i < rampSteps + 5; i += 1) {
      game.step();
      factors.push(game.getSnapshot().finalRush.multiplier);
    }
    expect(factors[0]).toBeGreaterThan(1);
    expect(factors[0]).toBeLessThan(1.01); // eased start: no instant jump
    for (let k = 1; k < factors.length; k += 1) expect(factors[k]).toBeGreaterThanOrEqual(factors[k - 1]);
    expect(factors[rampSteps - 2]).toBeLessThan(max);
    expect(factors.slice(rampSteps - 1)).toEqual(Array(factors.length - rampSteps + 1).fill(max));
    expect(unit(game, 'u0').speed).toBeCloseTo(Config.track.speed * max, 9); // already on the track: sped up too
  });
});

describe('v2: determinism', () => {
  it('identical command scripts on the shipped config produce deep-equal snapshots every frame', () => {
    const script = () => {
      const { game } = shipped(NESTED_LEVEL);
      const frames = [];
      for (let frame = 0; frame < 1400 && game.phase === GamePhase.PLAYING; frame += 1) {
        if (frame === 0) game.activateUnit('u0');
        if (frame === 4) game.activateUnit('u1'); // queues at the entry behind u0
        if (frame === 420) game.activateUnit('u2'); // final rush
        const parked = game.getSnapshot().slots.find((s) => s.status === 'blocked');
        if (frame === 900 && parked) game.launchFromSlot(parked.index);
        game.update(1 / 60);
        frames.push(game.getSnapshot());
      }
      return frames;
    };
    const a = script();
    const b = script();
    expect(a.length).toBeGreaterThan(900);
    expect(a).toEqual(b);
    expect(a.some((s) => s.finalRush.active)).toBe(true);
    expect(a.some((s) => s.units.some((u) => u.state === UnitState.LAUNCHING))).toBe(true);
  });
});
