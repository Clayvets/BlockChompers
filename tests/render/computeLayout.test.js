import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { computeLayout, fitView, boardPoint, rectCenter } from '../../src/render/layout/computeLayout.js';
import { levelLibrary } from '../../src/core/levels/index.js';
import { Config } from '../../src/config/Config.js';

const LAYOUT = { ...Config.render.layout, slotCount: Config.inventory.activeSlots, reserveCols: Config.inventory.reserveCols };
const PHONE = 390 / (844 - Config.ui.sizes.barHeight); // usable portrait viewport below the HUD
const dimsOf = (level) => ({
  rows: level.grid.length,
  cols: level.grid[0].length,
  margin: Config.track.margin,
  reserveRows: Math.ceil(level.units.length / Config.inventory.reserveCols),
});
const LEVELS = Object.entries(levelLibrary).map(([id, level]) => ({ id, dims: dimsOf(level) }));
const layoutOf = (dims, aspect = PHONE) => computeLayout(dims, LAYOUT, aspect);
const EPS = 1e-9;
const inside = (r, outer) => r.x >= outer.x - EPS && r.y >= outer.y - EPS && r.x + r.w <= outer.x + outer.w + EPS && r.y + r.h <= outer.y + outer.h + EPS;
const overlaps = (a, b) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
const constantParts = ({ design, boardRegion, slotsRegion, reserveRegion, slots, reserve, unit, label, counter }) =>
  ({ design, boardRegion, slotsRegion, reserveRegion, slots, reserve, unit, label, counter });

describe('computeLayout (pure, node)', () => {
  it('has no three.js or DOM dependency', () => {
    const source = fs.readFileSync(new URL('../../src/render/layout/computeLayout.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"]three['"]|\bdocument\b|\bwindow\b|performance\.now/);
  });

  it('gives deep-equal slot, reserve, unit, label and counter rects on every level', () => {
    const [first, ...rest] = LEVELS.map(({ dims }) => constantParts(layoutOf(dims)));
    expect(LEVELS.map((l) => l.id).sort()).toEqual(['carrot', 'panda', 'starter', 'watermelon']);
    for (const other of rest) expect(other).toEqual(first);
    expect(first.slots).toHaveLength(Config.inventory.activeSlots);
    expect(first.unit.size).toBe(Config.render.layout.unitSize);
    expect(Math.max(...LEVELS.map((l) => l.dims.reserveRows))).toBeLessThanOrEqual(first.reserve.rows); // Carrot's 7 rows fit
  });

  it('keeps every board inside boardRegion, and units on its ring clear of the slots, the reserve and the design edge', () => {
    for (const { id, dims } of LEVELS) {
      const layout = layoutOf(dims);
      expect(inside(layout.board, layout.boardRegion), id).toBe(true);
      // A unit on the ring reaches unitSize / 2 past the outer cell centres, which sit cellSize / 2 inside the board.
      const reach = Math.max(0, (layout.unit.size - layout.cellSize) / 2);
      const withUnits = { x: layout.board.x - reach, y: layout.board.y - reach, w: layout.board.w + 2 * reach, h: layout.board.h + 2 * reach };
      expect(inside(withUnits, layout.design), id).toBe(true);
      expect(overlaps(withUnits, layout.slotsRegion), id).toBe(false);
      expect(overlaps(withUnits, layout.reserveRegion), id).toBe(false);
      expect(layout.reserveOverflow, id).toBe(false);
    }
  });

  it('keeps the regions apart and inside the design', () => {
    const { design, boardRegion, slotsRegion, reserveRegion, slots, reserve } = layoutOf(LEVELS[0].dims);
    for (const region of [boardRegion, slotsRegion, reserveRegion]) expect(inside(region, design)).toBe(true);
    expect(overlaps(boardRegion, slotsRegion) || overlaps(slotsRegion, reserveRegion) || overlaps(boardRegion, reserveRegion)).toBe(false);
    for (const slot of slots) expect(inside(slot, slotsRegion)).toBe(true);
    for (const cell of reserve.cells) expect(inside(cell, reserveRegion)).toBe(true);
  });

  it('shrinks cellSize for bigger boards and clamps small ones to maxCellSize', () => {
    const cell = Object.fromEntries(LEVELS.map(({ id, dims }) => [id, layoutOf(dims).cellSize]));
    expect(cell.carrot).toBeLessThan(cell.panda);
    expect(cell.panda).toBeLessThan(cell.watermelon);
    expect(cell.watermelon).toBeLessThan(Config.render.layout.maxCellSize);
    expect(cell.starter).toBe(Config.render.layout.maxCellSize);
    expect(layoutOf({ rows: 1, cols: 1, margin: 1 }).cellSize).toBe(Config.render.layout.maxCellSize);
    const { boardRegion } = Config.render.layout;
    expect(cell.carrot).toBeCloseTo(Math.min(boardRegion.w / 25, boardRegion.h / 41), 12); // 23 + 2 cols, 39 + 2 rows
  });

  it('centres the board in boardRegion and maps logic cells onto it', () => {
    for (const { id, dims } of LEVELS) {
      const layout = layoutOf(dims);
      const [a, b] = [rectCenter(layout.board), rectCenter(layout.boardRegion)];
      expect(a.x, id).toBeCloseTo(b.x, 9);
      expect(a.y, id).toBeCloseTo(b.y, 9);
      const m = dims.margin;
      // The ring's outer cell centres are half a cell inside the board edges.
      const near = boardPoint(layout, -m + 0.5, -m + 0.5);
      expect(near.x).toBeCloseTo(layout.board.x + layout.cellSize / 2, 9);
      expect(near.y).toBeCloseTo(layout.board.y + layout.cellSize / 2, 9);
      const far = boardPoint(layout, dims.cols + m - 0.5, dims.rows + m - 0.5);
      expect(far.x).toBeCloseTo(layout.board.x + layout.board.w - layout.cellSize / 2, 9);
      expect(far.y).toBeCloseTo(layout.board.y + layout.board.h - layout.cellSize / 2, 9);
    }
  });

  it('scales everything uniformly when the viewport aspect changes', () => {
    const aspects = [0.4, PHONE, 9 / 16, 1, 16 / 9];
    const carrot = LEVELS.find((l) => l.id === 'carrot').dims;
    const base = layoutOf(carrot, aspects[0]);
    const { view: _, ...designParts } = base;
    const screenRatios = [];
    for (const aspect of aspects) {
      const layout = layoutOf(carrot, aspect);
      const { view, ...rest } = layout;
      expect(rest).toEqual(designParts); // nothing in design space depends on the viewport
      expect(view.w / view.h).toBeCloseTo(aspect, 9);
      expect(inside(layout.design, view)).toBe(true);
      expect(rectCenter(view).x).toBeCloseTo(rectCenter(layout.design).x, 9);
      expect(rectCenter(view).y).toBeCloseTo(rectCenter(layout.design).y, 9);
      // On a 1000 px tall viewport: one px scale for both axes, so every size keeps its ratio to the others.
      const pxPerUnitX = (1000 * aspect) / view.w;
      const pxPerUnitY = 1000 / view.h;
      expect(pxPerUnitX).toBeCloseTo(pxPerUnitY, 9);
      screenRatios.push([layout.slots[0].w * pxPerUnitY, layout.board.h * pxPerUnitY, layout.unit.size * pxPerUnitY]);
    }
    for (const [slot, board, unit] of screenRatios) {
      expect(slot / board).toBeCloseTo(screenRatios[0][0] / screenRatios[0][1], 9);
      expect(unit / slot).toBeCloseTo(screenRatios[0][2] / screenRatios[0][0], 9);
    }
    expect(fitView(10, 20, 0)).toEqual({ x: 0, y: 0, w: 10, h: 20 }); // a bad aspect falls back to the design
  });
});
