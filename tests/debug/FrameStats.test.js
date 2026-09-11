import { describe, it, expect } from 'vitest';
import { FrameStats } from '../../src/debug/FrameStats.js';
import { hasDebugParam } from '../../src/debug/debugParam.js';

describe('FrameStats (pure, node)', () => {
  it('averages the frame interval into fps and splits the work by part', () => {
    const stats = new FrameStats(10);
    for (let i = 0; i < 10; i += 1) stats.record(20, 1, 3, 0.5);
    const s = stats.summary();
    expect(s.samples).toBe(10);
    expect(s.fps).toBeCloseTo(50, 9);
    expect(s.frameAvg).toBeCloseTo(20, 9);
    expect(s.simAvg).toBeCloseTo(1, 9);
    expect(s.renderAvg).toBeCloseTo(3, 9);
    expect(s.uiAvg).toBeCloseTo(0.5, 9);
    expect(s.workAvg).toBeCloseTo(4.5, 9);
  });

  it('gives the 95th percentile (nearest rank) and the maximum, so a few slow frames show', () => {
    const stats = new FrameStats(100);
    for (let i = 0; i < 95; i += 1) stats.record(16, 1, 1, 1);
    for (let i = 0; i < 5; i += 1) stats.record(40 + i, 10, 10, 10);
    const s = stats.summary();
    expect(s.frameP95).toBe(16);
    expect(s.frameMax).toBe(44);
    expect(s.workP95).toBe(3);
    stats.record(50, 10, 10, 10); // one more slow, busy frame pushes a 16 out of the window
    expect(stats.summary().frameP95).toBe(40);
    expect(stats.summary().workP95).toBe(30);
  });

  it('keeps only the last `size` frames and can be reset', () => {
    const stats = new FrameStats(4);
    for (const ms of [100, 100, 10, 10, 10, 10]) stats.record(ms, 0, 0, 0);
    expect(stats.summary().frameAvg).toBe(10);
    expect(stats.summary().samples).toBe(4);
    stats.reset();
    expect(stats.summary()).toMatchObject({ samples: 0, fps: 0, frameP95: 0 });
  });

  it('does not allocate its buffers per call (same typed arrays after many records)', () => {
    const stats = new FrameStats(8);
    const { interval, scratch } = stats;
    for (let i = 0; i < 100; i += 1) {
      stats.record(i, i, i, i);
      stats.summary();
    }
    expect(stats.interval).toBe(interval);
    expect(stats.scratch).toBe(scratch);
  });
});

describe('hasDebugParam', () => {
  it('reads ?debug (any value but 0 / false) and ignores other parameters', () => {
    expect(hasDebugParam('?debug', 'debug')).toBe(true);
    expect(hasDebugParam('?level=carrot&debug=1', 'debug')).toBe(true);
    expect(hasDebugParam('?debug=0', 'debug')).toBe(false);
    expect(hasDebugParam('?debug=false', 'debug')).toBe(false);
    expect(hasDebugParam('?level=carrot', 'debug')).toBe(false);
    expect(hasDebugParam('', 'debug')).toBe(false);
    expect(hasDebugParam('?debug', '')).toBe(false);
  });
});
