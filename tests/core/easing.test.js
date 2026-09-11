import { describe, it, expect } from 'vitest';
import { Easing, ease, isEasing } from '../../src/core/easing.js';
import { Config, createConfig } from '../../src/config/Config.js';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';

describe('easing (pure, shared by core and render)', () => {
  it('every curve runs from exactly 0 to exactly 1 and never goes backwards', () => {
    for (const name of Object.keys(Easing)) {
      expect([ease(name, 0), ease(name, 1)]).toEqual([0, 1]);
      let last = 0;
      for (let i = 1; i <= 100; i += 1) {
        const v = ease(name, i / 100);
        expect(v).toBeGreaterThanOrEqual(last - 1e-12);
        last = v;
      }
    }
  });

  it('clamps progress and rejects unknown names', () => {
    expect(ease('easeOutCubic', -3)).toBe(0);
    expect(ease('easeOutCubic', 7)).toBe(1);
    expect(isEasing('easeOutCubic')).toBe(true);
    expect(isEasing('bounce')).toBe(false);
    expect(() => ease('bounce', 0.5)).toThrow(/Unknown easing/);
  });

  it('ease-out curves lead linear, ease-in-out curves are symmetric', () => {
    expect(ease('easeOutQuad', 0.5)).toBeGreaterThan(0.5);
    expect(ease('easeOutCubic', 0.5)).toBeGreaterThan(ease('easeOutQuad', 0.5));
    expect(ease('easeInOutCubic', 0.5)).toBe(0.5);
    expect(ease('easeInOutCubic', 0.2) + ease('easeInOutCubic', 0.8)).toBeCloseTo(1, 12);
  });

  it('every easing named in Config exists, and GameManager refuses an unknown core easing', () => {
    for (const name of [Config.units.accelEasing, Config.rules.finalRushEasing, Config.render.motionEasing]) {
      expect(isEasing(name)).toBe(true);
    }
    const bad = createConfig({ rules: { finalRushEasing: 'wobble' } });
    expect(() => new GameManager({ config: bad, eventBus: new EventBus() })).toThrow(/finalRushEasing/);
  });
});
