import { Easing as CORE } from '../../core/easing.js';

/**
 * Presentation easing (render and UI only): the core's pure polynomial curves plus overshoot curves for juice. Core
 * never imports this file, so overshoot can never leak into the deterministic simulation. Every curve maps [0, 1] with
 * f(0) = 0 and f(1) = 1; the "Back" curves leave [0, 1] in between (that is the overshoot).
 */
const C1 = 1.70158;
const C3 = C1 + 1;

export const Easing = Object.freeze({
  ...CORE,
  /** Overshoots past 1, then settles: pops, punches, cards. */
  easeOutBack: (p) => 1 + C3 * (p - 1) * (p - 1) * (p - 1) + C1 * (p - 1) * (p - 1),
  /** Pulls back below 0 first: exits that wind up before leaving. */
  easeInBack: (p) => C3 * p * p * p - C1 * p * p,
  /** Punch: rises to 1 quickly and falls back to 0 (use as a 0 -> 1 -> 0 envelope). */
  punch: (p) => (p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75),
});

export function isEasing(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(Easing, name);
}

/**
 * Apply the named curve to p, clamped to [0, 1]. Returns exactly 0 at p <= 0 and exactly 1 at p >= 1, except for
 * envelope curves like 'punch', which return their own end value (0).
 */
export function ease(name, p) {
  const fn = Easing[name];
  if (!fn) throw new RangeError(`Unknown easing "${name}"; known: ${Object.keys(Easing).join(', ')}`);
  if (!(p > 0)) return 0;
  if (p >= 1) return fn === Easing.punch ? 0 : 1;
  return fn(p);
}
