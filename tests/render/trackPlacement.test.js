import { describe, it, expect } from 'vitest';
import { createTestGame } from '../helpers/createTestGame.js';
import { ALL_BLOCKED_LEVEL } from '../fixtures/levels.js';
import { UnitState } from '../../src/core/Unit.js';
import { Config } from '../../src/config/Config.js';
import { createGame } from '../../src/core/createGame.js';
import { trackDrawPosition, trackFromSnapshot } from '../../src/render/trackPlacement.js';

const ON_TRACK = new Set([UnitState.RUNNING, UnitState.EATING]);
const EPS = 1e-9;

/** True when (x, y) lies on the ring through the track cell centres (the path units must follow). */
function onTrackPath({ x, y }, { rows, cols }, margin) {
  const [x0, x1, y0, y1] = [-margin + 0.5, cols + margin - 0.5, -margin + 0.5, rows + margin - 0.5];
  const within = (v, a, b) => v >= a - EPS && v <= b + EPS;
  const near = (v, w) => Math.abs(v - w) <= EPS;
  return ((near(x, x0) || near(x, x1)) && within(y, y0, y1)) || ((near(y, y0) || near(y, y1)) && within(x, x0, x1));
}

/** Every on-track unit of the snapshot, drawn at `alpha`, as off-path descriptions (empty = all on the path). */
function offPath(snapshot, track, alphas) {
  const out = [];
  for (const unit of snapshot.units.filter((u) => ON_TRACK.has(u.state))) {
    if (!onTrackPath(unit.pose, snapshot.grid, snapshot.track.margin)) out.push(`logic ${unit.id}`);
    for (const alpha of alphas) {
      const p = trackDrawPosition(unit, track, alpha);
      if (!onTrackPath(p, snapshot.grid, snapshot.track.margin)) {
        out.push(`step ${snapshot.stepCount} ${unit.id} (slot ${unit.slotIndex}) at (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
      }
    }
  }
  return out;
}

describe('track placement (render, headless)', () => {
  it('keeps every on-track unit on the track path at every step, with several units launched together', () => {
    const { game } = createTestGame({ level: ALL_BLOCKED_LEVEL });
    for (const id of ['u0', 'u1', 'u2', 'u3', 'u4']) game.activateUnit(id); // five runners, slots 0-4, lockstep
    const track = trackFromSnapshot(game.getSnapshot());
    const problems = [];
    for (let i = 0; i < 24; i += 1) {
      game.step();
      problems.push(...offPath(game.getSnapshot(), track, [0, 0.25, 0.5, 0.75, 1]));
    }
    expect(problems).toEqual([]);
  });

  it('with the shipped config, units launched in quick succession stay on the path and are spaced along it', () => {
    const { game } = createGame({ config: Config, level: ALL_BLOCKED_LEVEL });
    const track = trackFromSnapshot(game.getSnapshot());
    const problems = [];
    for (let frame = 0; frame < 400; frame += 1) {
      if (frame < 5) game.activateUnit(`u${frame}`); // one click per frame
      game.update(1 / 60);
      const snapshot = game.getSnapshot();
      problems.push(...offPath(snapshot, track, [snapshot.stepAlpha]));
      const running = snapshot.units.filter((u) => ON_TRACK.has(u.state)).sort((a, b) => b.distanceTraveled - a.distanceTraveled);
      for (let i = 1; i < running.length; i += 1) {
        const gap = running[i - 1].distanceTraveled - running[i].distanceTraveled;
        if (gap < Config.track.launchSpacing - 1e-6) problems.push(`frame ${frame}: ${running[i].id} only ${gap.toFixed(3)} behind`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('follows the path through every corner and across the lap wrap', () => {
    const { game } = createTestGame({ level: ALL_BLOCKED_LEVEL });
    const snapshot = game.getSnapshot();
    const track = trackFromSnapshot(snapshot);
    const { length } = track;
    for (let d = 0; d <= length; d += 0.1) {
      expect(onTrackPath(trackDrawPosition({ prevDistance: d, distanceTraveled: d }, track, 0), snapshot.grid, 1)).toBe(true);
    }
    const wrapped = trackDrawPosition({ prevDistance: length - 0.5, distanceTraveled: 0.5 }, track, 0.5);
    expect(wrapped).toEqual(track.positionAt(0)); // halfway across the wrap = the entry corner, not the middle of the grid
    expect(trackDrawPosition({ prevDistance: 2, distanceTraveled: 3 }, track, 0.5)).toEqual(track.positionAt(2.5));
  });
});
