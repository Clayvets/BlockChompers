import watermelon from './watermelon.js';
import starter from './starter.js';
import panda from './panda.js';
import carrot from './carrot.js';

/** Play order: Level 1 (Watermelon) -> Panda -> Carrot, then back to Level 1 (the progression is a cycle). */
export const levels = Object.freeze([watermelon, panda, carrot]);

/** Every level by id, including those outside the progression (debug level select: ?level=<id>). */
export const levelLibrary = Object.freeze({ watermelon, starter, panda, carrot });

export { watermelon, starter, panda, carrot };
