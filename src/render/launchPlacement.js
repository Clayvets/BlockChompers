import { ease } from '../core/easing.js';

/** facing -> unit heading on the cell plane (x right, y down). */
export const HEADING = Object.freeze({ N: { dx: 0, dy: -1 }, E: { dx: 1, dy: 0 }, S: { dx: 0, dy: 1 }, W: { dx: -1, dy: 0 } });

/** Screen-up on the cell plane: the reserve and the slots sit below the grid, so a flight lifts this way first. */
const UP = Object.freeze({ dx: 0, dy: -1 });

/**
 * Launch flight path (cell units): a cubic Bezier that lifts off the start (`lift` cells towards the grid, clear of the
 * reserve row it leaves), sweeps across, and meets the entry along the track's heading, so the flight hands over to
 * the track without a kink. The approach control sits `curve` x the start's depth behind the entry (0 = no approach
 * bend). The lift is capped so the flight only ever moves towards the entry along the track heading; the path stays
 * inside the box spanned by the start and the entry.
 * @param {{ x: number, y: number }} from where the unit was drawn when the launch began
 * @param {{ x: number, y: number }} entry Track.positionAt(0)
 * @param {{ dx: number, dy: number }} entryDir unit heading of the track at the entry
 * @param {{ lift: number, curve: number }} shape Config.render.launchLift / launchCurve
 */
export function launchPath(from, entry, entryDir, { lift, curve }) {
  const depth = Math.max(0, (entry.x - from.x) * entryDir.dx + (entry.y - from.y) * entryDir.dy);
  const approach = curve * depth;
  const rise = Math.max(0, Math.min(lift, depth - approach));
  return {
    p0: { ...from },
    p1: { x: from.x + UP.dx * rise, y: from.y + UP.dy * rise },
    p2: { x: entry.x - entryDir.dx * approach, y: entry.y - entryDir.dy * approach },
    p3: { ...entry },
    entryDir: { ...entryDir },
  };
}

/** Point at parameter s in [0, 1] (written into `out` when given). */
export function pathPoint({ p0, p1, p2, p3 }, s, out = {}) {
  const u = 1 - s;
  const a = u * u * u;
  const b = 3 * u * u * s;
  const c = 3 * u * s * s;
  const d = s * s * s;
  out.x = a * p0.x + b * p1.x + c * p2.x + d * p3.x;
  out.y = a * p0.y + b * p1.y + c * p2.y + d * p3.y;
  return out;
}

/** Direction of travel at parameter s (not normalised; may be zero where a control point coincides). */
export function pathTangent({ p0, p1, p2, p3 }, s, out = {}) {
  const u = 1 - s;
  const a = 3 * u * u;
  const b = 6 * u * s;
  const c = 3 * s * s;
  out.dx = a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x);
  out.dy = a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y);
  return out;
}

const _point = { x: 0, y: 0 };
/** A fresh pose object for the *Pose() helpers' `out` parameter. */
export const newPose = () => ({ x: 0, y: 0, dir: { dx: 0, dy: -1 }, air: 0 });

/** Height bump (0 at both ends, 1 halfway) for a unit in the air, so it draws over the units it passes. */
export function hop(s) {
  return 4 * s * (1 - s);
}

/**
 * Flight progress of a LAUNCHING unit in [0, 1]: whole steps flown plus the fraction of the next step (stepAlpha).
 * 1 means it has reached the entry (it may be waiting there for the follow distance).
 */
export function flightProgress(unit, launchSteps, alpha) {
  if (!(launchSteps > 0)) return 1;
  return Math.min(1, Math.max(0, (launchSteps - unit.timer + alpha) / launchSteps));
}

/**
 * Entry queue (render only): how far back from the entry, along the approach, each LAUNCHING unit must stop so that
 * units waiting for the follow distance line up behind the entry instead of piling on it. Rank r (launch order) waits
 * (r + 1) x spacing behind the nearest runner that is still within `spacing` of the entry, or r x spacing when the
 * entry is clear. It is continuous: the first in line creeps forward as that runner pulls away and reaches the entry
 * exactly when the logic lets it in.
 * @param {Array<object>} units snapshot units
 * @param {number} spacing Config.track.launchSpacing
 * @param {number} alpha snapshot.stepAlpha
 * @param {Map<string, number>} [out] map to fill (cleared first); pass the same one every frame to avoid allocations
 * @param {Array<object>} [scratch] reusable array for the launch-order sort
 * @returns {Map<string, number>} unit id -> back distance (cells)
 */
export function entryQueueBacks(units, spacing, alpha, out = new Map(), scratch = []) {
  out.clear();
  if (!(spacing > 0)) return out;
  let nearest = spacing;
  scratch.length = 0;
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i];
    if (u.state === 'launching') {
      // Insertion sort by launch order (a handful of units at most; no allocation).
      let j = scratch.length;
      scratch.push(u);
      while (j > 0 && scratch[j - 1].launchSeq > u.launchSeq) {
        scratch[j] = scratch[j - 1];
        j -= 1;
      }
      scratch[j] = u;
    } else if (u.state === 'running' || u.state === 'eating') {
      const drawn = u.prevDistance + (u.distanceTraveled - u.prevDistance) * alpha;
      if (drawn >= 0 && drawn < nearest) nearest = drawn;
    }
  }
  for (let rank = 0; rank < scratch.length; rank += 1) out.set(scratch[rank].id, Math.max(0, (rank + 1) * spacing - nearest));
  return out;
}

/** How far point P is before the entry, measured along the track heading at the entry. */
function depthBefore({ p3, entryDir }, point) {
  return (p3.x - point.x) * entryDir.dx + (p3.y - point.y) * entryDir.dy;
}

/** Largest path parameter whose point is still at least `back` before the entry (0 if even the start is closer). */
function paramAtDepth(path, back) {
  if (depthBefore(path, path.p0) <= back) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (depthBefore(path, pathPoint(path, mid, _point)) >= back) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Where to draw a LAUNCHING unit and which way it faces: along its eased flight path, but held on that path while it
 * waits its turn, `back` cells before the entry (measured along the track heading). A long queue therefore bends back
 * along each unit's own path instead of piling up on the entry, and a unit never backs up past where it started.
 * `air` is the hop factor in [0, 1] for the height bump.
 * @returns {{ x: number, y: number, dir: { dx: number, dy: number }, air: number }}
 */
export function flightPose(path, progress, easing, back, out = newPose()) {
  let s = ease(easing, progress);
  if (back > 0) s = Math.min(s, paramAtDepth(path, back));
  pathPoint(path, s, out);
  pathTangent(path, s, out.dir);
  if (Math.hypot(out.dir.dx, out.dir.dy) < 1e-9) {
    out.dir.dx = path.entryDir.dx;
    out.dir.dy = path.entryDir.dy;
  }
  out.air = hop(s);
  return out;
}

/**
 * Return glide (render only; the logic parks the unit at once): from where the unit left the track to its parking
 * slot, eased, with a hop so it draws over the parked units it passes. Without a start, or once done, it sits in the
 * slot facing north like every parked unit.
 * @param {{ x: number, y: number } | null} from last drawn point on the track
 * @param {{ x: number, y: number }} slot slot centre
 * @param {number} progress elapsed / render.returnToSlotMs
 * @param {string} easing Config.render.motionEasing
 * @returns {{ x: number, y: number, dir: { dx: number, dy: number }, air: number }}
 */
export function returnPose(from, slot, progress, easing, out = newPose()) {
  if (!from || !(progress < 1)) {
    out.x = slot.x;
    out.y = slot.y;
    out.dir.dx = HEADING.N.dx;
    out.dir.dy = HEADING.N.dy;
    out.air = 0;
    return out;
  }
  const e = ease(easing, progress);
  out.x = from.x + (slot.x - from.x) * e;
  out.y = from.y + (slot.y - from.y) * e;
  out.dir.dx = slot.x - from.x;
  out.dir.dy = slot.y - from.y;
  out.air = hop(e);
  return out;
}
