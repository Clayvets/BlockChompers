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
 * @returns {{ x: number, y: number, facing: string }}
 */
export function trackDrawPosition(unit, track, alpha) {
  const from = unit.prevDistance;
  let to = unit.distanceTraveled;
  if (to < from) to += track.length;
  return track.positionAt(from + (to - from) * alpha);
}
