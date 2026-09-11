import { describe, it, expect } from 'vitest';
import { ProgressManager } from '../../src/core/ProgressManager.js';
import { Config, createConfig } from '../../src/config/Config.js';
import { SINGLE_LANE_LEVEL, TWO_SINGLES_LEVEL, WALLED_LEVEL } from '../fixtures/levels.js';

const LEVELS = [SINGLE_LANE_LEVEL, TWO_SINGLES_LEVEL, WALLED_LEVEL];
const make = (levels = LEVELS, config = Config) => new ProgressManager({ config, levels });
const { startingMoney, rewardPerLevel } = Config.progression;

describe('ProgressManager (pure money and level progression)', () => {
  it('starts at level 1 with Config.progression.startingMoney', () => {
    const progress = make();
    expect(progress.getState()).toEqual({
      levelNumber: 1,
      levelId: SINGLE_LANE_LEVEL.id,
      levelCount: 3,
      isLastLevel: false,
      money: startingMoney,
      reward: rewardPerLevel,
      completed: false,
      version: 0,
    });
    expect(progress.currentLevel()).toBe(SINGLE_LANE_LEVEL);
    expect(progress.nextLevel()).toBe(TWO_SINGLES_LEVEL);
  });

  it('pays Config.progression.rewardPerLevel exactly once per level', () => {
    const progress = make(LEVELS, createConfig({ progression: { startingMoney: 5, rewardPerLevel: 30 } }));
    expect(progress.completeLevel()).toEqual({ ok: true, reward: 30, money: 35 });
    expect(progress.completeLevel()).toEqual({ ok: false, reward: 0, money: 35 });
    expect(progress.money).toBe(35);
    expect(progress.isCompleted()).toBe(true);
  });

  it('advances only past a completed level, and the new level starts unpaid', () => {
    const progress = make();
    expect(progress.advance()).toEqual({ ok: false, level: null, levelNumber: 1 });
    progress.completeLevel();
    expect(progress.advance()).toEqual({ ok: true, level: TWO_SINGLES_LEVEL, levelNumber: 2 });
    expect(progress.isCompleted()).toBe(false);
    expect(progress.advance().ok).toBe(false);
    expect(progress.completeLevel()).toEqual({ ok: true, reward: rewardPerLevel, money: startingMoney + 2 * rewardPerLevel });
  });

  it('wraps back to Level 1 after the last level while money keeps accumulating', () => {
    const progress = make([SINGLE_LANE_LEVEL, TWO_SINGLES_LEVEL]);
    progress.completeLevel();
    progress.advance();
    expect(progress.getState()).toMatchObject({ levelNumber: 2, isLastLevel: true });
    expect(progress.nextLevel()).toBe(SINGLE_LANE_LEVEL);
    progress.completeLevel();
    expect(progress.advance()).toEqual({ ok: true, level: SINGLE_LANE_LEVEL, levelNumber: 1 });
    expect(progress.getState()).toMatchObject({ levelNumber: 1, levelId: SINGLE_LANE_LEVEL.id, isLastLevel: false, completed: false, money: startingMoney + 2 * rewardPerLevel });
    expect(progress.completeLevel()).toMatchObject({ ok: true }); // a new visit of Level 1 pays again
  });

  it('has no level and cannot advance without a level list', () => {
    const progress = make([]);
    expect(progress.currentLevel()).toBeNull();
    expect(progress.nextLevel()).toBeNull();
    expect(progress.getState()).toMatchObject({ levelId: null, levelCount: 0 });
    progress.completeLevel();
    expect(progress.advance().ok).toBe(false);
  });

  it('returns plain JSON state and bumps version on every change', () => {
    const progress = make();
    const before = progress.getState();
    expect(JSON.parse(JSON.stringify(before))).toEqual(before);
    progress.completeLevel();
    progress.advance();
    expect(progress.getState().version).toBe(before.version + 2);
    expect(before.money).toBe(startingMoney); // earlier states are copies
  });
});
