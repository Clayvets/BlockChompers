import { describe, it, expect, vi, afterEach } from 'vitest';
import { Config } from '../../src/config/Config.js';
import { loadStartScreenArt } from '../../src/ui/startScreenArt.js';

const config = Config.ui.startScreen;

/** Stand-ins for the AssetLoader, document.fonts and FontFace (the tests run in node, with no DOM). */
function fakes({ failImages = [], font = 'ok' } = {}) {
  const assets = { loadImage: async (url) => (failImages.includes(url) ? null : { src: url, naturalWidth: 1, naturalHeight: 1 }) };
  const added = [];
  const fonts = {
    add: (face) => added.push(face),
    load: async () => {
      if (font === 'reject') throw new Error('A network error occurred.');
      return font === 'empty' ? [] : added;
    },
  };
  class FontFace {
    constructor(family, source) {
      this.family = family;
      this.source = source;
    }
  }
  return { assets, env: { fonts, FontFace }, added };
}

describe('loadStartScreenArt', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns both images and the font family when everything loads, and registers the configured woff2', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { assets, env, added } = fakes();
    const art = await loadStartScreenArt(config, assets, env);
    expect(art.background.src).toBe(config.background);
    expect(art.button.src).toBe(config.button);
    expect(art.font).toBe(config.font.family);
    expect(added).toHaveLength(1);
    expect(added[0].family).toBe(config.font.family);
    expect(added[0].source).toContain(config.font.url);
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ['the background image', { failImages: [config.background] }, config.background],
    ['the button image', { failImages: [config.button] }, config.button],
    ['the font (network error)', { font: 'reject' }, config.font.url],
    ['the font (no face loaded)', { font: 'empty' }, config.font.url],
  ])('falls back (null) and names the file when %s fails', async (_, options, file) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { assets, env } = fakes(options);
    expect(await loadStartScreenArt(config, assets, env)).toBeNull();
    expect(error.mock.calls.flat().join('\n')).toContain(file);
    expect(error.mock.calls.flat().join('\n')).toContain('flat v3 start screen');
  });

  it('falls back when the browser has no font loading API', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { assets } = fakes();
    expect(await loadStartScreenArt(config, assets, { fonts: undefined, FontFace: undefined })).toBeNull();
    expect(error.mock.calls.flat().join('\n')).toContain(config.font.url);
  });
});
