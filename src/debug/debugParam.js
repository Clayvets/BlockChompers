/**
 * Debug switch from the URL (pure): ?debug (Config.debug.panelParam) turns the debug panel on in any build, for
 * profiling the production bundle, without changing Config.debug.enabled.
 * @param {string} search location.search, e.g. "?debug" or "?level=carrot&debug=1"
 * @param {string} param the parameter name; '' = never
 */
export function hasDebugParam(search, param) {
  if (!param || !search) return false;
  const value = new URLSearchParams(search).get(param);
  return value !== null && value !== '0' && value !== 'false';
}
