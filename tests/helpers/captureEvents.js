import { Events } from '../../src/core/Events.js';

/** Subscribe to every domain event; returns the growing list of { type, payload } in emission order. */
export function captureEvents(eventBus) {
  const log = [];
  for (const type of Object.values(Events)) {
    eventBus.on(type, (payload) => log.push({ type, payload }));
  }
  return log;
}
