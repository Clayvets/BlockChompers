import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { Config } from '../../src/config/Config.js';
import { levelLibrary } from '../../src/core/levels/index.js';
import { Track } from '../../src/core/Track.js';
import { computeTrackPieces, trackLoop, ringBounds } from '../../src/render/layout/computeTrackPieces.js';

const { margin, direction, entry } = Config.track;
const LEVELS = Object.values(levelLibrary).map((level) => ({ id: level.id, rows: level.grid.length, cols: level.grid[0].length }));
const CASES = [...LEVELS, { id: '1x1', rows: 1, cols: 1 }, { id: '2x5 margin 2', rows: 2, cols: 5, margin: 2 }];
const OUTWARD = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const FACING = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
/** One quarter turn about +Y in board cell units (x right, y down = world +Z): +Z -> +X, +X -> -Z. */
const turn = ([x, y], q) => {
  let v = [x, y];
  for (let i = 0; i < ((q % 4) + 4) % 4; i += 1) v = [v[1], -v[0]];
  return v.map((c) => c + 0);
};
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function ringCells({ rows, cols, margin: m }) {
  const { x0, x1, y0, y1 } = ringBounds({ rows, cols, margin: m });
  const keys = new Set();
  for (let x = x0; x <= x1; x += 1) {
    keys.add(`${x},${y0}`);
    keys.add(`${x},${y1}`);
  }
  for (let y = y0; y <= y1; y += 1) {
    keys.add(`${x0},${y}`);
    keys.add(`${x1},${y}`);
  }
  return keys;
}

describe('computeTrackPieces (pure, node)', () => {
  it('has no three.js or DOM dependency', () => {
    const src = fs.readFileSync(new URL('../../src/render/layout/computeTrackPieces.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/from\s+['"]three['"]|\bdocument\b|\bwindow\b|performance\.now|Math\.random/);
  });

  it('puts exactly one piece on every ring cell (no gaps, no overlaps) and corners in the 4 corners, on every level', () => {
    for (const c of CASES) {
      const dims = { rows: c.rows, cols: c.cols, margin: c.margin ?? margin };
      const pieces = computeTrackPieces({ ...dims, direction, entryCorner: entry.corner });
      const keys = pieces.map((p) => `${p.x},${p.y}`);
      expect(new Set(keys).size, c.id).toBe(keys.length);
      expect(new Set(keys), c.id).toEqual(ringCells(dims));
      const { x0, x1, y0, y1 } = ringBounds(dims);
      const corners = pieces.filter((p) => p.type === 'corner');
      expect(corners.map((p) => [p.side, p.x, p.y]).sort(), c.id).toEqual([
        ['NE', x1, y0], ['NW', x0, y0], ['SE', x1, y1], ['SW', x0, y1],
      ]);
      const W = c.cols + 2 * dims.margin;
      const H = c.rows + 2 * dims.margin;
      expect(pieces.filter((p) => p.type === 'straight'), c.id).toHaveLength(2 * (W - 2) + 2 * (H - 2));
    }
  });

  it('turns every outer rim outward (straight rim on local +Z, corner rims on +X and +Z)', () => {
    for (const p of computeTrackPieces({ rows: 3, cols: 4, margin, direction, entryCorner: 'SW' })) {
      if (p.type === 'straight') {
        expect(turn([0, 1], p.rotation), p.side).toEqual(OUTWARD[p.side]);
      } else {
        const rims = [turn([1, 0], p.rotation), turn([0, 1], p.rotation)].map((v) => v.join()).sort();
        expect(rims, p.side).toEqual([OUTWARD[p.side[0]], OUTWARD[p.side[1]]].map((v) => v.join()).sort());
      }
    }
  });

  it('heads each piece along core Track travel, clockwise and counter-clockwise (corners on the diagonal)', () => {
    for (const dir of ['cw', 'ccw']) {
      for (const c of LEVELS) {
        const track = new Track({ rows: c.rows, cols: c.cols, margin, direction: dir, entry });
        const byCell = new Map(computeTrackPieces({ rows: c.rows, cols: c.cols, margin, direction: dir }).map((p) => [`${p.x},${p.y}`, p]));
        for (let i = 0; i < track.length; i += 1) {
          const cell = track.cellAt(i);
          const piece = byCell.get(`${cell.x},${cell.y}`);
          const [ox, oy] = FACING[cell.facing];
          if (cell.isCorner) {
            const [ix, iy] = FACING[track.cellAt(i - 1).facing];
            expect(angleDiff(piece.heading, Math.atan2(-(iy + oy), ix + ox)), `${dir} ${c.id} ${cell.corner}`).toBeLessThan(1e-9);
          } else {
            expect(angleDiff(piece.heading, Math.atan2(-oy, ox)), `${dir} ${c.id} ${cell.x},${cell.y}`).toBeLessThan(1e-9);
          }
        }
      }
    }
  });

  it('marks only the entry corner', () => {
    for (const corner of ['NW', 'NE', 'SE', 'SW']) {
      const entries = computeTrackPieces({ rows: 2, cols: 3, margin, direction, entryCorner: corner }).filter((p) => p.entry);
      expect(entries.map((p) => p.side)).toEqual([corner]);
    }
  });
});

describe('trackLoop (chevron path)', () => {
  const dims = { rows: 3, cols: 5, margin: 1 };
  const r = Config.render.models.track.chevrons.cornerRadius;

  it('is a closed rounded rectangle through the ring cell centres', () => {
    const loop = trackLoop({ ...dims, direction: 'cw', cornerRadius: r });
    const { x0, x1, y0, y1 } = ringBounds(dims);
    expect(loop.length).toBeCloseTo(2 * (x1 - x0 - 2 * r) + 2 * (y1 - y0 - 2 * r) + 2 * Math.PI * r, 9);
    const a = loop.sample(0);
    const b = loop.sample(loop.length);
    expect([b.x, b.y]).toEqual([a.x, a.y]);
    let prev = loop.sample(0);
    for (let s = 0.01; s <= loop.length; s += 0.01) {
      const p = loop.sample(s);
      expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(0.0101); // continuous
      expect(angleDiff(p.heading, prev.heading)).toBeLessThan(0.03); // smooth: no kink at the corners
      const onEdge = Math.min(Math.abs(p.x - x0), Math.abs(p.x - x1), Math.abs(p.y - y0), Math.abs(p.y - y1));
      expect(onEdge).toBeLessThan(r * (1 - Math.SQRT1_2) + 1e-9); // on the ring line, or inside the rounded corner
      prev = p;
    }
  });

  it('runs the other way counter-clockwise', () => {
    const cw = trackLoop({ ...dims, direction: 'cw', cornerRadius: r });
    const ccw = trackLoop({ ...dims, direction: 'ccw', cornerRadius: r });
    for (const s of [0.3, 2.9, 7.1, 12.4]) {
      const a = cw.sample(cw.length - s);
      const b = ccw.sample(s);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
      expect(angleDiff(b.heading, a.heading + Math.PI)).toBeLessThan(1e-9);
    }
    // Clockwise on screen means east along the top edge.
    expect(cw.sample(0.5).heading).toBeCloseTo(0, 9);
  });
});
