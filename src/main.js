import { Config } from './config/Config.js';
import { createGame } from './core/createGame.js';
import { Events } from './core/Events.js';
import { GamePhase } from './core/GameManager.js';
import { levels, levelLibrary } from './core/levels/index.js';
import { pickDebugLevel } from './debug/levelParam.js';
import { DebugPanel, layoutDebugEntries, statsDebugEntries } from './debug/DebugPanel.js';
import { Renderer } from './render/Renderer.js';
import { VfxFactory } from './render/vfx/VfxFactory.js';
import { ConfettiLayer } from './render/vfx/ConfettiLayer.js';
import { InputManager } from './input/InputManager.js';
import { UIManager } from './ui/UIManager.js';
import { EffectsPreference, EffectsMode } from './ui/EffectsPreference.js';

// Composition root: the only module that knows about every layer.
const canvas = document.querySelector('#canvas-game');
const fxCanvas = document.querySelector('#canvas-fx');
const uiRoot = document.querySelector('#ui-root');

// Debug level select: ?level=<id> plays that level on its own (see Config.debug.levelParam).
const debug = pickDebugLevel(window.location.search, levelLibrary, Config.debug.levelParam);
if (debug.id && !debug.level) console.warn(`Unknown level "${debug.id}"; known: ${Object.keys(levelLibrary).join(', ')}`);
const { game, eventBus, config } = createGame({ config: Config, levels: debug.level ? [debug.level] : levels });

// "Effects: full / reduced" (settings). Reduced by default when the OS asks for less motion.
const prefersReduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const effects = new EffectsPreference(prefersReduced ? EffectsMode.REDUCED : EffectsMode.FULL);

/** The level's palette colours (hex), for the win confetti. */
const levelColors = (levelId) => {
  const { palette, levels: styles } = config.render;
  return Object.values({ ...palette, ...((styles[levelId] || {}).palette || {}) });
};

const renderer = new Renderer({ canvas, config });
const confetti = new ConfettiLayer({ canvas: fxCanvas, config, factory: new VfxFactory(config) });
const input = new InputManager({ canvas, renderer, gameManager: game });
const ui = new UIManager({
  root: uiRoot,
  eventBus,
  gameManager: game,
  config,
  effects,
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
  eventBus.on(Events.LEVEL_LOADED, () => confetti.clear()),
  effects.subscribe((reduced) => {
    renderer.setEffectsReduced(reduced);
    confetti.setReduced(reduced);
  }),
];
input.attach();
ui.mount();
// Config.debug.enabled: layout outlines (Renderer) and a panel with cellSize, FPS, draw calls, particles and memory.
const debugPanel = config.debug.enabled ? new DebugPanel({ root: uiRoot, config }) : null;
if (debugPanel) debugPanel.mount();

if (config.debug.logEvents) {
  for (const type of Object.values(Events)) {
    unbinds.push(eventBus.on(type, (payload) => console.debug(`[event] ${type}`, payload)));
  }
}

// Fixed-step logic driven by real time x debug.timeScale; rendering and effects read the snapshot every frame.
let running = true;
let last = performance.now();
const fps = { frames: 0, since: last, value: 0 };
const maxFrameMs = config.timing.maxFrameDt * 1000;

function frame(now) {
  if (!running) return;
  const realMs = Math.min(Math.max(0, now - last), maxFrameMs);
  last = now;
  const scaledMs = realMs * config.debug.timeScale;

  game.update(scaledMs / 1000);
  const snapshot = game.getSnapshot();
  // Units are clickable only while the level runs unpaused and no overlay is animating; modals also block the pointer.
  input.setEnabled(snapshot.phase === GamePhase.PLAYING && !snapshot.paused && !ui.isAnimating());
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
      debugPanel.update([...layoutDebugEntries(renderer.getLayout(), snapshot), ...statsDebugEntries(fps.value, renderer.getStats(), confetti.stats())]);
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
    confetti.dispose();
    renderer.dispose();
  });
}
