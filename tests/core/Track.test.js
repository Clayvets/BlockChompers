import { describe, it, expect } from 'vitest';
import { Track } from '../../src/core/Track.js';
import { Config } from '../../src/config/Config.js';

const make = (rows, cols, overrides = {}) => new Track({ rows, cols, ...Config.track, epsilon: Config.timing.epsilon, ...overrides });
const lane = (track, t) => {
  const l = track.laneAt(t);
  return l && `${l.side}${l.laneIndex}`;
};

describe('Track (cell units, no pixels)', () => {
  describe('geometry', () => {
    it('length is 2(cols + 2m - 1) + 2(rows + 2m - 1)', () => {
      expect(make(1, 3).length).toBe(12);
      expect(make(1, 1).length).toBe(8);
      expect(make(3, 5).length).toBe(20);
      expect(make(1, 1, { margin: 2 }).length).toBe(16);
      expect(make(2, 4).getCells()).toHaveLength(16);
    });

    it('entryT is 0 and cell 0 is the configured corner, for every corner', () => {
      for (const corner of ['NW', 'NE', 'SE', 'SW']) {
        const track = make(2, 4, { entry: { corner } });
        expect(track.entryT).toBe(0);
        expect(track.cellAt(0)).toMatchObject({ isCorner: true, corner, side: null, laneIndex: null });
        expect(track.getCorners()[0].corner).toBe(corner);
      }
    });

    it('normalize wraps into [0, length) and advance moves along the loop', () => {
      const track = make(1, 3);
      expect(track.normalize(-1)).toBe(11);
      expect(track.normalize(13)).toBe(1);
      expect(track.normalize(12)).toBe(0);
      expect(track.normalize(-12)).toBe(0);
      expect(track.advance(11, 2)).toBe(1);
      expect(track.advance(0.5, 0.25)).toBe(0.75);
    });

    it('rejects margin below minMargin, bad dimensions, unknown corners and directions', () => {
      expect(() => make(1, 1, { margin: 0 })).toThrow(RangeError);
      expect(() => make(0, 3)).toThrow(RangeError);
      expect(() => make(1, 3, { entry: { corner: 'XX' } })).toThrow(/corner/);
      expect(() => make(1, 3, { direction: 'up' })).toThrow(/direction/);
    });
  });

  describe('laneAt (rows = 2, cols = 4, entry SW, cw)', () => {
    // ring from SW: 0 SW | 1 W1 2 W0 | 3 NW | 4 N0 5 N1 6 N2 7 N3 | 8 NE | 9 E0 10 E1 | 11 SE | 12 S3 13 S2 14 S1 15 S0
    const track = make(2, 4);

    it('maps N-side t to column indices in ascending order', () => {
      expect([4, 5, 6, 7].map((t) => lane(track, t))).toEqual(['N0', 'N1', 'N2', 'N3']);
    });

    it('maps E-side t to row indices in ascending order', () => {
      expect([9, 10].map((t) => lane(track, t))).toEqual(['E0', 'E1']);
    });

    it('maps S-side t to column indices in DESCENDING order (mirror hotspot)', () => {
      expect([12, 13, 14, 15].map((t) => lane(track, t))).toEqual(['S3', 'S2', 'S1', 'S0']);
    });

    it('maps W-side t to row indices in DESCENDING order (mirror hotspot)', () => {
      expect([1, 2].map((t) => lane(track, t))).toEqual(['W1', 'W0']);
    });

    it('returns null inside corner cells', () => {
      expect([0, 3, 8, 11].map((t) => lane(track, t))).toEqual([null, null, null, null]);
      expect(track.laneAt(2.999)).toEqual({ side: 'W', laneIndex: 0 });
    });

    it('mirrors every side when direction = ccw and still starts at the entry', () => {
      const ccw = make(2, 4, { direction: 'ccw' });
      expect(ccw.cellAt(0).corner).toBe('SW');
      expect([1, 2, 3, 4].map((t) => lane(ccw, t))).toEqual(['S0', 'S1', 'S2', 'S3']);
      expect([6, 7].map((t) => lane(ccw, t))).toEqual(['E1', 'E0']);
      expect([9, 12].map((t) => lane(ccw, t))).toEqual(['N3', 'N0']);
      expect([14, 15].map((t) => lane(ccw, t))).toEqual(['W0', 'W1']);
      expect(ccw.cellAt(1).facing).toBe('E');
    });

    it('leaves the cells beside the corners without a lane when margin >= 2', () => {
      const wide = make(1, 1, { margin: 2 }); // 16 cells, 4 lanes
      expect(wide.laneSequence()).toHaveLength(4);
      expect(wide.cellAt(1)).toMatchObject({ isCorner: false, side: 'W', laneIndex: null });
    });
  });

  describe('poseAt', () => {
    const track = make(2, 4);

    it('interpolates between cell centres and reports facing, side, outward and isCorner', () => {
      expect(track.poseAt(0)).toMatchObject({ x: -0.5, y: 2.5, facing: 'N', side: null, isCorner: true });
      expect(track.poseAt(0.5)).toMatchObject({ x: -0.5, y: 2 });
      expect(track.poseAt(1)).toMatchObject({ x: -0.5, y: 1.5, side: 'W', outward: { dx: -1, dy: 0 } });
      const { outward } = track.poseAt(0);
      expect(outward.dx).toBeCloseTo(-Math.SQRT1_2);
      expect(outward.dy).toBeCloseTo(Math.SQRT1_2);
      expect(track.poseAt(15.5)).toMatchObject({ x: 0, y: 2.5, facing: 'W' }); // between S0 and the SW corner
      expect(track.poseAt(4)).toMatchObject({ x: 0.5, y: -0.5, facing: 'E', outward: { dx: 0, dy: -1 } });
    });
  });

  describe('lanesCrossed', () => {
    const track = make(1, 3); // 0 SW | 1 W0 | 2 NW | 3 N0 4 N1 5 N2 | 6 NE | 7 E0 | 8 SE | 9 S2 10 S1 11 S0

    it('returns [] when no lane centre lies in (tFrom, tTo]', () => {
      expect(track.lanesCrossed(0, 0.5)).toEqual([]);
      expect(track.lanesCrossed(1, 1)).toEqual([]); // the centre at 1 belongs to the step that reached it
      expect(track.lanesCrossed(1.2, 2.9)).toEqual([]); // only the NW corner in between
    });

    it('returns several lanes, ordered, for a large step and skips corners', () => {
      expect(track.lanesCrossed(0, 4)).toEqual([
        { side: 'W', laneIndex: 0, tCenter: 1 },
        { side: 'N', laneIndex: 0, tCenter: 3 },
        { side: 'N', laneIndex: 1, tCenter: 4 },
      ]);
    });

    it('handles a step that crosses a corner', () => {
      expect(track.lanesCrossed(5.5, 7.5)).toEqual([{ side: 'E', laneIndex: 0, tCenter: 7 }]);
    });

    it('handles wrap-around past length with un-normalised tCenter', () => {
      expect(track.lanesCrossed(11, 13)).toEqual([{ side: 'W', laneIndex: 0, tCenter: 13 }]);
      expect(track.lanesCrossed(10.5, 11)).toEqual([{ side: 'S', laneIndex: 0, tCenter: 11 }]);
    });

    it('never returns the same lane twice within one lap and matches laneSequence', () => {
      const crossed = track.lanesCrossed(0, 12).map((l) => `${l.side}${l.laneIndex}`);
      expect(new Set(crossed).size).toBe(crossed.length);
      expect(crossed).toEqual(track.laneSequence().map((l) => `${l.side}${l.laneIndex}`));
      expect(crossed).toEqual(['W0', 'N0', 'N1', 'N2', 'E0', 'S2', 'S1', 'S0']);
    });
  });

  describe('lap', () => {
    it('isLapComplete is based on distanceTraveled >= length - epsilon, not on t', () => {
      const track = make(1, 3);
      expect(track.isLapComplete(12)).toBe(true);
      expect(track.isLapComplete(12 - 1e-12)).toBe(true);
      expect(track.isLapComplete(11.5)).toBe(false);
      expect(track.isLapComplete(0)).toBe(false); // t === entryT at the start is NOT a lap
      expect(track.getCorners().map((c) => c.corner)).toEqual(['SW', 'NW', 'NE', 'SE']);
    });
  });
});
