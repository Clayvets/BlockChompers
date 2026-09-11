/**
 * Debug-only DOM readout (Config.debug.enabled): a small text box in #ui-root listing "key: value" lines, e.g. the
 * level's board cellSize from Renderer.getLayout(). Styled from Config.debug.panel; #ui-root ignores the pointer, so
 * the box never blocks a tap. It keeps no game state and touches the DOM only when its text changes.
 */
export class DebugPanel {
  #el = null;
  #text = null;

  /** @param {{ root: HTMLElement, config: object }} deps */
  constructor({ root, config }) {
    this.root = root;
    this.config = config;
  }

  mount() {
    if (this.#el) return;
    const { right, bottom, padding, font, color, background } = this.config.debug.panel;
    const el = this.root.ownerDocument.createElement('pre');
    Object.assign(el.style, {
      position: 'fixed', right: `${right}px`, bottom: `${bottom}px`, margin: '0', padding: `${padding}px`,
      font, color, background, whiteSpace: 'pre', pointerEvents: 'none',
    });
    this.root.append(el);
    this.#el = el;
  }

  /** @param {Array<[string, string|number]>} entries */
  update(entries) {
    if (!this.#el) return;
    const text = entries.map(([key, value]) => `${key}: ${value}`).join('\n');
    if (text === this.#text) return;
    this.#text = text;
    this.#el.textContent = text;
  }

  unmount() {
    if (this.#el) this.#el.remove();
    this.#el = null;
    this.#text = null;
  }
}

/** Panel lines for a layout (Renderer.getLayout()) and snapshot; empty before a level is drawn. */
export function layoutDebugEntries(layout, snapshot) {
  if (!layout || !snapshot) return [];
  const { board, cellSize } = layout;
  return [
    ['level', snapshot.levelId],
    ['cellSize', cellSize.toFixed(4)],
    ['board', `${board.cols} x ${board.rows}`],
  ];
}

/**
 * Panel lines for performance: FPS, draw calls, active effect instances, GPU memory (renderer.info.memory) and, with
 * AudioManager.stats(), the sound voices playing (live = voices whose nodes are still connected).
 */
export function statsDebugEntries(fps, stats, confetti, audio = null) {
  const entries = [
    ['fps', fps.toFixed(0)],
    ['draw calls', `${stats.calls}${confetti.calls ? ` + ${confetti.calls} confetti` : ''}`],
    ['particles', `${stats.particles} (projectiles ${stats.projectiles}, blocks ${stats.blocks}, confetti ${confetti.confetti})`],
    ['memory', `geometries ${stats.geometries}, textures ${stats.textures}`],
  ];
  if (audio) entries.push(['voices', `${audio.voices}/${audio.max} (live ${audio.live}, ${audio.state})`]);
  return entries;
}
