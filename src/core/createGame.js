import { Config } from '../config/Config.js';
import { EventBus } from './EventBus.js';
import { GameManager } from './GameManager.js';
import { ProgressManager } from './ProgressManager.js';

/**
 * Single wiring point shared by main.js and the tests, so both always build the game the same way.
 * `levels` is the progression list in play order; `level` is shorthand for a one-level list (it is
 * ignored when `levels` is given). The progression's current level is loaded immediately.
 * @param {{ config?: object, eventBus?: EventBus, levels?: object[]|null, level?: object|null }} [opts]
 * @returns {{ game: GameManager, eventBus: EventBus, config: object }}
 */
export function createGame({ config = Config, eventBus = new EventBus(), levels = null, level = null } = {}) {
  const progress = new ProgressManager({ config, levels: levels || (level ? [level] : []) });
  const game = new GameManager({ config, eventBus, progress });
  const first = progress.currentLevel();
  if (first) game.loadLevel(first);
  return { game, eventBus, config };
}
