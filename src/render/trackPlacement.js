import { Track } from '../core/Track.js';

/** Rebuild the level's Track from a snapshot, so the renderer and headless tests share the exact path. */
export function trackFromSnapshot({ grid, track }) {
  return new Track({ rows: grid.rows, cols: grid.cols, margin: track.margin, direction: track.direction, entry: track.entry });
}

/**
 * Where to draw a unit that is on the track, in cell units. Uses the unit's own track distance (per unit id, from
 * its snapshot entry): prevDistance -> distanceTraveled interpolated by the step alpha, then converted with
 * Track.positionAt(), so the unit follows the path through corners instead of cutting across them. A distance
 * that went backwards is a lap wrap and is unwrapped by one track length. Nothing is offset sideways: spacing
 * between units exists only as distance along the track (logic: Config.track.launchSpacing).
 * @param {{ prevDistance: number, distanceTraveled: number }} unit
 * @param {Track} track
 * @param {number} alpha fraction [0, 1] of the next logic step (snapshot.stepAlpha)
 * @param {{ x?: number, y?: number, facing?: string }} [out] object to fill (pass the same one every frame: no allocation)
 * @returns {{ x: number, y: number, facing: string }} the same point Track.positionAt() gives, read from the frozen cells
 */
export function trackDrawPosition(unit, track, alpha, out = {}) {
  const from = unit.prevDistance;
  let to = unit.distanceTraveled;
  if (to < from) to += track.length;
  const d = track.normalize(from + (to - from) * alpha);
  const i = Math.floor(d);
  const f = d - i;
  const a = track.cellAt(i);
  const b = track.cellAt(i + 1);
  out.x = a.x + (b.x - a.x) * f;
  out.y = a.y + (b.y - a.y) * f;
  out.facing = a.facing;
  return out;
}
