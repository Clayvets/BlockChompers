import { Config } from './config/Config.js';
import { createGame } from './core/createGame.js';
import { Events } from './core/Events.js';
import { GamePhase } from './core/GameManager.js';
import { levels, levelLibrary } from './core/levels/index.js';
import { AppFlow } from './app/AppFlow.js';
import { CueBus } from './app/Cues.js';
import { pickDebugLevel } from './debug/levelParam.js';
import { DebugPanel, layoutDebugEntries, statsDebugEntries } from './debug/DebugPanel.js';
import { Renderer } from './render/Renderer.js';
import { VfxFactory } from './render/vfx/VfxFactory.js';
import { ConfettiLayer } from './render/vfx/ConfettiLayer.js';
import { AudioManager } from './audio/AudioManager.js';
import { InputManager } from './input/InputManager.js';
import { UIManager } from './ui/UIManager.js';
import { EffectsPreference, EffectsMode } from './ui/EffectsPreference.js';
import { SoundPreference } from './ui/SoundPreference.js';

// Composition root: the only module that knows about every layer.
const canvas = document.querySelector('#canvas-game');
const fxCanvas = document.querySelector('#canvas-fx');
const uiRoot = document.querySelector('#ui-root');

// Debug level select: ?level=<id> plays that level on its own (see Config.debug.levelParam).
const debug = pickDebugLevel(window.location.search, levelLibrary, Config.debug.levelParam);
if (debug.id && !debug.level) console.warn(`Unknown level "${debug.id}"; known: ${Object.keys(levelLibrary).join(', ')}`);
const { game, eventBus, config } = createGame({ config: Config, levels: debug.level ? [debug.level] : levels });

// Start screen first (MENU); Play moves to PLAYING and loads Level 1. The simulation only advances through the flow.
const flow = new AppFlow({ game });
// Presentation cues (UI actions, visual moments) for the sounds; the game's own events stay on eventBus.
const cues = new CueBus();

// Effects level from config, with no visible option: reduced when the OS asks for less motion.
const prefersReduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const effects = new EffectsPreference(prefersReduced ? EffectsMode.REDUCED : config.render.vfx.effects);
// "Sound: on / off" (settings).
const sound = new SoundPreference(!config.render.audio.muted);

/** The level's palette colours (hex), for the win confetti. */
const levelColors = (levelId) => {
  const { palette, levels: styles } = config.render;
  return Object.values({ ...palette, ...((styles[levelId] || {}).palette || {}) });
};

const renderer = new Renderer({ canvas, config, cues });
const confetti = new ConfettiLayer({ canvas: fxCanvas, config, factory: new VfxFactory(config) });
const audio = new AudioManager({ config, eventBus, cues });
const input = new InputManager({ canvas, renderer, gameManager: game });
const ui = new UIManager({
  root: uiRoot,
  eventBus,
  gameManager: game,
  config,
  flow,
  effects,
  sound,
  cues,
  hooks: {
    onWinShown: () => confetti.burst(levelColors(game.getSnapshot().levelId)),
    onResultClosed: () => confetti.stop(),
  },
});

renderer.init();
confetti.init();
renderer.setViewportInsets({ top: config.ui.sizes.barHeight }); // keep the board below the HUD bar
const resize = () => {
  renderer.resize(window.innerWidth, window.innerHeight);
  confetti.resize(window.innerWidth, window.innerHeight);
};
resize();
const unbinds = [
  renderer.bindEvents(eventBus),
  audio.bind(),
  eventBus.on(Events.LEVEL_LOADED, () => confetti.clear()),
  effects.subscribe((reduced) => {
    renderer.setEffectsReduced(reduced);
    confetti.setReduced(reduced);
  }),
  sound.subscribe((on) => audio.setMuted(!on)),
];
input.attach();
ui.mount();
// Config.debug.enabled: layout outlines (Renderer) and a panel with cellSize, FPS, draw calls, particles, memory, voices.
const debugPanel = config.debug.enabled ? new DebugPanel({ root: uiRoot, config }) : null;
if (debugPanel) debugPanel.mount();

if (config.debug.logEvents) {
  for (const type of Object.values(Events)) {
    unbinds.push(eventBus.on(type, (payload) => console.debug(`[event] ${type}`, payload)));
  }
}

// Fixed-step logic driven by real time x debug.timeScale, only while the flow is PLAYING; rendering and effects read
// the snapshot every frame.
let running = true;
let last = performance.now();
const fps = { frames: 0, since: last, value: 0 };
const maxFrameMs = config.timing.maxFrameDt * 1000;

function frame(now) {
  if (!running) return;
  const realMs = Math.min(Math.max(0, now - last), maxFrameMs);
  last = now;
  const scaledMs = realMs * config.debug.timeScale;

  flow.update(scaledMs / 1000);
  const snapshot = game.getSnapshot();
  // Units are clickable only in a running, unpaused level with no overlay animating; modals also block the pointer.
  input.setEnabled(flow.playing && snapshot.phase === GamePhase.PLAYING && !snapshot.paused && !ui.isAnimating());
  renderer.sync(snapshot, scaledMs);
  ui.update(snapshot, realMs);
  renderer.render();
  confetti.update(scaledMs);

  if (debugPanel) {
    // Twice a second, so the debug readout itself adds no per-frame work or allocations.
    fps.frames += 1;
    if (now - fps.since >= 500) {
      fps.value = (fps.frames * 1000) / (now - fps.since);
      fps.frames = 0;
      fps.since = now;
      debugPanel.update([
        ...layoutDebugEntries(renderer.getLayout(), snapshot),
        ...statsDebugEntries(fps.value, renderer.getStats(), confetti.stats(), audio.stats()),
      ]);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', resize);

// Vite HMR: tear the old graph down so a reload doesn't leave two loops running.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    running = false;
    window.removeEventListener('resize', resize);
    unbinds.forEach((unbind) => unbind());
    input.detach();
    ui.unmount();
    if (debugPanel) debugPanel.unmount();
    audio.dispose();
    confetti.dispose();
    renderer.dispose();
  });
}
