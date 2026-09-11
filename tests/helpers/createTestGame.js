import { createConfig } from '../../src/config/Config.js';
import { createGame } from '../../src/core/createGame.js';

/**
 * Game wired for deterministic tests: speed 1 cell/s and fixedStep 1 s => one step() == one cell of
 * travel; launch/eat delays 0 so a unit is on the track the step after activation.
 * No canvas, no Three.js, no DOM -- only the core graph.
 */
export function createTestGame({ level = null, config: overrides = {} } = {}) {
  const config = createConfig({
    track: { speed: 1 },
    timing: { fixedStep: 1, launchDelay: 0, eatDuration: 0 },
    ...overrides,
  });
  return createGame({ config, level });
}
