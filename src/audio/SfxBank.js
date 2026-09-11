/**
 * Sound recipes: each name builds a short Web Audio graph from its numbers in Config.render.audio.sounds[name]. The
 * graph pieces are `tone` (an oscillator sliding freq -> freqEnd), `noise` (filtered white noise sweeping
 * freq -> freqEnd) and `notes` (a sequence of tones stepMs apart), each under an attack / decay envelope. The wave
 * and filter types are chosen here; every pitch (Hz), duration (ms) and volume lives in config.
 */
const RECIPES = Object.freeze({
  /** UI button: a short soft blip sliding down. */
  tap: (v, s) => v.tone('sine', s.tone),
  /** Overlay enters / leaves: band-passed air sweeping up / down. */
  whooshIn: (v, s) => v.noise('bandpass', s.noise),
  whooshOut: (v, s) => v.noise('bandpass', s.noise),
  /** Play button: two rising chime notes. */
  confirm: (v, s) => v.notes('triangle', s.notes),
  /** A unit leaves the reserve (or its slot): a soft rising whoosh. */
  launch: (v, s) => v.noise('bandpass', s.noise),
  /** A unit fires: a quick falling "pew". */
  pew: (v, s) => v.tone('triangle', s.tone),
  /** A block breaks: a fast falling sine with a tiny high click on top. */
  pop: (v, s) => v.tone('sine', s.tone).noise('highpass', s.click),
  /** A capacity number drops: a very short high tick. */
  tick: (v, s) => v.tone('sine', s.tone),
  /** A unit dies at 0: a bigger, lower pop with a puff of air. */
  unitPop: (v, s) => v.tone('sine', s.tone).noise('lowpass', s.puff),
  /** A unit lands in its slot: a soft low thud. */
  park: (v, s) => v.tone('sine', s.tone).noise('lowpass', s.puff),
  /** The "N/5" counter reaches 0: two quiet beeps. */
  warn: (v, s) => v.notes('triangle', s.notes),
  /** Final rush: a long rising swoosh over a rising tone. */
  rush: (v, s) => v.noise('bandpass', s.noise).tone('sine', s.tone),
  /** Win: a quick major arpeggio (with the confetti). */
  fanfare: (v, s) => v.notes('triangle', s.notes),
  /** Money counting up: a bright upward chirp (combo: each one a little higher). */
  coin: (v, s) => v.tone('triangle', s.tone),
  /** Lose: three soft falling notes. */
  lose: (v, s) => v.notes('triangle', s.notes),
});

/**
 * The ONLY place that defines sounds (like VfxFactory for effects). A sound is either a RECIPE above, with its numbers
 * in Config.render.audio.sounds, or an audio file: give its config entry `file: 'pop.ogg'` (and a `volume`), and
 * load() fetches and decodes render.audio.assetsPath + file (the page's assets/ folder, public/assets/ in the repo).
 * play() then uses the buffer, and falls back to the recipe until the file has loaded or if it fails. So replacing a
 * sound touches only this file and config. A voice owns its nodes only while it plays: they disconnect themselves when
 * its last source ends, and the only shared object is the white-noise buffer (data, not a node).
 */
export class SfxBank {
  #buffers = new Map();
  #durations = new Map();
  #noise = null;
  #noiseCtx = null;

  constructor(config) {
    this.audio = config.render.audio;
    this.sounds = this.audio.sounds;
    for (const [name, sound] of Object.entries(this.sounds)) {
      if (RECIPES[name]) this.#durations.set(name, measure(RECIPES[name], sound));
    }
  }

  /** True if `name` can be played: it has a recipe or a loaded file. */
  has(name) {
    return Boolean(this.sounds[name]) && (this.#buffers.has(name) || Boolean(RECIPES[name]));
  }

  /** Length of `name` in ms at rate 1 (for the voice cap). */
  durationMs(name) {
    return this.#durations.get(name) || 0;
  }

  /**
   * Fetch and decode every sound whose config entry names a `file`. Never rejects: a sound whose file fails keeps
   * its recipe (or stays silent without one).
   * @returns {Promise<string[]>} the names that now play from a file
   */
  async load(ctx, fetchFn = globalThis.fetch) {
    const files = Object.entries(this.sounds).filter(([, sound]) => sound.file);
    const loaded = await Promise.all(files.map(async ([name, sound]) => {
      try {
        const response = await fetchFn(`${this.audio.assetsPath}${sound.file}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        this.#buffers.set(name, buffer);
        this.#durations.set(name, buffer.duration * 1000);
        return name;
      } catch (error) {
        console.warn(`SfxBank: could not load "${sound.file}" for ${name}; using its recipe`, error);
        return null;
      }
    }));
    return loaded.filter(Boolean);
  }

  /**
   * Start one voice of `name` at context time `when` (s) into `out`. `pitch` multiplies every frequency; `rate` is the
   * playback rate (durations / rate, frequencies x rate, like a tape); `gain` scales its volume.
   * @returns {number} the context time its last node stops, or 0 if nothing played
   */
  play(ctx, out, name, when, pitch = 1, rate = 1, gain = 1, onEnded = null) {
    const sound = this.sounds[name];
    const buffer = this.#buffers.get(name);
    const recipe = RECIPES[name];
    if (!sound || (!buffer && !recipe)) return 0;
    const voice = new Voice(ctx, out, when, pitch * rate, rate, gain, this.audio.envelopeFloor, this.#noiseBuffer(ctx));
    if (buffer) voice.buffer(buffer, sound.volume ?? 1);
    else recipe(voice, sound);
    return voice.start(onEnded);
  }

  /** One buffer of white noise per context, shared by every noise layer (sources start at a random offset). */
  #noiseBuffer(ctx) {
    if (this.#noiseCtx !== ctx) {
      const length = Math.max(1, Math.round((ctx.sampleRate * this.audio.noiseBufferMs) / 1000));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      this.#noise = buffer;
      this.#noiseCtx = ctx;
    }
    return this.#noise;
  }
}

/** The nodes of one playing sound. Recipes call tone / noise / notes; start() arms the clean-up. */
class Voice {
  constructor(ctx, out, when, hz, rate, gain, floor, noise) {
    this.ctx = ctx;
    this.out = out;
    this.when = when;
    this.hz = hz;
    this.rate = rate;
    this.gain = gain;
    this.floor = floor;
    this.noiseData = noise;
    this.nodes = [];
    this.end = when;
    this.last = null;
  }

  tone(wave, { freq, freqEnd = freq, attackMs = 0, ms, volume, delayMs = 0 }) {
    this.#tone(wave, freq, freqEnd, attackMs, ms, volume, delayMs);
    return this;
  }

  noise(type, { freq, freqEnd = freq, q = 1, attackMs = 0, ms, volume, delayMs = 0 }) {
    const { ctx } = this;
    const t0 = this.when + this.#sec(delayMs);
    const t1 = t0 + this.#sec(ms);
    const source = ctx.createBufferSource();
    source.buffer = this.noiseData;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    this.#glide(filter.frequency, freq, freqEnd, t0, t1);
    source.connect(filter);
    filter.connect(this.#envelope(t0, attackMs, t1, volume));
    this.nodes.push(filter);
    this.#source(source, t0, t1, Math.random() * this.noiseData.duration);
    return this;
  }

  notes(wave, { hz, stepMs, noteMs, lastNoteMs = noteMs, attackMs = 0, volume }) {
    for (let i = 0; i < hz.length; i += 1) {
      this.#tone(wave, hz[i], hz[i], attackMs, i === hz.length - 1 ? lastNoteMs : noteMs, volume, i * stepMs);
    }
    return this;
  }

  /** A decoded file, at playbackRate = pitch x rate. */
  buffer(audioBuffer, volume) {
    const { ctx } = this;
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = this.hz;
    const gain = ctx.createGain();
    gain.gain.value = volume * this.gain;
    source.connect(gain);
    gain.connect(this.out);
    this.nodes.push(gain);
    this.#source(source, this.when, this.when + audioBuffer.duration / this.hz, 0);
    return this;
  }

  /** Disconnect every node of this voice when its last source ends. @returns {number} that end time (s) */
  start(onEnded) {
    const { nodes, last } = this;
    if (!last) return 0;
    last.onended = () => {
      for (let i = 0; i < nodes.length; i += 1) nodes[i].disconnect();
      nodes.length = 0;
      if (onEnded) onEnded();
    };
    return this.end;
  }

  #tone(wave, freq, freqEnd, attackMs, ms, volume, delayMs) {
    const t0 = this.when + this.#sec(delayMs);
    const t1 = t0 + this.#sec(ms);
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    this.#glide(osc.frequency, freq, freqEnd, t0, t1);
    osc.connect(this.#envelope(t0, attackMs, t1, volume));
    this.#source(osc, t0, t1, 0);
  }

  #glide(param, from, to, t0, t1) {
    param.setValueAtTime(from * this.hz, t0);
    if (to !== from) param.exponentialRampToValueAtTime(to * this.hz, t1);
  }

  /**
   * Gain: 0 -> volume over attackMs (linear), then an exponential decay to the floor at t1, where the source stops.
   * The gain starts at 0, not the GainNode default of 1: a source can emit its first sample one frame before the
   * automation at t0 applies, and at gain 1 that sample is an audible click.
   */
  #envelope(t0, attackMs, t1, volume) {
    const env = this.ctx.createGain();
    const peak = Math.max(volume * this.gain, this.floor);
    const g = env.gain;
    g.value = 0;
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(peak, Math.min(t0 + this.#sec(attackMs), t1));
    g.exponentialRampToValueAtTime(this.floor, t1);
    env.connect(this.out);
    this.nodes.push(env);
    return env;
  }

  #source(source, t0, t1, offset) {
    source.start(t0, offset);
    source.stop(t1);
    this.nodes.push(source);
    if (t1 >= this.end) {
      this.end = t1;
      this.last = source;
    }
  }

  #sec(ms) {
    return ms / 1000 / this.rate;
  }
}

/** A recipe's length in ms at rate 1, found by running it on a stand-in voice that only records end times. */
function measure(recipe, sound) {
  const probe = {
    end: 0,
    tone(_, { ms, delayMs = 0 }) {
      probe.end = Math.max(probe.end, delayMs + ms);
      return probe;
    },
    noise(_, layer) {
      return probe.tone(_, layer);
    },
    notes(_, { hz, stepMs, noteMs, lastNoteMs = noteMs }) {
      probe.end = Math.max(probe.end, (hz.length - 1) * stepMs + lastNoteMs);
      return probe;
    },
  };
  recipe(probe, sound);
  return probe.end;
}
