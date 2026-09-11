import { describe, it, expect } from 'vitest';
import { levels } from '../../src/core/levels/index.js';
import { GridManager } from '../../src/core/GridManager.js';

describe('shipped levels', () => {
  it('every level has an id, a grid and a unit list', () => {
    expect(levels.length).toBeGreaterThan(0);
    for (const level of levels) {
      expect(typeof level.id).toBe('string');
      expect(Array.isArray(level.grid)).toBe(true);
      expect(Array.isArray(level.units)).toBe(true);
    }
  });

  it.todo('every level passes GridManager.validate');
  it.todo('no level starts already cleared');
  it.todo('every colour on the grid has at least one unit in the reserve (warning otherwise)');
});
