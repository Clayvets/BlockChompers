import { Config } from '../config/Config.js';
import { EventBus } from './EventBus.js';
import { GameManager } from './GameManager.js';

/**
 * Single wiring point shared by main.js and the tests, so both always build the game the same way.
 * @param {{ config?: object, eventBus?: EventBus, level?: object|null }} [opts]
 * @returns {{ game: GameManager, eventBus: EventBus, config: object }}
 */
export function createGame({ config = Config, eventBus = new EventBus(), level = null } = {}) {
  const game = new GameManager({ config, eventBus });
  if (level) game.loadLevel(level);
  return { game, eventBus, config };
}
