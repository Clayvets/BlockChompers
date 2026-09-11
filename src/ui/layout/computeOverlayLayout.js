/**
 * Where the styled overlays go, in CSS px (pure; tests/ui/computeOverlayLayout.test.js). They were drawn on the
 * mockups' artboard (Config.ui.overlays.artboard, 800 x 1280 px): its width maps onto the design frame's width and its
 * centre onto the design frame's centre, so an artboard length x `scale` is a CSS length and the overlays grow and
 * shrink with the frame, like the HUD. The artboard is 1.6 frame widths tall and the frame 2, so the panel always lies
 * inside the design frame.
 * @param {{ design: { x: number, y: number, w: number, h: number } }} frame Renderer.screenFrame()
 * @param {{ artboard: { width: number, height: number }, panel: { x: number, y: number, width: number, height: number } }} overlays
 *   Config.ui.overlays
 * @returns {{ scale: number, panel: { x: number, y: number, width: number, height: number } }} scale: CSS px per
 *   artboard px; panel: the glass panel's rect in the viewport
 */
export function computeOverlayLayout({ design }, { artboard, panel }) {
  const scale = design.w / artboard.width;
  const left = design.x;
  const top = design.y + design.h / 2 - (artboard.height / 2) * scale;
  return {
    scale,
    panel: { x: left + panel.x * scale, y: top + panel.y * scale, width: panel.width * scale, height: panel.height * scale },
  };
}

/**
 * An artboard point in the panel's own coordinates (CSS px from its top-left corner): the panel holds everything
 * drawn on it. `x` defaults to the panel's centre line.
 */
export function panelPoint(layout, panel, y, x = panel.x + panel.width / 2) {
  return { x: (x - panel.x) * layout.scale, y: (y - panel.y) * layout.scale };
}
