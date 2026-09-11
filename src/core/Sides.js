/**
 * Grid/side conventions shared by GridManager and Track -- the single source of truth for
 * "which way is inward", so the mirrored E/S lanes cannot drift between the two classes.
 *
 * matrix[row][col]; row 0 is the TOP edge (N), col 0 is the LEFT edge (W).
 * Cell-unit positions: origin at the grid's top-left corner, x -> right, y -> down.
 */
export const Side = Object.freeze({ N: 'N', E: 'E', S: 'S', W: 'W' });

/** Step {dr, dc} that walks from a given edge INTO the grid. */
export const INWARD = Object.freeze({
  N: Object.freeze({ dr: 1, dc: 0 }),
  S: Object.freeze({ dr: -1, dc: 0 }),
  W: Object.freeze({ dr: 0, dc: 1 }),
  E: Object.freeze({ dr: 0, dc: -1 }),
});

/** Corner names, used by Config.track.entry. */
export const Corner = Object.freeze({ NW: 'NW', NE: 'NE', SE: 'SE', SW: 'SW' });

/** Side order when walking the perimeter clockwise (top-down view), starting at the NW corner. */
export const CW_ORDER = Object.freeze([Side.N, Side.E, Side.S, Side.W]);
