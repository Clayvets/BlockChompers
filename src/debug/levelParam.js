/**
 * Debug level select. `?<param>=<id>` (e.g. ?level=starter) names a level from the library to load on its own,
 * outside the normal progression. Pure: takes the query string, returns the level definition or null.
 * @param {string} search    location.search, e.g. '?level=panda'
 * @param {Record<string, object>} library  levels by id (levelLibrary)
 * @param {string} param     Config.debug.levelParam; empty disables the select
 * @returns {{ id: string|null, level: object|null }} id = the requested id (even if unknown), level = its definition
 */
export function pickDebugLevel(search, library, param) {
  if (!param) return { id: null, level: null };
  const id = new URLSearchParams(search).get(param);
  if (!id) return { id: null, level: null };
  return { id, level: Object.prototype.hasOwnProperty.call(library, id) ? library[id] : null };
}
