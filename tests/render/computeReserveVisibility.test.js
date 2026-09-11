import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { computeReserveVisibility, reserveColumnsOf } from '../../src/render/layout/computeReserveVisibility.js';
import { createTestGame } from '../helpers/createTestGame.js';
import { levelLibrary } from '../../src/core/levels/index.js';
import { UnitState } from '../../src/core/Unit.js';

const ROWS = 3;
const ids = (list) => list.map((unit) => unit.id);
/** A column of `n` units named c<col>u<row>. */
const column = (col, n) => Array.from({ length: n }, (_, row) => `c${col}u${row}`);
/** The same columns after the front unit of `col` launched: the rest move up one row. */
const pick = (columns, col) => columns.map((ids, i) => (i === col ? ids.slice(1) : ids));

describe('computeReserveVisibility (pure, node)', () => {
  it('has no three.js or DOM dependency', () => {
    const source = fs.readFileSync(new URL('../../src/render/layout/computeReserveVisibility.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"]three['"]|\bdocument\b|\bwindow\b|performance\.now/);
  });

  it('shows at most the first 3 rows of every column, with their row index, and hides the rest', () => {
    const columns = [column(0, 7), column(1, 5), column(2, 3), column(3, 6)];
    const { visible, hidden, entering } = computeReserveVisibility(columns, ROWS);
    for (let col = 0; col < columns.length; col += 1) {
      const shown = visible.filter((unit) => unit.col === col);
      expect(shown.map((unit) => unit.row)).toEqual([0, 1, 2]);
      expect(ids(shown)).toEqual(columns[col].slice(0, ROWS));
    }
    expect(ids(hidden).sort()).toEqual([...columns[0].slice(3), ...columns[1].slice(3), ...columns[3].slice(3)].sort());
    expect(hidden.every((unit) => unit.row >= ROWS)).toBe(true);
    expect(entering).toEqual([]); // a level's first draw: nothing slides in
  });

  it('after a pick, the column moves up and the unit from row 3 becomes visible and entering in row 2', () => {
    const before = [column(0, 5), column(1, 4), column(2, 2), column(3, 0)];
    const after = pick(before, 1);
    const { visible, entering, hidden } = computeReserveVisibility(after, ROWS, before);
    expect(entering).toEqual([{ id: 'c1u3', col: 1, row: 2 }]);
    expect(visible.filter((unit) => unit.col === 1)).toEqual([
      { id: 'c1u1', col: 1, row: 0 },
      { id: 'c1u2', col: 1, row: 1 },
      { id: 'c1u3', col: 1, row: 2 },
    ]);
    expect(ids(hidden)).toEqual(['c0u3', 'c0u4']); // the other columns did not move
    // The next pick in the same column has no unit left below: nothing enters.
    const again = computeReserveVisibility(pick(after, 1), ROWS, after);
    expect(again.entering).toEqual([]);
    expect(again.visible.filter((unit) => unit.col === 1).map((unit) => unit.row)).toEqual([0, 1]);
  });

  it('handles columns shorter than 3 and empty columns', () => {
    const columns = [column(0, 2), [], column(2, 1), []];
    const { visible, hidden, entering } = computeReserveVisibility(columns, ROWS, columns);
    expect(visible).toEqual([
      { id: 'c0u0', col: 0, row: 0 },
      { id: 'c0u1', col: 0, row: 1 },
      { id: 'c2u0', col: 2, row: 0 },
    ]);
    expect(hidden).toEqual([]);
    expect(entering).toEqual([]);
    expect(computeReserveVisibility([[], [], [], []], ROWS, columns)).toEqual({ visible: [], entering: [], hidden: [] });
  });

  it('does not treat units reappearing after a restart as entering', () => {
    const start = [column(0, 5)];
    const later = pick(pick(start, 0), 0); // two launched
    const restarted = computeReserveVisibility(start, ROWS, later); // they are back in rows 0 and 1
    expect(restarted.entering).toEqual([]);
    expect(ids(restarted.visible)).toEqual(['c0u0', 'c0u1', 'c0u2']);
  });

  it('follows a real game: picking a front unit reveals the next one of its column (Carrot, 7 rows deep)', () => {
    const { game } = createTestGame({ level: levelLibrary.carrot });
    const columnsOf = () => {
      const { units, inventory } = game.getSnapshot();
      return reserveColumnsOf(units, inventory.reserveCols, UnitState.RESERVE);
    };
    const before = columnsOf();
    expect(Math.max(...before.map((ids) => ids.length))).toBeGreaterThan(ROWS);
    const col = before.findIndex((ids) => ids.length > ROWS);
    const fourth = before[col][ROWS];
    expect(computeReserveVisibility(before, ROWS).hidden.map((unit) => unit.id)).toContain(fourth);
    expect(game.activateUnit(before[col][0]).ok).toBe(true);
    const after = columnsOf();
    const { visible, entering } = computeReserveVisibility(after, ROWS, before);
    expect(entering).toEqual([{ id: fourth, col, row: ROWS - 1 }]);
    expect(visible.filter((unit) => unit.col === col)).toHaveLength(ROWS);
  });
});
