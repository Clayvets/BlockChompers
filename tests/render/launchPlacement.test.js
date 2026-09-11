import { describe, it, expect } from 'vitest';
import { launchPath, pathPoint, pathTangent, flightProgress, flightPose, entryQueueBacks, returnPose, HEADING } from '../../src/render/launchPlacement.js';
import { trackDrawPosition, trackFromSnapshot } from '../../src/render/trackPlacement.js';
import { ALL_BLOCKED_LEVEL } from '../fixtures/levels.js';
import { createGame } from '../../src/core/createGame.js';
import { UnitState } from '../../src/core/Unit.js';
import { Config } from '../../src/config/Config.js';

const ENTRY = { x: -0.5, y: 3.5 }; // SW corner of a 3-row grid, margin 1
const N = HEADING.N;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const SHAPE = { lift: Config.render.launchLift, curve: Config.render.launchCurve };

describe('launch flight (render, headless)', () => {
  it('lifts off the start, meets the entry along the track heading, and stays inside the start-entry box', () => {
    const from = { x: 6, y: 7 };
    const path = launchPath(from, ENTRY, N, SHAPE);
    expect(pathPoint(path, 0)).toEqual(from);
    expect(pathPoint(path, 1)).toEqual(ENTRY);
    const start = pathTangent(path, 0);
    expect([start.dx, start.dy < 0]).toEqual([0, true]); // straight up, off the reserve row
    const end = pathTangent(path, 1);
    expect(end.dx).toBeCloseTo(0, 12);
    expect(end.dy).toBeLessThan(0); // arriving northwards, like the track
    let lastDepth = Infinity;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const p = pathPoint(path, s);
      expect(p.y).toBeLessThanOrEqual(from.y + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(ENTRY.y - 1e-9);
      expect(p.x).toBeLessThanOrEqual(from.x + 1e-9);
      expect(p.x).toBeGreaterThanOrEqual(ENTRY.x - 1e-9);
      expect(p.y - ENTRY.y).toBeLessThanOrEqual(lastDepth + 1e-9); // always closing in on the entry
      lastDepth = p.y - ENTRY.y;
    }
    // a start only 1 cell deep: the lift is capped at depth - approach (0.5), so the flight never overshoots the entry row
    expect(launchPath({ x: 6, y: 4.5 }, ENTRY, N, SHAPE).p1).toEqual({ x: 6, y: 4 });
  });

  it('progress counts whole flight steps plus the step fraction and holds at 1 at the entry', () => {
    expect(flightProgress({ timer: 16 }, 16, 0)).toBe(0);
    expect(flightProgress({ timer: 16 }, 16, 0.5)).toBeCloseTo(0.5 / 16, 12);
    expect(flightProgress({ timer: 8 }, 16, 0)).toBe(0.5);
    expect(flightProgress({ timer: 0 }, 16, 0.7)).toBe(1);
    expect(flightProgress({ timer: 0 }, 0, 0)).toBe(1);
  });

  it('eases out: fast off the reserve, slow into the entry, and faces its direction of travel', () => {
    const from = { x: 6, y: 7 };
    const path = launchPath(from, ENTRY, N, SHAPE);
    expect(flightPose(path, 0, 'easeOutCubic', 0)).toMatchObject({ ...from, air: 0 });
    const half = flightPose(path, 0.5, 'easeOutCubic', 0);
    expect(dist(half, ENTRY)).toBeLessThan(dist(pathPoint(path, 0.5), ENTRY)); // past the linear midpoint
    expect(half.air).toBeGreaterThan(0); // in the air: drawn over what it passes
    const arrived = flightPose(path, 1, 'easeOutCubic', 0);
    expect(arrived).toMatchObject({ ...ENTRY, air: 0 });
    expect(arrived.dir.dx).toBeCloseTo(0, 9);
    expect(arrived.dir.dy).toBeLessThan(0);
    const held = flightPose(path, 1, 'easeOutCubic', 2); // waiting two cells back
    expect(ENTRY.y - held.y).toBeCloseTo(-2, 6);
    expect(flightPose(path, 1, 'easeOutCubic', 99)).toMatchObject(from); // never backs up past its start
  });

  it('with the shipped config, units tapped in a burst queue behind the entry without touching each other', () => {
    const { game } = createGame({ config: Config, level: ALL_BLOCKED_LEVEL });
    const track = trackFromSnapshot(game.getSnapshot());
    const entry = track.positionAt(0);
    const spacing = Config.track.launchSpacing;
    const paths = new Map();
    const problems = [];
    let longestQueue = 0;
    for (let frame = 0; frame < 240; frame += 1) {
      if (frame < 5) {
        game.activateUnit(`u${frame}`); // five taps, one per frame
        paths.set(`u${frame}`, launchPath({ x: 1 + 1.2 * frame, y: entry.y + 3.2 }, entry, N, SHAPE));
      }
      game.update(1 / 60);
      const snapshot = game.getSnapshot();
      const alpha = snapshot.stepAlpha;
      const backs = entryQueueBacks(snapshot.units, spacing, alpha);
      const drawn = [];
      for (const u of snapshot.units) {
        if (u.state === UnitState.LAUNCHING && u.timer === 0) {
          drawn.push({ id: u.id, ...flightPose(paths.get(u.id), 1, Config.render.motionEasing, backs.get(u.id)) });
        } else if ((u.state === UnitState.RUNNING || u.state === UnitState.EATING) && u.distanceTraveled < 2 * spacing) {
          drawn.push({ id: u.id, ...trackDrawPosition(u, track, alpha) });
        }
      }
      longestQueue = Math.max(longestQueue, snapshot.units.filter((u) => u.state === UnitState.LAUNCHING && u.timer === 0).length);
      for (let i = 0; i < drawn.length; i += 1) {
        for (let j = i + 1; j < drawn.length; j += 1) {
          const gap = dist(drawn[i], drawn[j]);
          if (gap < spacing - 1e-6) problems.push(`frame ${frame}: ${drawn[i].id}/${drawn[j].id} ${gap.toFixed(3)} apart`);
        }
      }
    }
    expect(longestQueue).toBeGreaterThanOrEqual(2); // the burst really queued
    expect(problems).toEqual([]);
  });
});

describe('return glide (render, headless)', () => {
  it('eases from where the unit left the track into its slot, in the air on the way, then faces north', () => {
    const from = { x: -0.5, y: 3.5 };
    const slot = { x: 4, y: 5.1 };
    const easing = Config.render.motionEasing;
    expect(returnPose(from, slot, 0, easing)).toMatchObject({ ...from, air: 0 });
    const half = returnPose(from, slot, 0.5, easing);
    expect((half.x - from.x) / (slot.x - from.x)).toBeGreaterThan(0.5); // ease-out: most of the way at half time
    expect(half.air).toBeGreaterThan(0);
    expect(half.dir.dx).toBeGreaterThan(0);
    expect(returnPose(from, slot, 1, easing)).toEqual({ ...slot, dir: HEADING.N, air: 0 });
    expect(returnPose(null, slot, 0.2, easing)).toEqual({ ...slot, dir: HEADING.N, air: 0 }); // no start: already parked
  });
});
