import { describe, it, expect } from 'vitest';
import { Config } from '../../src/config/Config.js';
import { levelLibrary } from '../../src/core/levels/index.js';
import { computeLayout } from '../../src/render/layout/computeLayout.js';
import { scaleToLength, fishLength, canalRatio } from '../../src/render/assets/fitModel.js';

const { layout } = Config.render;
const fish = Config.render.models.fish;
/** The exported fish's bounding box (glTF, rest pose): see tests/tools/glb.test.js. */
const FISH_WIDTH_OVER_LENGTH = 0.559;

const cellSizeOf = (level) => computeLayout(
  { rows: level.grid.length, cols: level.grid[0].length, margin: Config.track.margin, reserveRows: Math.ceil(level.units.length / Config.inventory.reserveCols) },
  { ...layout, slotCount: Config.inventory.activeSlots, reserveCols: Config.inventory.reserveCols },
  0.5,
).cellSize;

describe('model size normalisation (pure)', () => {
  it('scales a model so its length axis matches the target', () => {
    expect(scaleToLength([1.0004, 0.588, 0.559], 0.6)).toBeCloseTo(0.6 / 1.0004, 12);
    expect(scaleToLength([2, 1, 4], 1, 2)).toBe(0.25);
    expect(() => scaleToLength([0, 1, 1], 1)).toThrow(/no extent/);
  });

  it('keeps unitSize x scale where the fish fits the canal, and shrinks it to canalFit where it would not', () => {
    const base = { unitSize: 0.6, scale: 1, canalFit: 0.8, widthOverLength: 0.5 };
    expect(fishLength({ ...base, cellSize: 1 })).toBe(0.6); // width 0.3 <= 0.8
    expect(fishLength({ ...base, cellSize: 0.25 })).toBeCloseTo(0.4, 12); // width held at 0.8 x 0.25 = 0.2
    expect(fishLength({ ...base, scale: 0.5, cellSize: 0.25 })).toBeCloseTo(0.3, 12);
    expect(canalRatio(0.4, 0.5, 0.25)).toBeCloseTo(0.8, 12);
  });

  it('fits every level: the fish is never wider than canalFit of its one-cell canal', () => {
    for (const level of Object.values(levelLibrary)) {
      const cellSize = cellSizeOf(level);
      const length = fishLength({ unitSize: layout.unitSize, scale: fish.scale, canalFit: fish.canalFit, cellSize, widthOverLength: FISH_WIDTH_OVER_LENGTH });
      expect(canalRatio(length, FISH_WIDTH_OVER_LENGTH, cellSize), level.id).toBeLessThanOrEqual(fish.canalFit + 1e-12);
      expect(length, level.id).toBeLessThanOrEqual(layout.unitSize * fish.scale);
    }
  });
});
