import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { Config } from '../../src/config/Config.js';
import { SfxScheduler } from '../../src/audio/SfxScheduler.js';
import { SfxBank } from '../../src/audio/SfxBank.js';

const LIMITS = { maxVoices: 8, comboWindowMs: 300, comboSemitones: 1, comboMaxSteps: 3 };
/** A pitch multiplier as whole semitones above the base (comboSemitones is 1 here). */
const semitones = (pitch) => Math.round(Math.log2(pitch) * 12);
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('SfxScheduler', () => {
  it('caps simultaneous voices: over the cap a sound is skipped, and a voice frees when it ends', () => {
    const s = new SfxScheduler({ ...LIMITS, maxVoices: 2 });
    expect(s.request('a', 0, {}, 100)).toBe(1);
    expect(s.request('b', 10, {}, 100)).toBe(1);
    expect(s.request('c', 20, {}, 100)).toBe(0);
    expect(s.reason).toBe('voices');
    expect(s.active(20)).toBe(2);
    expect(s.request('c', 100, {}, 100)).toBe(1); // 'a' ended at 100 ms
    expect(s.active(100)).toBe(2);
    expect(s.active(250)).toBe(0);
  });

  it('skips a sound retriggered within its minIntervalMs, per sound, and stretches the interval by 1 / rate', () => {
    const s = new SfxScheduler(LIMITS);
    const pop = { minIntervalMs: 50 };
    expect(s.request('pop', 0, pop, 10)).toBe(1);
    expect(s.request('pop', 30, pop, 10)).toBe(0);
    expect(s.reason).toBe('throttled');
    expect(s.request('pew', 30, pop, 10)).toBe(1); // another sound keeps its own interval
    expect(s.request('pop', 50, pop, 10)).toBe(1);
    // debug.timeScale 0.5: the interval doubles to 100 ms.
    expect(s.request('slow', 0, pop, 10, 0.5)).toBe(1);
    expect(s.request('slow', 80, pop, 10, 0.5)).toBe(0);
    expect(s.request('slow', 100, pop, 10, 0.5)).toBe(1);
  });

  it('raises a combo sound one step per consecutive start, caps it, and resets it after comboWindowMs', () => {
    const s = new SfxScheduler(LIMITS);
    const pop = { combo: true };
    const steps = [0, 100, 200, 300, 400].map((t) => semitones(s.request('pop', t, pop, 10)));
    expect(steps).toEqual([0, 1, 2, 3, 3]); // capped at comboMaxSteps
    expect(s.request('pop', 701, pop, 10)).toBe(1); // a 301 ms gap: back to the base pitch
    expect(semitones(s.request('pop', 800, pop, 10))).toBe(1);
    s.resetCombos(); // a new level starts every combo over
    expect(s.request('pop', 850, pop, 10)).toBe(1);
  });

  it('keeps a combo alive through skipped requests, which do not raise the pitch themselves', () => {
    const s = new SfxScheduler(LIMITS);
    const pop = { combo: true, minIntervalMs: 200 };
    expect(s.request('pop', 0, pop, 10)).toBe(1);
    expect(s.request('pop', 150, pop, 10)).toBe(0); // throttled, but it is a consecutive break
    expect(semitones(s.request('pop', 400, pop, 10))).toBe(1); // 250 ms after the skipped one: still a combo
  });

  it('skips every sound while muted, without using a voice or starting its interval; unmuted it plays again', () => {
    const s = new SfxScheduler(LIMITS);
    const tap = { minIntervalMs: 50 };
    s.setMuted(true);
    expect(s.request('tap', 0, tap, 100)).toBe(0);
    expect(s.reason).toBe('muted');
    expect(s.active(0)).toBe(0);
    s.setMuted(false);
    expect(s.request('tap', 10, tap, 100)).toBe(1);
    expect(s.reason).toBe(null);
  });

  it('varies the pitch by up to +/- pitchJitter from the injected random source', () => {
    let r = 0;
    const s = new SfxScheduler(LIMITS, () => r);
    const pew = { pitchJitter: 0.1 };
    expect(s.request('pew', 0, pew, 10)).toBeCloseTo(0.9, 12);
    r = 0.5;
    expect(s.request('pew', 100, pew, 10)).toBeCloseTo(1, 12);
    r = 1;
    expect(s.request('pew', 200, pew, 10)).toBeCloseTo(1.1, 12);
  });

  it('is pure: no Web Audio, DOM or clock', () => {
    const source = stripComments(fs.readFileSync(new URL('../../src/audio/SfxScheduler.js', import.meta.url), 'utf8'));
    expect(source).not.toMatch(/AudioContext|\bdocument\b|\bwindow\b|performance\.now|Date\.now|from\s+['"]three['"]/);
  });
});

describe('SfxBank', () => {
  it('can play every configured sound, and each lasts as long as its config says', () => {
    const bank = new SfxBank(Config);
    const { sounds } = Config.render.audio;
    for (const name of Object.keys(sounds)) {
      expect(bank.has(name), name).toBe(true);
      expect(bank.durationMs(name), name).toBeGreaterThan(0);
    }
    const { notes } = sounds.fanfare;
    expect(bank.durationMs('fanfare')).toBe((notes.hz.length - 1) * notes.stepMs + notes.lastNoteMs);
    expect(bank.durationMs('pop')).toBe(Math.max(sounds.pop.tone.ms, sounds.pop.click.ms));
  });
});
