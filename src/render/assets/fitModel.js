/**
 * Size math for the styled models (pure: no three, no DOM). Bounding boxes are { size: [x, y, z] } in the model's own
 * units, as GLTFLoader gives them (Y-up).
 */

/** Uniform scale that makes a model `lengthOf(bbox)` long equal `target`: the fish's length is its X extent. */
export function scaleToLength(bboxSize, target, axis = 0) {
  const length = bboxSize[axis];
  if (!(length > 0)) throw new Error(`scaleToLength: model has no extent on axis ${axis}`);
  return target / length;
}

/**
 * Length (world units) of a fish on a level: render.layout.unitSize x scale, shrunk when needed so its width stays
 * within canalFit x cellSize, the canal being one cell wide. It is the same in the reserve, the slots and on the track.
 * @param {{ unitSize: number, scale?: number, cellSize: number, canalFit: number, widthOverLength: number }} p
 */
export function fishLength({ unitSize, scale = 1, cellSize, canalFit, widthOverLength }) {
  const wanted = unitSize * scale;
  return Math.min(wanted, (canalFit * cellSize) / widthOverLength);
}

/** The fish's width as a fraction of the canal (one cell). */
export function canalRatio(length, widthOverLength, cellSize) {
  return (length * widthOverLength) / cellSize;
}
