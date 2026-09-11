import { Track } from './Track.js';
import { GridManager } from './GridManager.js';
import { UnitState } from './Unit.js';

/**
 * Pure dry-run helpers over a SNAPSHOT (never over live managers), used for "valid move"
 * detection and hints. They rebuild a throwaway grid and track from the snapshot, so they cannot
 * mutate game state by construction.
 */

/**
 * Simulate one full lap of `unitId` alone against the snapshot's grid, applying the same lane rule
 * as GameManager.step (rules.blocksPerLanePass, ignore other colours / empty lanes).
 * @returns {{ consumed: Array<{ row: number, col: number }>, outcome: 'dies'|'returns', capacityLeft: number }}
 */
export function simulateRun(snapshot, unitId, config) {
  const unit = snapshot.units.find((u) => u.id === unitId);
  if (!unit || !snapshot.track) return { consumed: [], outcome: 'returns', capacityLeft: unit ? unit.capacity : 0 };

  const { rows, cols, cells } = snapshot.grid;
  const grid = new GridManager({ config });
  grid.load(cells);
  const track = new Track({ rows, cols, ...config.track, epsilon: config.timing.epsilon });

  let capacity = unit.capacity;
  const consumed = [];
  for (const lane of track.laneSequence()) {
    if (capacity === 0) break;
    const max = Math.min(config.rules.blocksPerLanePass, capacity);
    for (const cell of grid.consumeFromEdge(lane.side, lane.laneIndex, unit.color, { max })) {
      consumed.push({ row: cell.row, col: cell.col });
      capacity -= 1;
    }
  }
  return { consumed, outcome: capacity === 0 ? 'dies' : 'returns', capacityLeft: capacity };
}

/**
 * Reserve unit ids whose activation would consume at least one block.
 * Single-unit heuristic: it ignores runners already on the track and cannot prove a level
 * unsolvable (that needs multi-unit sequencing). See Config.rules.detectDeadEndsEarly.
 * @returns {string[]}
 */
export function findValidMoves(snapshot, config) {
  return snapshot.units
    .filter((unit) => unit.state === UnitState.RESERVE)
    .filter((unit) => simulateRun(snapshot, unit.id, config).consumed.length > 0)
    .map((unit) => unit.id);
}
