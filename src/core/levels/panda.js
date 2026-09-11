/**
 * "Panda", from the 24x22 pixel art in assets/reference/panda.jpeg (checked cell by cell: 0 mismatches). Row 0 = top.
 * Colour ids: 0 empty, 1 black, 2 white, 3 green. Their hex values and the scene background live in
 * Config.render.levels.panda; this file is pure data.
 *
 * Blocks per colour: black 236, white 158, green 26 (420).
 *
 * Reserve (4 columns, read left to right, top to bottom) = a winning launch order with as few units as possible:
 * each unit's capacity is everything one solo lap can reach once the units before it have finished, found by a
 * search over which colour to launch next. Launch each unit after the previous one has finished its lap; an early
 * launch can find its colour still walled in behind the black outline and park.
 */
export default {
  id: 'panda',
  name: 'Panda',
  grid: [
    [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 0, 0],
    [0, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0, 0, 0],
    [0, 0, 1, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 2, 2, 1, 0, 0, 0],
    [0, 0, 1, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 2, 1, 0, 0, 0],
    [0, 0, 1, 2, 2, 1, 1, 2, 1, 2, 2, 2, 2, 1, 2, 1, 1, 2, 1, 0, 0, 0],
    [0, 0, 1, 2, 2, 1, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 1, 2, 1, 0, 0, 0],
    [0, 0, 1, 2, 2, 2, 1, 1, 2, 2, 2, 1, 2, 2, 1, 1, 2, 1, 3, 0, 0, 0],
    [0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 1, 1, 3, 0, 3, 3],
    [0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 3, 3, 3, 0],
    [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, 3, 3, 3, 3, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 1, 2, 3, 3, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 3, 3, 1, 1, 1, 1, 0, 0, 3],
    [0, 0, 1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 3, 3, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 3, 2, 2, 1, 1, 1, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 0, 0],
    [1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  ],
  units: [
    { color: 1, capacity: 79 }, { color: 2, capacity: 30 }, { color: 1, capacity: 43 }, { color: 1, capacity: 32 },
    { color: 2, capacity: 41 }, { color: 2, capacity: 27 }, { color: 1, capacity: 30 }, { color: 2, capacity: 21 },
    { color: 1, capacity: 23 }, { color: 3, capacity: 24 }, { color: 2, capacity: 20 }, { color: 1, capacity: 22 },
    { color: 2, capacity: 19 }, { color: 1, capacity: 7 }, { color: 3, capacity: 2 },
  ],
};
