import { describe, it, expect } from 'vitest';
import { Config } from '../../src/config/Config.js';
import { computeStartScreenLayout } from '../../src/ui/layout/computeStartScreenLayout.js';

const config = Config.ui.startScreen;
// Natural sizes of public/assets/ui/start_bg.webp and button_green.png as npm run process:ui exports them.
const SIZES = { background: { width: 1080, height: 1935 }, button: { width: 800, height: 257 } };
const VIEWPORTS = {
  'phone 390x844': { width: 390, height: 844 },
  'tablet 768x1024': { width: 768, height: 1024 },
  'square 1000x1000': { width: 1000, height: 1000 },
  'desktop 1920x1080': { width: 1920, height: 1080 },
  'narrow 320x1200': { width: 320, height: 1200 },
  'ultrawide 3440x1440': { width: 3440, height: 1440 },
};
const EPS = 1e-6;

const inside = (inner, outer) =>
  inner.x >= outer.x - EPS && inner.y >= outer.y - EPS
  && inner.x + inner.width <= outer.x + outer.width + EPS && inner.y + inner.height <= outer.y + outer.height + EPS;

/** The button rect relative to the image rect: centre and size as fractions of it. */
const relative = ({ image, button }) => ({
  cx: (button.x + button.width / 2 - image.x) / image.width,
  cy: (button.y + button.height / 2 - image.y) / image.height,
  w: button.width / image.width,
  h: button.height / image.height,
});

describe('computeStartScreenLayout', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    describe(name, () => {
      const layout = computeStartScreenLayout(viewport, SIZES, config);
      const { image } = layout;

      it('contains the art: inside the viewport, same aspect, centred, filling one axis (object-fit: contain)', () => {
        expect(inside(image, { x: 0, y: 0, ...viewport })).toBe(true);
        expect(image.width / image.height).toBeCloseTo(SIZES.background.width / SIZES.background.height, 9);
        expect(image.x * 2 + image.width).toBeCloseTo(viewport.width, 9);
        expect(image.y * 2 + image.height).toBeCloseTo(viewport.height, 9);
        const fillsWidth = Math.abs(image.width - viewport.width) < EPS;
        const fillsHeight = Math.abs(image.height - viewport.height) < EPS;
        expect(fillsWidth || fillsHeight).toBe(true);
      });

      it('anchors the button to the art at config.playButton, inside the art', () => {
        const rel = relative(layout);
        expect(rel.cx).toBeCloseTo(config.playButton.centerX, 9);
        expect(rel.cy).toBeCloseTo(config.playButton.centerY, 9);
        expect(rel.w).toBeCloseTo(config.playButton.widthPct, 9);
        expect(layout.button.width / layout.button.height).toBeCloseTo(SIZES.button.width / SIZES.button.height, 9);
        expect(inside(layout.button, image)).toBe(true);
      });

      it('sizes the label from the button height', () => {
        expect(layout.labelSize).toBeCloseTo(layout.button.height * config.playButton.labelSize, 9);
      });
    });
  }

  it('keeps the button at the same relative spot in portrait, square and landscape viewports', () => {
    const [first, ...rest] = Object.values(VIEWPORTS).map((viewport) => relative(computeStartScreenLayout(viewport, SIZES, config)));
    for (const rel of rest) {
      expect(rel.cx).toBeCloseTo(first.cx, 9);
      expect(rel.cy).toBeCloseTo(first.cy, 9);
      expect(rel.w).toBeCloseTo(first.w, 9);
      expect(rel.h).toBeCloseTo(first.h, 9);
    }
  });

  it('never lets the button leave the art, even when the config points at an edge or asks for more than the width', () => {
    const cases = [
      { centerX: 0, centerY: 0, widthPct: 0.46 },
      { centerX: 1, centerY: 1, widthPct: 0.46 },
      { centerX: 0.98, centerY: 0.99, widthPct: 0.9 },
      { centerX: 0.5, centerY: 0.5, widthPct: 2 },
    ];
    for (const viewport of Object.values(VIEWPORTS)) {
      for (const playButton of cases) {
        const layout = computeStartScreenLayout(viewport, SIZES, { playButton: { ...config.playButton, ...playButton } });
        expect(inside(layout.button, layout.image)).toBe(true);
      }
    }
  });

  it('follows the images it is given: a different button aspect changes only the button height', () => {
    const viewport = VIEWPORTS['phone 390x844'];
    const wide = computeStartScreenLayout(viewport, { ...SIZES, button: { width: 800, height: 200 } }, config);
    const base = computeStartScreenLayout(viewport, SIZES, config);
    expect(wide.image).toEqual(base.image);
    expect(wide.button.width).toBeCloseTo(base.button.width, 9);
    expect(wide.button.height).toBeCloseTo(base.button.width / 4, 9);
    expect(relative(wide).cy).toBeCloseTo(config.playButton.centerY, 9);
  });
});
