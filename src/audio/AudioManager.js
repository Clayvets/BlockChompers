import { Events } from '../core/Events.js';
import { Cues } from '../app/Cues.js';
import { SfxBank } from './SfxBank.js';
import { SfxScheduler } from './SfxScheduler.js';

/** Game events -> sounds. These follow debug.timeScale. */
const GAME_SOUNDS = [
  [Events.BLOCK_CONSUMED, 'pew'], // core has no UNIT_FIRED: a unit fires when it eats a block
  [Events.UNIT_ACTIVATED, 'launch'],
  [Events.UNIT_RELAUNCHED, 'launch'],
  [Events.FINAL_RUSH_STARTED, 'rush'],
];

/** Presentation cues -> sounds; true = a board moment that follows debug.timeScale, false = UI (always real time). */
const CUE_SOUNDS = [
  [Cues.BLOCK_BREAK, 'pop', true],
  [Cues.CAPACITY_TICK, 'tick', true],
  [Cues.UNIT_POP, 'unitPop', true],
  [Cues.UNIT_PARKED, 'park', true],
  [Cues.SLOTS_EMPTY, 'warn', true],
  [Cues.TAP, 'tap', false],
  [Cues.OVERLAY_IN, 'whooshIn', false],
  [Cues.OVERLAY_OUT, 'whooshOut', false],
  [Cues.WIN, 'fanfare', false],
  [Cues.LOSE, 'lose', false],
  [Cues.COIN, 'coin', false],
];

const createAudioContext = () => {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  return Context ? new Context() : null;
};

/**
 * Sound effects, presentation only: listens to game events (EventBus) and presentation cues (CueBus: UI actions and
 * the Renderer's visual moments), and plays SfxBank sounds. Graph: every voice -> sfx gain (render.audio.sfxVolume)
 * -> master gain (masterVolume; the Sound toggle mutes it) -> speakers. Those two gains are the only persistent
 * nodes; a voice's own nodes disconnect when it ends. There is no compressor: the voice cap, minIntervalMs and the
 * soft per-sound volumes keep the sum well below full scale, and a DynamicsCompressorNode would change the mix
 * (Chrome's squashes short sounds and adds makeup gain).
 *
 * The AudioContext is created and resumed on the Play click (the PLAY cue, inside the click handler), which satisfies
 * the browser autoplay policy; before that every sound is ignored. SfxScheduler decides whether a sound may start
 * before any node is made (voice cap, per-sound minIntervalMs, combo pitch, mute). Board sounds play at
 * debug.timeScale and follow pause: they come from the simulation and the Renderer's presentation clock, and neither
 * advances while paused, so no board sound starts then (UI sounds still do).
 */
export class AudioManager {
  #ctx = null;
  #master = null;
  #sfx = null;
  #live = 0;
  #muted;
  #unbind = null;
  #onVoiceEnded = () => {
    this.#live -= 1;
  };

  /**
   * @param {{ config: object, eventBus: object, cues: import('../app/Cues.js').CueBus, bank?: SfxBank,
   *           createContext?: () => AudioContext | null, random?: () => number }} deps
   */
  constructor({ config, eventBus, cues, bank = new SfxBank(config), createContext = createAudioContext, random = Math.random }) {
    this.config = config;
    this.audio = config.render.audio;
    this.eventBus = eventBus;
    this.cues = cues;
    this.bank = bank;
    this.createContext = createContext;
    this.scheduler = new SfxScheduler(this.audio, random);
    this.#muted = Boolean(this.audio.muted);
    this.scheduler.setMuted(this.#muted);
    const scale = config.debug.timeScale;
    this.gameRate = scale > 0 ? scale : 1;
  }

  /** True once the AudioContext exists (after the Play click). */
  get unlocked() {
    return this.#ctx !== null;
  }

  /** @returns {() => void} unbind */
  bind() {
    if (this.#unbind) return this.#unbind;
    const offs = GAME_SOUNDS.map(([type, name]) => this.eventBus.on(type, () => this.play(name, true)));
    offs.push(this.eventBus.on(Events.LEVEL_LOADED, () => this.scheduler.resetCombos()));
    for (const [cue, name, board] of CUE_SOUNDS) offs.push(this.cues.on(cue, () => this.play(name, board)));
    offs.push(this.cues.on(Cues.PLAY, () => {
      this.unlock();
      this.play('confirm');
    }));
    this.#unbind = () => {
      offs.forEach((off) => off());
      this.#unbind = null;
    };
    return this.#unbind;
  }

  /**
   * Create the AudioContext and its bus (first call), and resume it. Call it inside a user gesture: the Play click.
   * @returns {boolean} whether a context exists
   */
  unlock() {
    if (!this.#ctx) {
      let ctx = null;
      try {
        ctx = this.createContext();
      } catch (error) {
        console.warn('AudioManager: no AudioContext; sound stays off', error);
      }
      if (!ctx) return false;
      const { masterVolume, sfxVolume } = this.audio;
      this.#master = ctx.createGain();
      this.#master.gain.value = this.#muted ? 0 : masterVolume;
      this.#master.connect(ctx.destination);
      this.#sfx = ctx.createGain();
      this.#sfx.gain.value = sfxVolume;
      this.#sfx.connect(this.#master);
      this.#ctx = ctx;
      this.bank.load(ctx);
    }
    if (this.#ctx.state === 'suspended') this.#ctx.resume().catch(() => {});
    return true;
  }

  /** Sound toggle: ramp the master gain to 0 (or back) and stop making voices while muted. */
  setMuted(muted) {
    this.#muted = Boolean(muted);
    this.scheduler.setMuted(this.#muted);
    if (!this.#ctx) return;
    const target = this.#muted ? 0 : this.audio.masterVolume;
    // Time constant a third of the fade: 95% of the way there after muteFadeMs.
    this.#master.gain.setTargetAtTime(target, this.#ctx.currentTime, this.audio.muteFadeMs / 1000 / 3);
  }

  /**
   * Play `name` now, if the scheduler lets it start. `board`: a game or board sound, played at debug.timeScale.
   * @returns {boolean} whether a voice started
   */
  play(name, board = false) {
    const ctx = this.#ctx;
    if (!ctx || ctx.state === 'closed' || !this.bank.has(name)) return false;
    const rate = board ? this.gameRate : 1;
    const nowMs = ctx.currentTime * 1000;
    const pitch = this.scheduler.request(name, nowMs, this.audio.sounds[name], this.bank.durationMs(name), rate);
    if (!pitch) return false;
    const when = ctx.currentTime + this.audio.lookaheadMs / 1000;
    if (!this.bank.play(ctx, this.#sfx, name, when, pitch, rate, 1, this.#onVoiceEnded)) return false;
    this.#live += 1;
    return true;
  }

  /** Debug panel: voices the scheduler counts as playing, voices whose nodes are still connected, and the cap. */
  stats() {
    const ctx = this.#ctx;
    return {
      voices: ctx ? this.scheduler.active(ctx.currentTime * 1000) : 0,
      live: this.#live,
      max: this.audio.maxVoices,
      state: ctx ? ctx.state : 'locked',
    };
  }

  dispose() {
    if (this.#unbind) this.#unbind();
    if (this.#ctx) this.#ctx.close().catch(() => {});
    this.#ctx = null;
    this.#live = 0;
    this.scheduler.clear();
  }
}
