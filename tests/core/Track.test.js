import { describe, it } from 'vitest';
import { Track } from '../../src/core/Track.js';
import { Config } from '../../src/config/Config.js';

describe('Track (cell units, no pixels)', () => {
  describe('geometry', () => {
    it.todo('length equals the perimeter of the grid expanded by margin on every side');
    it.todo('entryT points at the configured corner (Config.track.entry)');
    it.todo('normalize wraps negative and over-length t into [0, length)');
    it.todo('advance moves in the loop direction and wraps');
  });

  describe('laneAt', () => {
    it.todo('maps N-side t to column indices in ascending order (cw)');
    it.todo('maps E-side t to row indices in ascending order (cw)');
    it.todo('maps S-side t to column indices in DESCENDING order (cw) -- mirror hotspot');
    it.todo('maps W-side t to row indices in DESCENDING order (cw) -- mirror hotspot');
    it.todo('returns null inside corner cells');
    it.todo('mirrors every side when direction = ccw');
    it.todo('uses a non-square grid (4x2) so row/col confusion fails loudly');
  });

  describe('lanesCrossed', () => {
    it.todo('returns [] when no lane centre lies in (tFrom, tTo]');
    it.todo('returns several lanes, ordered, for a large step');
    it.todo('handles a step that crosses a corner');
    it.todo('handles wrap-around past length');
    it.todo('never returns the same lane twice within one lap');
  });

  describe('lap', () => {
    it.todo('isLapComplete is based on distanceTraveled >= length, not t === entryT');
  });
});
