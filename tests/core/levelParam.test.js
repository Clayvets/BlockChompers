import { describe, it, expect } from 'vitest';
import { pickDebugLevel } from '../../src/debug/levelParam.js';
import { levelLibrary, starter, watermelon } from '../../src/core/levels/index.js';
import { Config } from '../../src/config/Config.js';

describe('debug level select (?level=<id>)', () => {
  const param = Config.debug.levelParam;

  it('loads any level from the library, including ones outside the progression', () => {
    expect(param).toBe('level');
    expect(pickDebugLevel('?level=starter', levelLibrary, param)).toEqual({ id: 'starter', level: starter });
    expect(pickDebugLevel('?foo=1&level=watermelon', levelLibrary, param).level).toBe(watermelon);
  });

  it('returns no level without the parameter, for an unknown id, or when disabled', () => {
    expect(pickDebugLevel('', levelLibrary, param)).toEqual({ id: null, level: null });
    expect(pickDebugLevel('?level=nope', levelLibrary, param)).toEqual({ id: 'nope', level: null });
    expect(pickDebugLevel('?level=toString', levelLibrary, param).level).toBeNull(); // not an own key
    expect(pickDebugLevel('?level=starter', levelLibrary, '')).toEqual({ id: null, level: null });
  });
});
