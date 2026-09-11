/**
 * Level format (pure data):
 *   id    -- stable content id; Config.render.levels keys per-level presentation on it.
 *   name  -- display name.
 *   grid  -- number[][]; 0 = empty, 1 = colour A, 2 = colour B, ... (see Config.grid.colors).
 *            Zero rows/cols are legal padding: units simply find no target on those lanes.
 *   units -- reserve contents in row-major order (Config.inventory.reserveCols per reserve row).
 *            capacity defaults to Config.units.defaultCapacity when omitted.
 *   balance -- per colour, unit capacities must sum EXACTLY to that colour's block count
 *            (GameManager.validateLevel rejects the level otherwise).
 *
 * Starter: colour 1 has 4 blocks (units 1 + 2 + 1), colour 2 has 3 blocks (units 2 + 1).
 */
export default {
  id: 'starter',
  name: 'Starter',
  grid: [
    [0, 1, 1, 0, 2],
    [0, 0, 0, 0, 0],
    [2, 2, 0, 1, 1],
  ],
  units: [
    { color: 1, capacity: 1 },
    { color: 2, capacity: 2 },
    { color: 1, capacity: 2 },
    { color: 2, capacity: 1 },
    { color: 1, capacity: 1 },
  ],
};
