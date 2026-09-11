/**
 * "Watermelon", from the 17x18 pixel art in assets/reference/watermelon.png (row 0 = top).
 * Colour ids: 0 empty, 1 black, 2 pink, 3 red, 4 white, 5 green, 6 dark green. What they look like (and the
 * light-blue background) lives in Config.render.levels.watermelon; this file is pure data.
 *
 * Blocks per colour: black 50, pink 18, red 66, white 14, green 28, dark green 16 (192).
 *
 * Reserve (4 columns, read left to right, top to bottom) = a winning launch order. Each unit is sized to what a
 * solo lap can reach once the units before it have finished: the black outline first, then the pink edge, then
 * the red flesh with a single-block black unit for each seed it uncovers, and finally the white, green and dark
 * green rind. Launching a unit before the previous one has finished its lap can leave it walled in behind a
 * colour that is not eaten yet, and a parked unit makes the level unwinnable.
 */
export default {
  id: 'watermelon',
  name: 'Watermelon',
  grid: [
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 1, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 2, 3, 1, 3, 3, 2, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 1, 3, 2, 1, 0, 0, 0, 0],
    [0, 0, 0, 1, 2, 3, 3, 3, 1, 3, 3, 3, 3, 2, 1, 0, 0, 0],
    [0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 1, 0, 0],
    [0, 0, 1, 2, 3, 3, 1, 3, 3, 3, 3, 1, 3, 3, 2, 1, 0, 0],
    [0, 1, 4, 3, 3, 3, 3, 3, 3, 1, 3, 3, 3, 3, 3, 4, 1, 0],
    [1, 5, 5, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 5, 5, 1],
    [1, 5, 5, 5, 5, 4, 4, 3, 3, 3, 3, 4, 4, 5, 5, 5, 5, 1],
    [1, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 1],
    [0, 1, 1, 6, 6, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 1, 1, 0],
    [0, 0, 0, 1, 1, 6, 6, 6, 6, 6, 6, 6, 6, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  ],
  units: [
    // black outline x3, then the pink edge
    { color: 1, capacity: 16 }, { color: 1, capacity: 16 }, { color: 1, capacity: 12 }, { color: 2, capacity: 16 },
    // rest of the pink, red flesh; single-block black units take each seed as the red around it is eaten
    { color: 2, capacity: 2 }, { color: 3, capacity: 16 }, { color: 1, capacity: 1 }, { color: 3, capacity: 16 },
    { color: 1, capacity: 3 }, { color: 3, capacity: 15 }, { color: 1, capacity: 1 }, { color: 3, capacity: 9 },
    { color: 1, capacity: 1 }, { color: 3, capacity: 6 }, { color: 3, capacity: 3 }, { color: 3, capacity: 1 },
    // the rind: white, green, dark green
    { color: 4, capacity: 14 }, { color: 5, capacity: 16 }, { color: 5, capacity: 12 }, { color: 6, capacity: 16 },
  ],
};
