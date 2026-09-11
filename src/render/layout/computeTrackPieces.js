/**
 * Visual track pieces for a level's ring (pure: no three, no DOM, no clock). Board cell units: x right, y down, origin
 * at the grid's top-left, a ring cell's centre at (c + 0.5, r + 0.5) exactly like core Track's cells, so the Renderer
 * places a piece with the same boardPoint() it uses for everything else.
 *
 *   computeTrackPieces({ rows, cols, margin, direction, entryCorner }) -> pieces[], one per ring cell:
 *     { type: 'corner' | 'straight', x, y, side, rotation, heading, entry }
 *       side      'N' | 'E' | 'S' | 'W' for a straight, 'NW' | 'NE' | 'SE' | 'SW' for a corner
 *       rotation  quarter turns about the up axis (three.js rotation.y = rotation * PI / 2) that turn the piece's outer
 *                 rim outward: an exported straight piece has its rim on local +Z (the south side) and the corner on +X
 *                 and +Z (south-east); see tools/blender/export_glb.py
 *       heading   travel direction through the cell, in the Renderer's convention atan2(-dy, dx); a corner gets the
 *                 diagonal between the incoming and the outgoing direction
 *       entry     true for the shared entry corner
 *   A W x H ring (W = cols + 2 margin) has 4 corners and 2 (W - 2) + 2 (H - 2) straights.
 *
 *   trackLoop({ rows, cols, margin, direction, cornerRadius }) -> { length, sample(s, out) }
 *     The canal's centre line: a closed path through the ring cell centres with every corner rounded to cornerRadius
 *     (cells), in travel order. sample(s, out) writes { x, y, heading } at arc length s (any s; it wraps). The flow
 *     chevrons ride it.
 */

const SIDE_ROTATION = { S: 0, E: 1, N: 2, W: 3 };
const CORNER_ROTATION = { SE: 0, NE: 1, NW: 2, SW: 3 };
/** Clockwise travel on screen (north up): along the top edge east, down the right edge south, and so on. */
const CW_TRAVEL = { N: [1, 0], E: [0, 1], S: [-1, 0], W: [0, -1] };
/** For each corner, the side that leads into it and the side that leaves it, clockwise. */
const CW_CORNER_SIDES = { NW: ['W', 'N'], NE: ['N', 'E'], SE: ['E', 'S'], SW: ['S', 'W'] };

const headingOf = (dx, dy) => Math.atan2(-dy, dx);

function travel(side, direction) {
  const [dx, dy] = CW_TRAVEL[side];
  return direction === 'ccw' ? [-dx, -dy] : [dx, dy];
}

/** The ring's cell-centre bounds: x0..x1, y0..y1. */
export function ringBounds({ rows, cols, margin }) {
  return { x0: -margin + 0.5, x1: cols + margin - 0.5, y0: -margin + 0.5, y1: rows + margin - 0.5 };
}

export function computeTrackPieces({ rows, cols, margin, direction = 'cw', entryCorner = 'SW' }) {
  const { x0, x1, y0, y1 } = ringBounds({ rows, cols, margin });
  const pieces = [];
  const straight = (side, x, y) => {
    const [dx, dy] = travel(side, direction);
    pieces.push({ type: 'straight', x, y, side, rotation: SIDE_ROTATION[side], heading: headingOf(dx, dy), entry: false });
  };
  const corner = (name, x, y) => {
    const [into, out] = CW_CORNER_SIDES[name];
    const a = travel(into, direction);
    const b = travel(out, direction);
    // Counter-clockwise, the corner is entered from the clockwise "out" side and left along the "in" side; the
    // diagonal is the same sum either way.
    pieces.push({ type: 'corner', x, y, side: name, rotation: CORNER_ROTATION[name], heading: headingOf(a[0] + b[0], a[1] + b[1]), entry: name === entryCorner });
  };
  corner('NW', x0, y0);
  for (let x = x0 + 1; x < x1; x += 1) straight('N', x, y0);
  corner('NE', x1, y0);
  for (let y = y0 + 1; y < y1; y += 1) straight('E', x1, y);
  corner('SE', x1, y1);
  for (let x = x1 - 1; x > x0; x -= 1) straight('S', x, y1);
  corner('SW', x0, y1);
  for (let y = y1 - 1; y > y0; y -= 1) straight('W', x0, y);
  return pieces;
}

export function trackLoop({ rows, cols, margin, direction = 'cw', cornerRadius = 0 }) {
  const { x0, x1, y0, y1 } = ringBounds({ rows, cols, margin });
  const r = Math.max(0, Math.min(cornerRadius, (x1 - x0) / 2, (y1 - y0) / 2));
  // Clockwise segments on screen (y down): lines, and quarter arcs whose angle grows from +x toward +y.
  const segments = [
    { line: [x0 + r, y0, x1 - r, y0] },
    { arc: [x1 - r, y0 + r, -Math.PI / 2] },
    { line: [x1, y0 + r, x1, y1 - r] },
    { arc: [x1 - r, y1 - r, 0] },
    { line: [x1 - r, y1, x0 + r, y1] },
    { arc: [x0 + r, y1 - r, Math.PI / 2] },
    { line: [x0, y1 - r, x0, y0 + r] },
    { arc: [x0 + r, y0 + r, Math.PI] },
  ];
  let length = 0;
  for (const seg of segments) {
    seg.start = length;
    seg.length = seg.line ? Math.hypot(seg.line[2] - seg.line[0], seg.line[3] - seg.line[1]) : (Math.PI / 2) * r;
    length += seg.length;
  }
  const ccw = direction === 'ccw';

  function sample(s, out = { x: 0, y: 0, heading: 0 }) {
    let d = ((s % length) + length) % length;
    if (ccw) d = length - d;
    let seg = segments[segments.length - 1];
    for (let i = 0; i < segments.length; i += 1) {
      if (d < segments[i].start + segments[i].length) {
        seg = segments[i];
        break;
      }
    }
    const t = seg.length > 0 ? (d - seg.start) / seg.length : 0;
    let dx;
    let dy;
    if (seg.line) {
      const [ax, ay, bx, by] = seg.line;
      out.x = ax + (bx - ax) * t;
      out.y = ay + (by - ay) * t;
      dx = bx - ax;
      dy = by - ay;
    } else {
      const [cx, cy, a0] = seg.arc;
      const a = a0 + (Math.PI / 2) * t;
      out.x = cx + r * Math.cos(a);
      out.y = cy + r * Math.sin(a);
      dx = -Math.sin(a);
      dy = Math.cos(a);
    }
    if (ccw) {
      dx = -dx;
      dy = -dy;
    }
    out.heading = headingOf(dx, dy);
    return out;
  }

  return { length, sample };
}
