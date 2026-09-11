import { describe, it, expect } from 'vitest';
import { createTestGame } from '../helpers/createTestGame.js';
import { captureEvents } from '../helpers/captureEvents.js';
import { runUntil } from '../helpers/runUntil.js';
import { SINGLE_LANE_LEVEL, TWO_SINGLES_LEVEL, ALL_BLOCKED_LEVEL } from '../fixtures/levels.js';
import { GamePhase } from '../../src/core/GameManager.js';
import { UnitState } from '../../src/core/Unit.js';
import { Events, RejectReason } from '../../src/core/Events.js';
import { Config } from '../../src/config/Config.js';

const REWARD = Config.progression.rewardPerLevel;
const START = Config.progression.startingMoney;
const types = (events) => events.map((e) => e.type);
const finish = (game) => runUntil(game, (g) => g.phase !== GamePhase.PLAYING, 100);
/** Activates every reserve unit in order and plays to the end: wins SINGLE_LANE / TWO_SINGLES, deadlocks ALL_BLOCKED. */
const playOut = (game) => {
  for (const unit of game.getSnapshot().units) game.activateUnit(unit.id);
  finish(game);
  return game.phase;
};

describe('money and progression through GameManager commands', () => {
  it('exposes progress and paused in the snapshot from the start', () => {
    const { game } = createTestGame({ levels: [SINGLE_LANE_LEVEL, TWO_SINGLES_LEVEL] });
    const snapshot = game.getSnapshot();
    expect(snapshot.paused).toBe(false);
    expect(snapshot.progress).toEqual({
      levelNumber: 1, levelId: SINGLE_LANE_LEVEL.id, levelCount: 2, isLastLevel: false, money: START, reward: REWARD, completed: false, version: 0,
    });
  });

  it('Continue after a win pays the reward, advances and loads the next level', () => {
    const { game, eventBus } = createTestGame({ levels: [SINGLE_LANE_LEVEL, TWO_SINGLES_LEVEL] });
    expect(playOut(game)).toBe(GamePhase.WON);
    const events = captureEvents(eventBus);
    expect(game.continueToNextLevel()).toEqual({ ok: true, reward: REWARD, money: START + REWARD, levelNumber: 2 });

    const snapshot = game.getSnapshot();
    expect(game.level).toBe(TWO_SINGLES_LEVEL);
    expect(snapshot.progress).toMatchObject({ levelNumber: 2, levelId: TWO_SINGLES_LEVEL.id, money: START + REWARD, completed: false });
    expect(snapshot).toMatchObject({ phase: GamePhase.PLAYING, stepCount: 0, paused: false });
    expect(snapshot.grid.cells).toEqual([[1, 1]]);
    expect(snapshot.units.map((u) => u.state)).toEqual([UnitState.RESERVE, UnitState.RESERVE]);
    expect(types(events)).toEqual([Events.MONEY_CHANGED, Events.LEVEL_ADVANCED, Events.PHASE_CHANGED, Events.LEVEL_LOADED]);
    expect(events[0].payload).toEqual({ money: START + REWARD, delta: REWARD, levelNumber: 1 });
    expect(events[1].payload).toEqual({ levelNumber: 2, levelId: TWO_SINGLES_LEVEL.id });
  });

  it('adds the reward once per win', () => {
    const { game } = createTestGame({ levels: [SINGLE_LANE_LEVEL, TWO_SINGLES_LEVEL] });
    expect(game.continueToNextLevel()).toEqual({ ok: false, reason: RejectReason.NOT_WON }); // not won yet
    playOut(game);
    game.continueToNextLevel();
    expect(game.continueToNextLevel()).toEqual({ ok: false, reason: RejectReason.NOT_WON }); // double click
    expect(game.getSnapshot().progress.money).toBe(START + REWARD);
    expect(playOut(game)).toBe(GamePhase.WON); // level 2
    game.continueToNextLevel();
    expect(game.getSnapshot().progress).toMatchObject({ levelNumber: 1, money: START + 2 * REWARD });
  });

  it('Retry after a loss pays nothing and replays the same level', () => {
    const { game } = createTestGame({ levels: [ALL_BLOCKED_LEVEL, SINGLE_LANE_LEVEL] });
    expect(playOut(game)).toBe(GamePhase.LOST);
    expect(game.continueToNextLevel()).toEqual({ ok: false, reason: RejectReason.NOT_WON });
    expect(game.restartLevel()).toEqual({ ok: true });
    const snapshot = game.getSnapshot();
    expect(snapshot.phase).toBe(GamePhase.PLAYING);
    expect(snapshot.progress).toMatchObject({ levelNumber: 1, levelId: ALL_BLOCKED_LEVEL.id, money: START });
    expect(snapshot.grid.cells).toEqual(ALL_BLOCKED_LEVEL.grid);
    expect(snapshot.units.every((u) => u.state === UnitState.RESERVE)).toBe(true);
  });

  it('restarting a won level forfeits the unclaimed reward; winning again pays it once', () => {
    const { game } = createTestGame({ levels: [SINGLE_LANE_LEVEL, TWO_SINGLES_LEVEL] });
    playOut(game);
    game.restartLevel();
    expect(game.getSnapshot().progress).toMatchObject({ levelNumber: 1, money: START });
    playOut(game);
    game.continueToNextLevel();
    expect(game.getSnapshot().progress).toMatchObject({ levelNumber: 2, money: START + REWARD });
  });

  it('after the last level the cycle starts again at Level 1', () => {
    const { game } = createTestGame({ levels: [SINGLE_LANE_LEVEL, TWO_SINGLES_LEVEL] });
    for (let i = 0; i < 2; i += 1) {
      expect(playOut(game)).toBe(GamePhase.WON);
      game.continueToNextLevel();
    }
    expect(game.level).toBe(SINGLE_LANE_LEVEL);
    expect(game.getSnapshot().progress).toMatchObject({ levelNumber: 1, levelId: SINGLE_LANE_LEVEL.id, isLastLevel: false, money: START + 2 * REWARD });
  });

  it('with a single level, every win is the last one and Continue replays Level 1', () => {
    const { game } = createTestGame({ level: SINGLE_LANE_LEVEL });
    playOut(game);
    expect(game.getSnapshot().progress.isLastLevel).toBe(true);
    expect(game.continueToNextLevel()).toMatchObject({ ok: true, levelNumber: 1 });
    expect(game.getSnapshot()).toMatchObject({ phase: GamePhase.PLAYING, progress: { levelNumber: 1, levelId: SINGLE_LANE_LEVEL.id } });
  });

  it('throws before paying when the next level is invalid', () => {
    const bad = { id: 'greedy', grid: [[1, 1]], units: [{ color: 1, capacity: 3 }] };
    const { game } = createTestGame({ levels: [SINGLE_LANE_LEVEL, bad] });
    playOut(game);
    expect(() => game.continueToNextLevel()).toThrow(/greedy.*exceeds/);
    expect(game.getSnapshot()).toMatchObject({ phase: GamePhase.WON, progress: { levelNumber: 1, money: START } });
  });

  it('restartLevel without a loaded level is rejected', () => {
    expect(createTestGame().game.restartLevel()).toEqual({ ok: false, reason: RejectReason.NO_LEVEL });
  });
});

describe('pause (settings panel)', () => {
  it('freezes update() and step() and rejects activation until resumed', () => {
    const { game, eventBus } = createTestGame({ level: TWO_SINGLES_LEVEL, config: { timing: { maxFrameDt: 100 } } });
    game.activateUnit('u0');
    game.step(); // u0 eats (0,0) and dies; one block and u1 remain
    const events = captureEvents(eventBus);
    expect(game.pause()).toEqual({ ok: true });
    const frozen = JSON.stringify(game.getSnapshot());
    game.update(5);
    expect(game.step(3)).toEqual([]);
    expect(game.activateUnit('u1')).toEqual({ ok: false, reason: RejectReason.PAUSED });
    expect(JSON.stringify(game.getSnapshot())).toBe(frozen);
    expect(game.getSnapshot().paused).toBe(true);

    expect(game.resume()).toEqual({ ok: true });
    expect(game.activateUnit('u1')).toEqual({ ok: true, slotIndex: 0 });
    expect(finish(game)).toBe(1);
    expect(game.phase).toBe(GamePhase.WON);
    expect(types(events).slice(0, 3)).toEqual([Events.GAME_PAUSED, Events.LAUNCH_REJECTED, Events.GAME_RESUMED]);
  });

  it('pause and resume are idempotent, and pause is refused once the level is over', () => {
    const { game, eventBus } = createTestGame({ level: SINGLE_LANE_LEVEL });
    const events = captureEvents(eventBus);
    game.pause();
    game.pause();
    game.resume();
    game.resume();
    expect(types(events)).toEqual([Events.GAME_PAUSED, Events.GAME_RESUMED]);
    playOut(game);
    expect(game.pause()).toEqual({ ok: false, reason: RejectReason.NOT_PLAYING });
    expect(createTestGame().game.pause()).toEqual({ ok: false, reason: RejectReason.NOT_PLAYING });
  });

  it('Restart level from the pause panel unpauses and reloads', () => {
    const { game } = createTestGame({ level: SINGLE_LANE_LEVEL });
    game.activateUnit('u0');
    game.step(2);
    game.pause();
    expect(game.restartLevel()).toEqual({ ok: true });
    expect(game.getSnapshot()).toMatchObject({ paused: false, stepCount: 0, phase: GamePhase.PLAYING });
    expect(game.getSnapshot().grid.cells).toEqual([[1, 1, 1]]);
  });
});
