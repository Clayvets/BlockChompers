import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { parseGlb, readAccessor, meshNodes, transformPoint } from '../../tools/glb/inspectGlb.mjs';
import { computeTrackPieces } from '../../src/render/layout/computeTrackPieces.js';

const EPS = 1e-4;
const load = (file) => parseGlb(fs.readFileSync(new URL(`../../public/assets/models/${file}`, import.meta.url)));

/** A GLB's triangles in glTF space (x, y up, z), plus its vertices with their material names. */
function geometry(glb) {
  const triangles = [];
  const vertices = [];
  for (const { mesh, matrix } of meshNodes(glb.json)) {
    for (const prim of glb.json.meshes[mesh].primitives) {
      const material = glb.json.materials[prim.material]?.name;
      const { array } = readAccessor(glb, prim.attributes.POSITION);
      const points = [];
      for (let i = 0; i < array.length; i += 3) points.push(transformPoint(matrix, [array[i], array[i + 1], array[i + 2]]));
      points.forEach((p) => vertices.push({ p, material }));
      const index = prim.indices !== undefined ? readAccessor(glb, prim.indices).array : points.map((_, i) => i);
      for (let i = 0; i < index.length; i += 3) triangles.push([points[index[i]], points[index[i + 1]], points[index[i + 2]]]);
    }
  }
  return { triangles, vertices };
}

const PIECES = { straight: geometry(load('track_straight.glb')), corner: geometry(load('track_corner.glb')) };

/** Board cell point -> the piece's local frame (undo the cell centre, then the quarter turns). */
function toLocal(piece, x, z) {
  let [lx, lz] = [x - piece.x, z - piece.y];
  for (let i = 0; i < (4 - piece.rotation) % 4; i += 1) [lx, lz] = [lz, -lx]; // inverse of +Z -> +X, +X -> -Z
  return [lx, lz];
}

/** Height of a piece's top surface above local (x, z), as seen from the top-down camera; null where it has none. */
function topHeight(triangles, x, z) {
  let top = null;
  for (const [a, b, c] of triangles) {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-12) continue; // vertical wall: invisible from above
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const w = 1 - u - v;
    if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
    const y = u * a[1] + v * b[1] + w * c[1];
    if (top === null || y > top) top = y;
  }
  return top;
}

describe('track pieces side by side (exported GLBs)', () => {
  it('are one cell long, with the canal exactly one cell wide and the rim outside it', () => {
    const xs = (list) => list.map((v) => v.p[0]);
    const zs = (list) => list.map((v) => v.p[2]);
    const straight = PIECES.straight.vertices;
    expect(Math.min(...xs(straight))).toBeCloseTo(-0.5, 4);
    expect(Math.max(...xs(straight))).toBeCloseTo(0.5, 4);
    const water = straight.filter((v) => v.material === 'Mat_CanalWater');
    expect(Math.min(...zs(water))).toBeCloseTo(-0.5, 4);
    expect(Math.max(...zs(water))).toBeCloseTo(0.5, 4);
    expect(Math.max(...zs(straight))).toBeGreaterThan(0.5); // outer rim, outward (+Z)
    expect(Math.min(...zs(straight))).toBeCloseTo(-0.5, 4); // nothing inward of the canal: no inner rim
    const corner = PIECES.corner.vertices;
    expect(Math.min(...xs(corner))).toBeCloseTo(-0.5, 4);
    expect(Math.min(...zs(corner))).toBeCloseTo(-0.5, 4);
  });

  it('never reach into a neighbouring cell', () => {
    for (const piece of computeTrackPieces({ rows: 2, cols: 3, margin: 1, direction: 'cw', entryCorner: 'SW' })) {
      for (const { p } of PIECES[piece.type].vertices) {
        // Local frame of the exported piece: inward (-Z) and, for a corner, west (-X) stop at the cell edge; a
        // straight also stops at both ends (+-X). Only the outer rim (+Z, and +X for a corner) reaches outside.
        expect(p[2], `${piece.type} ${piece.side}`).toBeGreaterThan(-0.5 - EPS);
        expect(p[0], `${piece.type} ${piece.side}`).toBeGreaterThan(-0.5 - EPS);
        if (piece.type === 'straight') expect(p[0], `${piece.type} ${piece.side}`).toBeLessThan(0.5 + EPS);
      }
    }
  });

  it('continue across every joint: the same top surface on both sides, no step and no hole', () => {
    const pieces = computeTrackPieces({ rows: 2, cols: 3, margin: 1, direction: 'cw', entryCorner: 'SW' });
    const byCell = new Map(pieces.map((p) => [`${p.x},${p.y}`, p]));
    const delta = 1e-3;
    let joints = 0;
    for (const a of pieces) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const b = byCell.get(`${a.x + dx},${a.y + dy}`);
        if (!b) continue;
        joints += 1;
        // Sample the joint line (board cell units) across the whole cross-section and beyond it.
        const along = dx ? a.x + 0.5 : a.y + 0.5;
        const across = dx ? a.y : a.x;
        let covered = 0;
        for (let i = 0; i <= 400; i += 1) {
          const t = across - 1.2 + (2.4 * i) / 400;
          const [ax, az] = dx ? [along - delta, t] : [t, along - delta];
          const [bx, bz] = dx ? [along + delta, t] : [t, along + delta];
          const ha = topHeight(PIECES[a.type].triangles, ...toLocal(a, ax, az));
          const hb = topHeight(PIECES[b.type].triangles, ...toLocal(b, bx, bz));
          const where = `${a.type} ${a.side} | ${b.type} ${b.side} at ${t.toFixed(3)}`;
          expect(ha === null, `${where}: surface on one side only (a gap)`).toBe(hb === null);
          if (ha === null) continue;
          covered += 1;
          expect(Math.abs(ha - hb), `${where}: step ${ha.toFixed(5)} vs ${hb.toFixed(5)}`).toBeLessThan(1e-6);
        }
        expect(covered, `joint ${a.type} ${a.side} -> ${b.type} ${b.side}`).toBeGreaterThan(200); // canal + rim, about 1.44 cell
      }
    }
    expect(joints).toBe(pieces.length); // a closed ring: as many joints as pieces
  });
});
