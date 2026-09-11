/**
 * Level format:
 *   grid  -- number[][]; 0 = empty, 1 = colour A, 2 = colour B, ... (see Config.grid.colors).
 *            Zero rows/cols are legal padding: units simply find no target on those lanes.
 *   units -- reserve contents in row-major order (Config.inventory.reserveCols per reserve row).
 *            capacity defaults to Config.units.defaultCapacity when omitted.
 */
export default {
  id: 'level-01',
  grid: [
    [0, 1, 1, 0, 2],
    [0, 0, 0, 0, 0],
    [2, 2, 0, 1, 1],
  ],
  units: [
    { color: 1, capacity: 3 },
    { color: 2, capacity: 4 },
    { color: 1, capacity: 2 },
    { color: 2, capacity: 1 },
    { color: 1, capacity: 1 },
  ],
};
