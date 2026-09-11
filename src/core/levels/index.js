import watermelon from './watermelon.js';
import starter from './starter.js';

/** Shipped levels in play order (the progression loops back to the first after the last). */
export const levels = Object.freeze([watermelon, starter]);

export { watermelon, starter };
