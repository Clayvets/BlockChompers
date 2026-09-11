import { createConfig } from '../../src/config/Config.js';
import { createGame } from '../../src/core/createGame.js';

/** Test base: speed 1 cell/s and fixedStep 1 s => one step() == one cell; no launch or eat delays. */
export const TEST_OVERRIDES = Object.freeze({
  track: { speed: 1 },
  timing: { fixedStep: 1, launchDelay: 0, eatDuration: 0 },
});

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function mergeDeep(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] = isPlain(base[key]) && isPlain(value) ? mergeDeep(base[key], value) : value;
  }
  return out;
}

/** Test base merged with partial overrides (a partial `timing` no longer wipes the base timing). */
export function createTestConfig(overrides = {}) {
  return createConfig(mergeDeep(TEST_OVERRIDES, overrides));
}

/**
 * Game wired for deterministic tests. No canvas, no Three.js, no DOM -- only the core graph.
 * @param {{ level?: object|null, levels?: object[]|null, config?: object }} [opts] `levels` is a progression list;
 *   `config` holds partial overrides on top of the test base
 */
export function createTestGame({ level = null, levels = null, config: overrides = {} } = {}) {
  return createGame({ config: createTestConfig(overrides), level, levels });
}
