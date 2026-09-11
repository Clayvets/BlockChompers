import { describe, it, expect } from 'vitest';
import { computeOverlayLayout, panelPoint } from '../../src/ui/layout/computeOverlayLayout.js';
import { Config } from '../../src/config/Config.js';

const overlays = Config.ui.overlays;
/** Renderer.screenFrame()'s design rect for a viewport (design 10 x 20 units under a 1.4-unit HUD band). */
function frameFor(width, height) {
  const scale = Math.min(width / 10, height / 21.4);
  const band = 1.4 * scale;
  const w = 10 * scale;
  const h = 20 * scale;
  return { design: { x: (width - w) / 2, y: band + (height - band - h) / 2, w, h } };
}

describe('computeOverlayLayout', () => {
  it('maps the artboard width onto the design frame width', () => {
    const frame = frameFor(390, 844);
    const layout = computeOverlayLayout(frame, overlays);
    expect(layout.scale).toBeCloseTo(frame.design.w / 800, 9);
    expect(layout.panel.width).toBeCloseTo(528 * layout.scale, 9);
    expect(layout.panel.height).toBeCloseTo(656 * layout.scale, 9);
  });

  it('centres the artboard on the design frame, so the mockups centred panel is centred too', () => {
    for (const [w, h] of [[390, 844], [768, 1024], [1920, 1080]]) {
      const { design } = frameFor(w, h);
      const { panel, scale } = computeOverlayLayout({ design }, overlays);
      expect(panel.x + panel.width / 2).toBeCloseTo(design.x + design.w / 2, 6);
      // The mockup panel's centre is 3 artboard px below the artboard's centre (643 vs 640).
      expect(panel.y + panel.height / 2).toBeCloseTo(design.y + design.h / 2 + 3 * scale, 6);
    }
  });

  it('keeps the panel inside the design frame on phone, tablet and desktop viewports', () => {
    for (const [w, h] of [[390, 844], [768, 1024], [1920, 1080], [844, 390]]) {
      const { design } = frameFor(w, h);
      const { panel } = computeOverlayLayout({ design }, overlays);
      expect(panel.x).toBeGreaterThanOrEqual(design.x);
      expect(panel.y).toBeGreaterThanOrEqual(design.y);
      expect(panel.x + panel.width).toBeLessThanOrEqual(design.x + design.w + 1e-9);
      expect(panel.y + panel.height).toBeLessThanOrEqual(design.y + design.h + 1e-9);
    }
  });

  it('gives artboard points in panel coordinates, on the panel centre line by default', () => {
    const layout = computeOverlayLayout(frameFor(390, 844), overlays);
    const { panel } = overlays;
    expect(panelPoint(layout, panel, panel.y, panel.x)).toEqual({ x: 0, y: 0 });
    const title = panelPoint(layout, panel, overlays.titleY);
    expect(title.x).toBeCloseTo(layout.panel.width / 2, 9);
    expect(title.y).toBeCloseTo((overlays.titleY - panel.y) * layout.scale, 9);
  });

  it('fits the three settings buttons inside the panel with the same gap between them', () => {
    const { buttonsY } = overlays.pause;
    const height = overlays.button.width / (800 / 257); // button_green.png is 800 x 257
    const gaps = buttonsY.slice(1).map((y, i) => y - buttonsY[i] - height);
    expect(new Set(gaps.map((g) => g.toFixed(6))).size).toBe(1);
    expect(gaps[0]).toBeGreaterThan(0);
    const inner = overlays.panel.y + overlays.panel.height - 2 * overlays.panel.rimWidth;
    expect(buttonsY[2] + height / 2).toBeLessThan(inner);
  });
});
