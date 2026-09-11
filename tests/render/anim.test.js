import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { Easing, ease, isEasing } from '../../src/render/anim/easing.js';
import { Easing as CoreEasing } from '../../src/core/easing.js';
import { Pool } from '../../src/render/anim/Pool.js';
import { TweenScheduler } from '../../src/render/anim/TweenScheduler.js';

describe('presentation easing', () => {
  it('keeps every core curve and adds overshoot curves', () => {
    for (const name of Object.keys(CoreEasing)) expect(Easing[name]).toBe(CoreEasing[name]);
    expect(isEasing('easeOutBack')).toBe(true);
    expect(isEasing('bounce')).toBe(false);
  });

  it('lands exactly on 0 and 1 at the ends and clamps outside them', () => {
    for (const name of Object.keys(Easing)) {
      if (name === 'punch') continue;
      expect([ease(name, 0), ease(name, 1), ease(name, -2), ease(name, 5)]).toEqual([0, 1, 0, 1]);
    }
    expect(() => ease('bounce', 0.5)).toThrow(/Unknown easing/);
  });

  it('overshoots with easeOutBack, winds up with easeInBack, and punch is a 0 -> 1 -> 0 envelope', () => {
    const samples = (name) => Array.from({ length: 99 }, (_, i) => ease(name, (i + 1) / 100));
    expect(Math.max(...samples('easeOutBack'))).toBeGreaterThan(1.05);
    expect(Math.min(...samples('easeInBack'))).toBeLessThan(-0.05);
    expect(ease('punch', 0.25)).toBe(1);
    expect([ease('punch', 0), ease('punch', 1)]).toEqual([0, 0]);
  });
});

describe('Pool', () => {
  it('acquires free slots in order and reuses released ones', () => {
    const pool = new Pool(3);
    expect([pool.acquire(), pool.acquire()]).toEqual([0, 1]);
    pool.release(0);
    expect(pool.isActive(0)).toBe(false);
    expect(pool.count).toBe(1);
    expect(pool.acquire()).toBe(0);
    expect(pool.acquire()).toBe(2);
    expect([...pool.active.slice(0, pool.count)].sort()).toEqual([0, 1, 2]);
  });

  it('recycles the oldest active slot at capacity and reports it first', () => {
    const recycled = [];
    const pool = new Pool(3, (slot) => recycled.push(slot));
    [0, 1, 2].forEach(() => pool.acquire());
    pool.release(1);
    pool.acquire(); // free slot 1 again: no recycling yet
    expect(recycled).toEqual([]);
    expect(pool.acquire()).toBe(0); // slot 0 is the oldest
    expect(pool.acquire()).toBe(2); // then slot 2 (slot 1 was taken after it)
    expect(recycled).toEqual([0, 2]);
    expect(pool.recycled).toBe(2);
    expect(pool.count).toBe(3);
  });

  it('allows release while iterating backwards, and clear frees everything', () => {
    const pool = new Pool(5);
    for (let i = 0; i < 5; i += 1) pool.acquire();
    for (let i = pool.count - 1; i >= 0; i -= 1) if (pool.active[i] % 2 === 0) pool.release(pool.active[i]);
    expect([...pool.active.slice(0, pool.count)].sort()).toEqual([1, 3]);
    pool.clear();
    expect(pool.count).toBe(0);
    expect(pool.oldest()).toBe(-1);
  });
});

describe('TweenScheduler', () => {
  it('sets the start value at once, eases to the end and calls onComplete once', () => {
    const tweens = new TweenScheduler(8);
    const obj = { x: 99 };
    const done = [];
    tweens.start(obj, 'x', 0, 10, 100, 0, 'linear', (target, key) => done.push([target === obj, key]));
    expect(obj.x).toBe(0);
    tweens.update(50);
    expect(obj.x).toBe(5);
    tweens.update(60);
    expect(obj.x).toBe(10);
    expect(done).toEqual([[true, 'x']]);
    expect(tweens.activeCount).toBe(0);
    tweens.update(100);
    expect(done).toHaveLength(1);
  });

  it('waits for its delay and staggers several targets', () => {
    const tweens = new TweenScheduler(8);
    const items = [{ o: 1 }, { o: 1 }, { o: 1 }];
    expect(tweens.stagger(items, 'o', 0, 1, 100, 50, 'linear', 20)).toBe(3);
    expect(items.map((i) => i.o)).toEqual([0, 0, 0]);
    tweens.update(70); // item 0: 50 ms in; item 1 just started; item 2 still waiting
    expect(items.map((i) => i.o)).toEqual([0.5, 0, 0]);
    tweens.update(100);
    expect(items.map((i) => i.o)).toEqual([1, 1, 0.5]);
  });

  it('cancels by id or by target without completing', () => {
    const tweens = new TweenScheduler(8);
    const a = { v: 0 };
    const b = { v: 0, w: 0 };
    let completed = 0;
    const id = tweens.start(a, 'v', 0, 1, 100, 0, 'linear', () => { completed += 1; });
    tweens.start(b, 'v', 0, 1, 100);
    tweens.start(b, 'w', 0, 1, 100);
    tweens.update(40);
    expect(tweens.cancel(id)).toBe(true);
    expect(tweens.cancel(id)).toBe(false);
    expect(tweens.cancelTarget(b, 'w')).toBe(1);
    tweens.update(100);
    expect([a.v, b.v, b.w, completed]).toEqual([0.4, 1, 0.4, 0]);
    expect(tweens.isActive(id)).toBe(false);
  });

  it('finishes the oldest tween when full, and punch tweens end back at their start value', () => {
    const tweens = new TweenScheduler(2);
    const t = [{ v: 0 }, { v: 0 }, { v: 0 }];
    tweens.start(t[0], 'v', 0, 1, 100);
    tweens.start(t[1], 'v', 0, 1, 100);
    tweens.start(t[2], 'v', 0, 1, 100); // recycles t[0]'s tween: it jumps to its end
    expect(t[0].v).toBe(1);
    expect(tweens.activeCount).toBe(2);
    const s = { k: 1 };
    tweens.start(s, 'k', 1, 1.4, 100, 0, 'punch');
    tweens.update(25);
    expect(s.k).toBeCloseTo(1.4, 12);
    tweens.update(100);
    expect(s.k).toBe(1);
  });

  it('is pure: no three.js, DOM or clock in the helpers', () => {
    for (const file of ['easing.js', 'Pool.js', 'TweenScheduler.js']) {
      const source = fs.readFileSync(new URL(`../../src/render/anim/${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/from\s+['"]three['"]|\bdocument\b|\bwindow\b|performance\.now|Date\.now/);
    }
  });
});
