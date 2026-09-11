import { Config } from './config/Config.js';
import { createGame } from './core/createGame.js';
import { level01 } from './core/levels/index.js';
import { Renderer } from './render/Renderer.js';
import { InputManager } from './input/InputManager.js';
import { UIManager } from './ui/UIManager.js';

// Composition root: the only module that knows about every layer.
const canvas = document.querySelector('#canvas-game');
const uiRoot = document.querySelector('#ui-root');

const { game, eventBus, config } = createGame({ config: Config, level: level01 });

const renderer = new Renderer({ canvas, config });
const input = new InputManager({ canvas, renderer, gameManager: game });
const ui = new UIManager({ root: uiRoot, eventBus, gameManager: game });

renderer.init();
renderer.resize(window.innerWidth, window.innerHeight);
const unbindRendererEvents = renderer.bindEvents(eventBus);
input.attach();
ui.mount();
ui.onRestart(() => game.reset());

// Fixed-step logic driven by real time; rendering reads the snapshot every frame.
let running = true;
let last = performance.now();

function frame(now) {
  if (!running) return;
  const dt = (now - last) / 1000;
  last = now;

  game.update(dt);
  const snapshot = game.getSnapshot();
  renderer.sync(snapshot);
  ui.update(snapshot);
  renderer.render();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => renderer.resize(window.innerWidth, window.innerHeight));

// Vite HMR: tear the old graph down so a reload doesn't leave two loops running.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    running = false;
    unbindRendererEvents();
    input.detach();
    ui.unmount();
    renderer.dispose();
  });
}
