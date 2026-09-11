/**
 * Fixed portrait layout (pure: no three, no DOM, no clock). Everything is in DESIGN units, which are also the
 * renderer's world units on the x/z plane (x right, y down on screen). The design rect is identical on every level:
 * slots, reserve cells, unit and label sizes and the "N/5" counter never move. Only the board -- the grid plus its
 * track ring -- scales, to fit render.layout.boardRegion, and is centred in it.
 *
 *   computeLayout(levelDims, layoutConfig, viewportAspect) -> {
 *     design, view,                                   // view: the world rect the camera shows for this aspect
 *     boardRegion, slotsRegion, reserveRegion,        // copies of the configured rects
 *     cellSize, board, boardOrigin,                   // the level's scaled board
 *     slots, reserve, unit, label, counter,           // constant-size elements
 *     reserveOverflow,                                // true when the level needs more reserve rows than fit
 *   }
 *
 * Rects are { x, y, w, h } with (x, y) the top-left corner.
 */

const EPS = 1e-9;
const rect = ({ x, y, w, h }) => ({ x, y, w, h });

/** Centre of a rect. */
export function rectCenter({ x, y, w, h }) {
  return { x: x + w / 2, y: y + h / 2 };
}

/**
 * The world rect the camera must show so the design fits a viewport of `aspect` (width / height) uniformly: the design
 * is kept whole and centred, and the extra space on the longer axis becomes margin.
 */
export function fitView(designWidth, designHeight, aspect) {
  const designAspect = designWidth / designHeight;
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : designAspect;
  if (a >= designAspect) {
    const w = designHeight * a;
    return { x: (designWidth - w) / 2, y: 0, w, h: designHeight };
  }
  const h = designWidth / a;
  return { x: 0, y: (designHeight - h) / 2, w: designWidth, h };
}

/**
 * @param {{ rows: number, cols: number, margin: number, reserveRows?: number }} levelDims grid size, track margin (cells)
 *   and, optionally, the reserve rows the level needs
 * @param {{ designWidth: number, designHeight: number, boardRegion: object, slotsRegion: object, reserveRegion: object,
 *           slotSize: number, reserveCellSize: number, unitSize: number, labelSize: number,
 *           counter: { x: number, y: number, height: number }, maxCellSize: number,
 *           slotCount: number, reserveCols: number }} layoutConfig render.layout plus the slot and reserve column counts
 * @param {number} viewportAspect usable viewport width / height (below the HUD)
 */
export function computeLayout(levelDims, layoutConfig, viewportAspect) {
  const { rows, cols, margin, reserveRows = 0 } = levelDims;
  const {
    designWidth, designHeight, boardRegion, slotsRegion, reserveRegion,
    slotSize, reserveCellSize, unitSize, labelSize, counter, maxCellSize, slotCount, reserveCols,
  } = layoutConfig;

  // Board: the grid plus the track ring on every side ("boardCols/boardRows include the track and its offset").
  const boardCols = cols + 2 * margin;
  const boardRows = rows + 2 * margin;
  const cellSize = Math.min(boardRegion.w / boardCols, boardRegion.h / boardRows, maxCellSize);
  const bw = boardCols * cellSize;
  const bh = boardRows * cellSize;
  const board = {
    x: boardRegion.x + (boardRegion.w - bw) / 2,
    y: boardRegion.y + (boardRegion.h - bh) / 2,
    w: bw,
    h: bh,
    cols: boardCols,
    rows: boardRows,
  };
  // Logic cell (0, 0) is the grid's top-left corner, `margin` cells inside the board's top-left corner.
  const boardOrigin = { x: board.x + margin * cellSize, y: board.y + margin * cellSize };

  // Slots: one row of square cells, centred in slotsRegion.
  const slotX0 = slotsRegion.x + (slotsRegion.w - slotCount * slotSize) / 2;
  const slotY = slotsRegion.y + (slotsRegion.h - slotSize) / 2;
  const slots = Array.from({ length: slotCount }, (_, i) => ({ x: slotX0 + i * slotSize, y: slotY, w: slotSize, h: slotSize }));

  // Reserve: reserveCols columns, as many rows as fit, centred horizontally, front row (0) at the top.
  const capacity = Math.floor(reserveRegion.h / reserveCellSize + EPS);
  const resX0 = reserveRegion.x + (reserveRegion.w - reserveCols * reserveCellSize) / 2;
  const cells = [];
  for (let row = 0; row < capacity; row += 1) {
    for (let col = 0; col < reserveCols; col += 1) {
      cells.push({ col, row, x: resX0 + col * reserveCellSize, y: reserveRegion.y + row * reserveCellSize, w: reserveCellSize, h: reserveCellSize });
    }
  }
  const reserve = {
    cols: reserveCols,
    rows: capacity,
    pitch: reserveCellSize,
    origin: { x: resX0 + reserveCellSize / 2, y: reserveRegion.y + reserveCellSize / 2 },
    cells,
  };

  return {
    design: { x: 0, y: 0, w: designWidth, h: designHeight },
    view: fitView(designWidth, designHeight, viewportAspect),
    boardRegion: rect(boardRegion),
    slotsRegion: rect(slotsRegion),
    reserveRegion: rect(reserveRegion),
    cellSize,
    board,
    boardOrigin,
    slots,
    reserve,
    unit: { size: unitSize },
    label: { size: labelSize },
    counter: { x: counter.x, y: counter.y, height: counter.height },
    reserveOverflow: reserveRows > capacity,
  };
}

/** World point of a position in logic cell units (x right, y down, origin = grid top-left). */
export function boardPoint(layout, x, y) {
  return { x: layout.boardOrigin.x + x * layout.cellSize, y: layout.boardOrigin.y + y * layout.cellSize };
}

/** World centre of slot `index`. */
export function slotPoint(layout, index) {
  return rectCenter(layout.slots[index]);
}

/** World centre of reserve cell (col, row); `row` may be fractional (shift animation) or beyond the capacity. */
export function reservePoint(layout, col, row) {
  const { origin, pitch } = layout.reserve;
  return { x: origin.x + col * pitch, y: origin.y + row * pitch };
}
