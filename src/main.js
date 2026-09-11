import { Config } from './config/Config.js';
import { createGame } from './core/createGame.js';
import { Events } from './core/Events.js';
import { GamePhase } from './core/GameManager.js';
import { levels, levelLibrary } from './core/levels/index.js';
import { AppFlow } from './app/AppFlow.js';
import { CueBus } from './app/Cues.js';
import { pickDebugLevel } from './debug/levelParam.js';
import { DebugPanel, layoutDebugEntries, statsDebugEntries } from './debug/DebugPanel.js';
import { FrameStats } from './debug/FrameStats.js';
import { RuntimeProbe } from './debug/RuntimeProbe.js';
import { hasDebugParam } from './debug/debugParam.js';
import { Renderer } from './render/Renderer.js';
import { RenderGate } from './render/RenderGate.js';
import { StyledFactory } from './render/StyledFactory.js';
import { AssetLoader } from './render/assets/AssetLoader.js';
import { ConfettiLayer } from './render/vfx/ConfettiLayer.js';
import { AudioManager } from './audio/AudioManager.js';
import { InputManager } from './input/InputManager.js';
import { UIManager } from './ui/UIManager.js';
import { loadStartScreenArt, loadUiFont } from './ui/startScreenArt.js';
import { loadHudArt } from './ui/hudArt.js';
import { loadOverlayArt } from './ui/overlayArt.js';
import { GameBackground } from './ui/GameBackground.js';
import { EffectsPreference, EffectsMode } from './ui/EffectsPreference.js';
import { SoundPreference } from './ui/SoundPreference.js';

// Composition root: the only module that knows about every layer.
const canvas = document.querySelector('#canvas-game');
const fxCanvas = document.querySelector('#canvas-fx');
const uiRoot = document.querySelector('#ui-root');
const bgRoot = document.querySelector('#game-bg');

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

// Fish of Fortune look: every asset is loaded once before the start screen appears (no loading screen). A file that
// fails logs an error naming it and its part keeps the v3 look: a model or the slot texture its primitive, the start
// screen, the HUD or the overlays their flat v3 versions, the background art the flat level colours. The label font
// (Titan One) is loaded once for the start screen, the HUD, the overlays and the capacity numbers.
const assets = new AssetLoader();
const font = loadUiFont(config.ui.startScreen.font);
const [, , startArt, hudArt, overlayArt, backgroundImage] = await Promise.all([
  assets.preload(StyledFactory.assetUrls(config)),
  Promise.all(StyledFactory.textureUrls(config).map((url) => assets.loadTexture(url))),
  loadStartScreenArt(config.ui.startScreen, assets, { font }),
  loadHudArt(config.ui.hud, assets, { font, fontUrl: config.ui.startScreen.font.url }),
  loadOverlayArt(config.ui, assets, { font }),
  assets.loadImage(config.render.backgroundArt.url),
]);
if (!backgroundImage) console.error(`Background: could not load "${config.render.backgroundArt.url}"; using the flat level colours instead`);
const background = backgroundImage ? new GameBackground({ root: bgRoot, config: config.render.backgroundArt, image: backgroundImage }) : null;
const renderer = new Renderer({ canvas, config, cues, factory: new StyledFactory(config, assets) });
const confetti = new ConfettiLayer({ canvas: fxCanvas, config });
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
  startArt,
  hudArt,
  overlayArt,
  hooks: {
    onWinShown: () => confetti.burst(levelColors(game.getSnapshot().levelId)),
    onResultClosed: () => confetti.stop(),
  },
});

renderer.init();
confetti.init();
renderer.setBackgroundArt(Boolean(background));
if (background) background.mount();
// Keep the board below the HUD: the styled HUD is a band in design units, the flat v3 bar a fixed pixel height.
if (hudArt) renderer.setHudBand(config.ui.hud.band);
else renderer.setViewportInsets({ top: config.ui.sizes.barHeight });
// Render on demand: the scene is synced and drawn only when it can change (see the frame loop).
const gate = new RenderGate();
const resize = () => {
  gate.invalidate();
  renderer.resize(window.innerWidth, window.innerHeight);
  confetti.resize(window.innerWidth, window.innerHeight);
  // The DOM layers follow where the Renderer put the design.
  const frame = renderer.screenFrame();
  ui.resize(frame);
  if (background) background.layout(frame);
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
ui.resize(renderer.screenFrame());
// Config.debug.enabled: layout outlines (Renderer) and the debug panel; ?debug (Config.debug.panelParam) shows the panel
// in any build, e.g. to profile the production bundle. The panel lists frame times (avg, p95) split into simulation,
// render and UI, draw calls, GPU memory, particles, tweens, voices, heap and long tasks; window.blockChompersDebug gives
// benchmark scripts the same objects.
const debugOn = config.debug.enabled || hasDebugParam(window.location.search, config.debug.panelParam);
const debugPanel = debugOn ? new DebugPanel({ root: uiRoot, config }) : null;
const frameStats = debugOn ? new FrameStats(config.debug.frameWindow) : null;
const probe = debugOn ? new RuntimeProbe() : null;
if (debugPanel) {
  debugPanel.mount();
  probe.start();
  window.blockChompersDebug = { game, flow, renderer, ui, confetti, audio, frameStats, probe };
}

if (config.debug.logEvents) {
  for (const type of Object.values(Events)) {
    unbinds.push(eventBus.on(type, (payload) => console.debug(`[event] ${type}`, payload)));
  }
}

// Fixed-step logic driven by real time x debug.timeScale, only while the flow is PLAYING; rendering and effects read
// the snapshot every frame, except while the scene is still: paused (the presentation clock is frozen) or behind the
// opaque styled start screen. Then RenderGate skips the scene's sync and draw until what it shows changes; the UI
// still updates every frame.
let running = true;
let last = performance.now();
let panelAt = last;
const maxFrameMs = config.timing.maxFrameDt * 1000;

function frame(now) {
  if (!running) return;
  const intervalMs = now - last;
  const realMs = Math.min(Math.max(0, intervalMs), maxFrameMs);
  last = now;
  const scaledMs = realMs * config.debug.timeScale;

  const t0 = frameStats ? performance.now() : 0;
  flow.update(scaledMs / 1000);
  const snapshot = game.getSnapshot();
  const t1 = frameStats ? performance.now() : 0;
  // Units are clickable only in a running, unpaused level with no overlay animating; modals also block the pointer.
  input.setEnabled(flow.playing && snapshot.phase === GamePhase.PLAYING && !snapshot.paused && !ui.isAnimating());
  const draw = gate.shouldDraw(snapshot.paused || ui.coversScene(), snapshot);
  if (draw) renderer.sync(snapshot, scaledMs);
  const t2 = frameStats ? performance.now() : 0;
  ui.update(snapshot, realMs);
  const t3 = frameStats ? performance.now() : 0;
  if (draw) renderer.render();
  confetti.update(scaledMs);

  if (frameStats) {
    const t4 = performance.now();
    frameStats.record(intervalMs, t1 - t0, t2 - t1 + (t4 - t3), t3 - t2);
    probe.sample(now);
    // Twice a second, so the debug readout itself adds no per-frame work or allocations.
    if (now - panelAt >= 500) {
      panelAt = now;
      debugPanel.update([
        ...layoutDebugEntries(renderer.getLayout(), snapshot),
        ...statsDebugEntries({ frame: frameStats.summary(), stats: renderer.getStats(), confetti: confetti.stats(), audio: audio.stats(), ui: ui.stats(), probe: probe.stats() }),
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
    if (probe) probe.stop();
    audio.dispose();
    confetti.dispose();
    if (background) background.unmount();
    assets.dispose();
    renderer.dispose();
  });
}
