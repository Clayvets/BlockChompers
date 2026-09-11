import level01 from './level01.js';
import watermelon from './watermelon.js';

/** Shipped levels in play order (the progression loops back to the first after the last). */
export const levels = Object.freeze([level01, watermelon]);

export { level01, watermelon };
