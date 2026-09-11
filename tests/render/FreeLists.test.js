import { describe, it, expect } from 'vitest';
import { FreeLists } from '../../src/render/anim/FreeLists.js';

/** Items made by a counter, so each creation is recognisable. */
function maker() {
  let made = 0;
  return { create: (key) => () => ({ key, n: (made += 1) }), count: () => made };
}

describe('FreeLists (unit fade materials)', () => {
  it('reuses an item given back instead of making a new one', () => {
    const pool = new FreeLists();
    const m = maker();
    const first = pool.take('red', m.create('red'));
    pool.give('red', first);
    expect(pool.take('red', m.create('red'))).toBe(first);
    expect(m.count()).toBe(1);
    expect(pool.size).toBe(1);
  });

  it('gives concurrent takers of one key their own items (two fades of one colour keep their own opacity)', () => {
    const pool = new FreeLists();
    const m = maker();
    const a = pool.take('red', m.create('red'));
    const b = pool.take('red', m.create('red'));
    expect(a).not.toBe(b);
    pool.give('red', a);
    pool.give('red', b);
    expect(new Set([pool.take('red', m.create('red')), pool.take('red', m.create('red'))])).toEqual(new Set([a, b]));
    expect(m.count()).toBe(2);
  });

  it('keeps keys apart', () => {
    const pool = new FreeLists();
    const m = maker();
    const red = pool.take('red', m.create('red'));
    pool.give('red', red);
    const blue = pool.take('blue', m.create('blue'));
    expect(blue).not.toBe(red);
    expect(blue.key).toBe('blue');
  });

  it('never drops an item before clear(), which disposes each one once, taken or free', () => {
    const pool = new FreeLists();
    const m = maker();
    const taken = pool.take('red', m.create('red'));
    const free = pool.take('blue', m.create('blue'));
    pool.give('blue', free);
    const disposed = [];
    pool.clear((item) => disposed.push(item));
    expect(disposed).toEqual([taken, free]);
    expect(pool.size).toBe(0);
    expect(pool.take('blue', m.create('blue'))).not.toBe(free);
  });
});
