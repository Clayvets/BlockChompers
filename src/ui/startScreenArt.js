/**
 * Loads what the styled start screen needs before the UI mounts: its two images, decoded (AssetLoader.loadImage), and
 * the label font (a FontFace from Config.ui.startScreen.font, then document.fonts.load, so the label never shows in a
 * fallback font). Resolves to the art, or to null when anything failed: the console names each missing file and the
 * UIManager keeps the flat v3 start screen.
 *
 * @param {object} config  Config.ui.startScreen
 * @param {{ loadImage: (url: string) => Promise<HTMLImageElement | null> }} assets  the AssetLoader
 * @param {{ font?: Promise<boolean>, fonts?: FontFaceSet, FontFace?: typeof FontFace }} [env]  font: an already started
 *   loadUiFont() of the same font (main.js shares it with the HUD); fonts / FontFace: injectable for tests
 * @returns {Promise<{ background: HTMLImageElement, button: HTMLImageElement, font: string } | null>}
 */
export async function loadStartScreenArt(config, assets, env = {}) {
  const [background, button, font] = await Promise.all([
    assets.loadImage(config.background),
    assets.loadImage(config.button),
    env.font || loadUiFont(config.font, env),
  ]);
  const missing = [[background, config.background], [button, config.button], [font, config.font.url]]
    .filter(([loaded]) => !loaded)
    .map(([, file]) => `"${file}"`);
  if (missing.length) {
    console.error(`Start screen: could not load ${missing.join(', ')}; using the flat v3 start screen instead`);
    return null;
  }
  return { background, button, font: config.font.family };
}

/**
 * The UI's display font (Config.ui.startScreen.font: Titan One, self-hosted): a FontFace added to document.fonts and
 * awaited with document.fonts.load, so nothing draws it in a fallback font. A failure is logged with the file.
 * @param {{ family: string, url: string }} font
 * @param {{ fonts?: FontFaceSet, FontFace?: typeof FontFace }} [env]  injectable for tests
 * @returns {Promise<boolean>} true once the face is loaded and usable
 */
export async function loadUiFont({ family, url }, { fonts = globalThis.document && globalThis.document.fonts, FontFace = globalThis.FontFace } = {}) {
  if (!fonts || !FontFace) return false;
  try {
    fonts.add(new FontFace(family, `url("${url}") format("woff2")`));
    const faces = await fonts.load(`1em "${family}"`);
    if (faces.length) return true;
    console.error(`Start screen: font "${url}" loaded no face for "${family}"`);
  } catch (error) {
    console.error(`Start screen: could not load font "${url}" (${error && error.message ? error.message : error})`);
  }
  return false;
}
