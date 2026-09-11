/**
 * Which reserve units are drawn (pure: no three, no DOM). The reserve shows only the first `visibleRows` rows of each
 * column; deeper units are hidden, and never picked. When a column moves up (its front unit launched), the unit that
 * reaches the last visible row from below is "entering": the Renderer slides it in from under that row while it fades
 * in.
 *
 * @param {Array<Array<string>>} reserveColumns  per column, the ids of its reserve units, front (row 0) first
 * @param {number} visibleRows
 * @param {Array<Array<string>> | null} [previousColumns]  the columns before this change; null (a level's first draw)
 *   means nothing enters. A unit that was not in the reserve before (a restart) does not enter either: it appears.
 * @returns {{ visible: Array<{ id: string, col: number, row: number }>,
 *             entering: Array<{ id: string, col: number, row: number }>,
 *             hidden: Array<{ id: string, col: number, row: number }> }}
 */
export function computeReserveVisibility(reserveColumns, visibleRows, previousColumns = null) {
  const before = new Map();
  if (previousColumns) previousColumns.forEach((ids, col) => ids.forEach((id, row) => before.set(id, { col, row })));
  const visible = [];
  const entering = [];
  const hidden = [];
  reserveColumns.forEach((ids, col) => {
    ids.forEach((id, row) => {
      const unit = { id, col, row };
      if (row >= visibleRows) {
        hidden.push(unit);
        return;
      }
      visible.push(unit);
      const was = before.get(id);
      if (was && was.col === col && was.row >= visibleRows) entering.push(unit);
    });
  });
  return { visible, entering, hidden };
}

/**
 * The snapshot's reserve as columns of unit ids, front first (the input of computeReserveVisibility).
 * @param {Array<{ id: string, state: string, reservePos: { col: number, row: number } }>} units
 * @param {number} cols
 * @param {string} reserveState  UnitState.RESERVE
 */
export function reserveColumnsOf(units, cols, reserveState) {
  const columns = Array.from({ length: cols }, () => []);
  for (const unit of units) {
    if (unit.state !== reserveState) continue;
    const { col, row } = unit.reservePos;
    if (col >= 0 && col < cols) columns[col][row] = unit.id;
  }
  return columns.map((ids) => ids.filter((id) => id !== undefined));
}
