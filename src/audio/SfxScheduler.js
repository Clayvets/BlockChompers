/**
 * Decides, before any audio node exists, whether a sound may start and at what pitch. Pure: no Web Audio, no DOM and
 * no clock (times come in as ms), and randomness only through the injected random(). Checks, in order:
 *   mute      -- while muted every sound is skipped, so no nodes are created at all;
 *   combo     -- for combo sounds, a request within comboWindowMs of the previous request of the same sound (played or
 *                skipped) keeps the combo going, and each one that plays is comboSemitones higher, up to comboMaxSteps;
 *                a longer gap resets it;
 *   throttle  -- a sound requested sooner than its minIntervalMs after its last start is skipped, never queued;
 *   voice cap -- while maxVoices sounds are still playing, a new one is skipped, never queued;
 *   jitter    -- the pitch varies by up to +/- pitchJitter.
 * `rate` is the playback rate (debug.timeScale for game sounds): intervals, the combo window and durations stretch by
 * 1 / rate. Allocation-free per request once a sound has been seen.
 */
export class SfxScheduler {
  /** End times (ms) of the voices started and not yet known to be over. */
  #ends;
  #count = 0;
  /** name -> { last, comboAt, steps } */
  #sounds = new Map();

  /**
   * @param {{ maxVoices: number, comboWindowMs: number, comboSemitones: number, comboMaxSteps: number }} limits
   * @param {() => number} [random] uniform in [0, 1)
   */
  constructor({ maxVoices, comboWindowMs, comboSemitones, comboMaxSteps }, random = Math.random) {
    this.maxVoices = maxVoices;
    this.comboWindowMs = comboWindowMs;
    this.comboSemitones = comboSemitones;
    this.comboMaxSteps = comboMaxSteps;
    this.random = random;
    this.muted = false;
    /** Why the last request was skipped: 'muted' | 'throttled' | 'voices', or null if it played. */
    this.reason = null;
    this.#ends = new Float64Array(maxVoices);
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
  }

  /**
   * @param {string} name
   * @param {number} nowMs
   * @param {{ minIntervalMs?: number, combo?: boolean, pitchJitter?: number }} def
   * @param {number} durationMs the sound's length at rate 1
   * @param {number} [rate]
   * @returns {number} the pitch multiplier to play at (> 0), or 0 to skip
   */
  request(name, nowMs, def, durationMs, rate = 1) {
    this.reason = null;
    if (this.muted) {
      this.reason = 'muted';
      return 0;
    }
    const sound = this.#state(name);
    let steps = 0;
    if (def.combo) {
      if (nowMs - sound.comboAt > this.comboWindowMs / rate) sound.steps = 0;
      sound.comboAt = nowMs;
      steps = sound.steps;
    }
    if (nowMs - sound.last < (def.minIntervalMs || 0) / rate) {
      this.reason = 'throttled';
      return 0;
    }
    if (this.active(nowMs) >= this.maxVoices) {
      this.reason = 'voices';
      return 0;
    }
    sound.last = nowMs;
    this.#ends[this.#count] = nowMs + durationMs / rate;
    this.#count += 1;
    if (def.combo) sound.steps = Math.min(steps + 1, this.comboMaxSteps);
    let pitch = 2 ** ((steps * this.comboSemitones) / 12);
    if (def.pitchJitter) pitch *= 1 + (this.random() * 2 - 1) * def.pitchJitter;
    return pitch;
  }

  /** Voices still playing at nowMs (the ones that ended are dropped). */
  active(nowMs) {
    let n = 0;
    for (let i = 0; i < this.#count; i += 1) {
      if (this.#ends[i] > nowMs) {
        this.#ends[n] = this.#ends[i];
        n += 1;
      }
    }
    this.#count = n;
    return n;
  }

  /** Every combo starts again from its base pitch (level start). */
  resetCombos() {
    this.#sounds.forEach(resetCombo);
  }

  clear() {
    this.#count = 0;
    this.#sounds.clear();
  }

  #state(name) {
    let sound = this.#sounds.get(name);
    if (!sound) {
      sound = { last: -Infinity, comboAt: -Infinity, steps: 0 };
      this.#sounds.set(name, sound);
    }
    return sound;
  }
}

function resetCombo(sound) {
  sound.comboAt = -Infinity;
  sound.steps = 0;
}
