/** Matrices used across core tests. 0 = empty, 1 = colour A, 2 = colour B. */

export const SINGLE_LANE = [[1, 1, 1]];

export const TWO_COLORS_3x3 = [
  [1, 2, 1],
  [2, 1, 2],
  [1, 2, 1],
];

/** Zero padding on every side and between blocks. */
export const PADDED_5x5 = [
  [0, 0, 0, 0, 0],
  [0, 1, 0, 2, 0],
  [0, 0, 0, 0, 0],
  [0, 2, 0, 1, 0],
  [0, 0, 0, 0, 0],
];

/** Non-square on purpose: catches row/col swaps and mirrored lane indices on the E/S sides. */
export const ASYMMETRIC_4x2 = [
  [1, 2, 2, 1],
  [2, 0, 0, 1],
];

/** Invalid: ragged rows. */
export const RAGGED = [[1, 1], [1]];

/** Invalid: a level cannot start already cleared. */
export const ALL_ZERO = [
  [0, 0],
  [0, 0],
];
