import { describe, it, expect } from 'vitest';
import { createTestGame } from '../helpers/createTestGame.js';
import { captureEvents } from '../helpers/captureEvents.js';
import { runUntil } from '../helpers/runUntil.js';
import { SINGLE_LANE_LEVEL, TWO_COLORS_LEVEL } from '../fixtures/levels.js';
import { GamePhase } from '../../src/core/GameManager.js';
import { UnitState } from '../../src/core/Unit.js';
import { Events } from '../../src/core/Events.js';

/**
 * Drives the game purely through GameManager: no canvas, no Three.js, no DOM.
 * Pattern for every case:
 *   const { game, eventBus } = createTestGame({ level: SINGLE_LANE_LEVEL });   // arrange
 *   const events = captureEvents(eventBus);
 *   game.activateUnit('u0'); game.step(3);                                   // act
 *   expect(game.getSnapshot().grid.cells).toEqual([[0, 1, 1]]);              // assert on snapshot...
 *   expect(events.map((e) => e.type)).toContain(Events.BLOCK_CONSUMED);      // ...and on events
 */
describe('GameManager', () => {
  it('constructs and steps without Three.js or a DOM', () => {
    const { game } = createTestGame();
    expect(typeof globalThis.document).toBe('undefined');
    expect(() => game.step()).not.toThrow();
  });

  describe('activation', () => {
    it.todo('moves a reserve unit into the lowest free slot and emits UNIT_ACTIVATED');
    it.todo('rejects with NO_FREE_SLOT when all 5 slots are occupied or blocked');
    it.todo('rejects with NOT_IN_RESERVE for units that are active, returned or dead');
    it.todo('rejects with NOT_PLAYING before a level is loaded and after win/lose');
    it.todo('launches the unit at track.entryT after timing.launchDelay');
    it.todo('accepts activations while other units are running (pass-through concurrency)');
  });

  describe('running and consuming', () => {
    it.todo('consumes only the outermost block of its own colour (blocksPerLanePass = 1)');
    it.todo('ignores lanes whose outermost block is another colour');
    it.todo('ignores empty / zero-padded lanes');
    it.todo('scans each lane exactly once per lap (no double consume across a large step)');
    it.todo('processes concurrent runners in slot order (deterministic same-lane resolution)');
  });

  describe('death and return', () => {
    it.todo('marks the unit DEAD and frees its slot when capacity reaches 0');
    it.todo('marks the unit RETURNED and blocks its slot after a full lap with capacity > 0');
    it.todo('returns the unit to the SAME slot it was activated into');
  });

  describe('win and lose', () => {
    it.todo('enters WON when the matrix is entirely empty');
    it.todo('honours rules.winWaitsForRunners');
    it.todo('enters LOST when all 5 slots are blocked and no unit is running');
    it.todo('enters LOST when the reserve is empty, nothing is running and blocks remain');
    it.todo('does NOT lose while a runner is still on the track');
  });

  describe('determinism', () => {
    it.todo('identical commands and steps yield identical snapshots and event sequences');
    it.todo('update(dt) with an accumulated dt equals the same number of explicit step() calls');
  });
});
