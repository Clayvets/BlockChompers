/**
 * Easing curves shared by core (acceleration, final-rush ramp) and render (launch curve, return, reserve shift).
 * Pure polynomials only -- no trig, no clock -- so the logic stays bit-for-bit deterministic. Every curve maps
 * [0, 1] onto [0, 1] with f(0) = 0 and f(1) = 1; ease() clamps its input first. Config keys hold the curve NAME.
 */
export const Easing = Object.freeze({
  linear: (p) => p,
  easeInQuad: (p) => p * p,
  easeOutQuad: (p) => 1 - (1 - p) * (1 - p),
  easeInOutQuad: (p) => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p)),
  easeInCubic: (p) => p * p * p,
  easeOutCubic: (p) => 1 - (1 - p) * (1 - p) * (1 - p),
  easeInOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - 4 * (1 - p) * (1 - p) * (1 - p)),
});

/** True when `name` is a known easing curve. */
export function isEasing(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(Easing, name);
}

/**
 * Apply the named curve to progress `p`, clamped to [0, 1]; exactly 0 and 1 at the ends.
 * @param {string} name a key of Easing
 * @param {number} p progress
 * @returns {number}
 */
export function ease(name, p) {
  if (!isEasing(name)) throw new RangeError(`Unknown easing "${name}"; known: ${Object.keys(Easing).join(', ')}`);
  if (!(p > 0)) return 0;
  if (p >= 1) return 1;
  return Easing[name](p);
}
