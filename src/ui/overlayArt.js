/**
 * Loads the styled overlays' images (Config.ui.overlays) before the UI mounts: the big coin and the sad block, cut from
 * the mockups by tools/ui, and the green pill of the Play button (shared with the start screen: AssetLoader caches it),
 * each decoded (AssetLoader.loadImage), plus the label font (the loadUiFont promise main.js shares). Resolves to the
 * images, or to null when anything failed: the console names the missing files and the UIManager keeps the flat v3
 * cards.
 *
 * @param {object} ui  Config.ui
 * @param {{ loadImage: (url: string) => Promise<HTMLImageElement | null> }} assets  the AssetLoader
 * @param {{ font: Promise<boolean> }} env  the font load
 * @returns {Promise<{ coin: HTMLImageElement, sadBlock: HTMLImageElement, button: HTMLImageElement } | null>}
 */
export async function loadOverlayArt(ui, assets, { font }) {
  const urls = { coin: ui.overlays.coin, sadBlock: ui.overlays.sadBlock, button: ui.startScreen.button };
  const keys = Object.keys(urls);
  const [images, fontLoaded] = await Promise.all([Promise.all(keys.map((key) => assets.loadImage(urls[key]))), font]);
  const missing = keys.filter((_, i) => !images[i]).map((key) => `"${urls[key]}"`);
  if (!fontLoaded) missing.push(`"${ui.startScreen.font.url}"`);
  if (missing.length) {
    console.error(`Overlays: could not load ${missing.join(', ')}; using the flat v3 cards instead`);
    return null;
  }
  return Object.fromEntries(keys.map((key, i) => [key, images[i]]));
}
