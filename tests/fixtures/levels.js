import { SINGLE_LANE, TWO_COLORS_3x3 } from './grids.js';

export const SINGLE_LANE_LEVEL = {
  id: 'test-single-lane',
  grid: SINGLE_LANE,
  units: [{ color: 1, capacity: 3 }],
};

export const TWO_COLORS_LEVEL = {
  id: 'test-two-colors',
  grid: TWO_COLORS_3x3,
  units: [
    { color: 1, capacity: 5 },
    { color: 2, capacity: 4 },
  ],
};
