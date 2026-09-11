import { describe, it, expect } from 'vitest';
import { RenderGate } from '../../src/render/RenderGate.js';

const snap = (over = {}) => ({ levelId: 'watermelon', phase: 'playing', paused: false, grid: { version: 1 }, inventory: { version: 1 }, ...over });
const frames = (gate, n, still, snapshot) => Array.from({ length: n }, () => gate.shouldDraw(still, snapshot));

describe('RenderGate (render on demand)', () => {
  it('draws every frame while the scene moves', () => {
    const gate = new RenderGate();
    expect(frames(gate, 5, false, snap())).toEqual([true, true, true, true, true]);
  });

  it('draws the frame after pausing (the frozen picture), then nothing until something changes', () => {
    const gate = new RenderGate();
    frames(gate, 3, false, snap());
    const paused = snap({ paused: true });
    expect(frames(gate, 4, true, paused)).toEqual([true, false, false, false]);
    expect(gate.shouldDraw(false, snap())).toBe(true); // resumed
  });

  it('draws once when what a still scene shows changes: grid, inventory, level or phase', () => {
    for (const change of [{ grid: { version: 2 } }, { inventory: { version: 2 } }, { levelId: 'carrot' }, { phase: 'won' }]) {
      const gate = new RenderGate();
      frames(gate, 2, true, snap({ paused: true }));
      expect(frames(gate, 3, true, snap({ paused: true, ...change }))).toEqual([true, false, false]);
    }
  });

  it('draws once after invalidate() (a resize), even when nothing in the snapshot changed', () => {
    const gate = new RenderGate();
    const still = snap({ paused: true });
    frames(gate, 3, true, still);
    gate.invalidate();
    expect(frames(gate, 3, true, still)).toEqual([true, false, false]);
  });

  it('draws the very first frame, so the level is built and its shaders compiled at boot behind the start screen', () => {
    expect(new RenderGate().shouldDraw(true, snap())).toBe(true);
  });
});
