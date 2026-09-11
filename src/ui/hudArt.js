/**
 * Loads the styled HUD (Config.ui.hud) before the UI mounts: the settings button, both bars and the coin icon, each
 * decoded (AssetLoader.loadImage), plus the label font (the loadUiFont promise main.js shares with the start screen).
 * Resolves to the images, or to null when anything failed: the console names the missing files and the UIManager keeps
 * the flat v3 HUD bar.
 *
 * @param {object} config  Config.ui.hud
 * @param {{ loadImage: (url: string) => Promise<HTMLImageElement | null> }} assets  the AssetLoader
 * @param {{ font: Promise<boolean>, fontUrl: string }} env  the font load and its file (for the message)
 * @returns {Promise<{ settings: HTMLImageElement, levelBar: HTMLImageElement, coinBar: HTMLImageElement,
 *                     coin: HTMLImageElement } | null>}
 */
export async function loadHudArt(config, assets, { font, fontUrl }) {
  const keys = ['settings', 'levelBar', 'coinBar', 'coin'];
  const [images, fontLoaded] = await Promise.all([Promise.all(keys.map((key) => assets.loadImage(config[key].url))), font]);
  const missing = keys.filter((_, i) => !images[i]).map((key) => `"${config[key].url}"`);
  if (!fontLoaded) missing.push(`"${fontUrl}"`);
  if (missing.length) {
    console.error(`HUD: could not load ${missing.join(', ')}; using the flat v3 HUD instead`);
    return null;
  }
  return Object.fromEntries(keys.map((key, i) => [key, images[i]]));
}
