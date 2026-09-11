import { Config } from './config/Config.js';
import { createGame } from './core/createGame.js';
import { Events } from './core/Events.js';
import { GamePhase } from './core/GameManager.js';
import { levels, levelLibrary } from './core/levels/index.js';
import { pickDebugLevel } from './debug/levelParam.js';
import { DebugPanel, layoutDebugEntries } from './debug/DebugPanel.js';
import { Renderer } from './render/Renderer.js';
import { InputManager } from './input/InputManager.js';
import { UIManager } from './ui/UIManager.js';

// Composition root: the only module that knows about every layer.
const canvas = document.querySelector('#canvas-game');
const uiRoot = document.querySelector('#ui-root');

// Debug level select: ?level=<id> plays that level on its own (see Config.debug.levelParam).
const debug = pickDebugLevel(window.location.search, levelLibrary, Config.debug.levelParam);
if (debug.id && !debug.level) console.warn(`Unknown level "${debug.id}"; known: ${Object.keys(levelLibrary).join(', ')}`);
const { game, eventBus, config } = createGame({ config: Config, levels: debug.level ? [debug.level] : levels });

const renderer = new Renderer({ canvas, config });
const input = new InputManager({ canvas, renderer, gameManager: game });
const ui = new UIManager({ root: uiRoot, eventBus, gameManager: game, config });

renderer.init();
renderer.setViewportInsets({ top: config.ui.sizes.barHeight }); // keep the board below the HUD bar
renderer.resize(window.innerWidth, window.innerHeight);
const unbinds = [renderer.bindEvents(eventBus)];
input.attach();
ui.mount();
// Config.debug.enabled: layout outlines (Renderer) and a panel with the level's cellSize.
const debugPanel = config.debug.enabled ? new DebugPanel({ root: uiRoot, config }) : null;
if (debugPanel) debugPanel.mount();

if (config.debug.logEvents) {
  for (const type of Object.values(Events)) {
    unbinds.push(eventBus.on(type, (payload) => console.debug(`[event] ${type}`, payload)));
  }
}

// Fixed-step logic driven by real time; rendering reads the snapshot every frame.
let running = true;
let last = performance.now();

function frame(now) {
  if (!running) return;
  const dt = (now - last) / 1000;
  last = now;

  game.update(dt);
  const snapshot = game.getSnapshot();
  // Units are clickable only while the level runs unpaused; the modals also block the pointer physically.
  input.setEnabled(snapshot.phase === GamePhase.PLAYING && !snapshot.paused);
  renderer.sync(snapshot);
  ui.update(snapshot);
  if (debugPanel) debugPanel.update(layoutDebugEntries(renderer.getLayout(), snapshot));
  renderer.render();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const onResize = () => renderer.resize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', onResize);

// Vite HMR: tear the old graph down so a reload doesn't leave two loops running.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    running = false;
    window.removeEventListener('resize', onResize);
    unbinds.forEach((unbind) => unbind());
    input.detach();
    ui.unmount();
    if (debugPanel) debugPanel.unmount();
    renderer.dispose();
  });
}
