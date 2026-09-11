import { describe, it, expect } from 'vitest';
import { levels, levelLibrary, watermelon, panda, carrot } from '../../src/core/levels/index.js';
import { GamePhase } from '../../src/core/GameManager.js';
import { Events, RejectReason } from '../../src/core/Events.js';
import { Config } from '../../src/config/Config.js';
import { createTestGame } from '../helpers/createTestGame.js';
import { captureEvents } from '../helpers/captureEvents.js';
import { playScripted } from '../helpers/playScripted.js';

const REWARD = Config.progression.rewardPerLevel;
const START = Config.progression.startingMoney;
const progress = (game) => game.getSnapshot().progress;

/** Win the loaded level with its scripted order, then press the win card's action (Continue / Play again). */
function winAndContinue(game) {
  expect(playScripted(game)).toEqual([]);
  expect(game.phase).toBe(GamePhase.WON);
  const wasLast = progress(game).isLastLevel;
  const result = game.continueToNextLevel();
  expect(result.ok).toBe(true);
  return wasLast;
}

describe('three-level cycle: Level 1 -> Panda -> Carrot -> Level 1', () => {
  it('uses exactly three levels in that order and keeps the others loadable', () => {
    expect(levels).toEqual([watermelon, panda, carrot]);
    expect(levels.map((l) => l.name)).toEqual(['Watermelon', 'Panda', 'Carrot']);
    expect(Object.keys(levelLibrary).sort()).toEqual(['carrot', 'panda', 'starter', 'watermelon']);
  });

  it('flags only Level 3 as the last level', () => {
    const { game } = createTestGame({ levels });
    const seen = [];
    for (let i = 0; i < 3; i += 1) {
      seen.push([progress(game).levelNumber, game.level.id, progress(game).isLastLevel]);
      winAndContinue(game);
    }
    expect(seen).toEqual([[1, 'watermelon', false], [2, 'panda', false], [3, 'carrot', true]]);
  });

  it('winning Level 3 adds its reward exactly once and loads Level 1 with the money kept', () => {
    const { game, eventBus } = createTestGame({ levels });
    winAndContinue(game);
    winAndContinue(game);
    expect(progress(game)).toMatchObject({ levelNumber: 3, isLastLevel: true, money: START + 2 * REWARD });
    expect(playScripted(game)).toEqual([]);
    const events = captureEvents(eventBus);
    expect(game.continueToNextLevel()).toEqual({ ok: true, reward: REWARD, money: START + 3 * REWARD, levelNumber: 1 });
    expect(game.continueToNextLevel()).toEqual({ ok: false, reason: RejectReason.NOT_WON }); // double click
    expect(events.filter((e) => e.type === Events.MONEY_CHANGED).map((e) => e.payload.delta)).toEqual([REWARD]);
    expect(game.level).toBe(watermelon);
    expect(game.getSnapshot()).toMatchObject({ phase: GamePhase.PLAYING, stepCount: 0 });
    expect(progress(game)).toMatchObject({ levelNumber: 1, levelId: 'watermelon', isLastLevel: false, completed: false, money: START + 3 * REWARD });
  });

  it('runs a second full cycle', () => {
    const { game } = createTestGame({ levels });
    const lastFlags = [];
    for (let i = 0; i < 6; i += 1) lastFlags.push(winAndContinue(game));
    expect(lastFlags).toEqual([false, false, true, false, false, true]);
    expect(progress(game)).toMatchObject({ levelNumber: 1, levelId: 'watermelon', money: START + 6 * REWARD });
  });
});
