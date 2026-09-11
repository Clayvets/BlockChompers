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
 * Panel lines for performance.
 *   frame    FrameStats.summary(): fps, frame interval avg / p95 / max, main-thread work split into simulation, render
 *            (sync + draw + confetti) and UI (DOM)
 *   stats    Renderer.getStats(): draw calls, triangles, GPU memory and shader programs, active effect instances
 *   confetti ConfettiLayer.stats(); audio AudioManager.stats() (live = voices whose nodes are still connected)
 *   ui       UIManager.stats(): tweens and Web Animations running; probe RuntimeProbe.stats(): heap, GC, long tasks
 */
export function statsDebugEntries({ frame, stats, confetti, audio = null, ui = null, probe = null }) {
  const ms = (v) => v.toFixed(1);
  const entries = [
    ['fps', `${frame.fps.toFixed(0)}  frame avg ${ms(frame.frameAvg)} ms, p95 ${ms(frame.frameP95)}, max ${ms(frame.frameMax)}`],
    ['work', `${ms(frame.workAvg)} ms (p95 ${ms(frame.workP95)}): sim ${ms(frame.simAvg)}, render ${ms(frame.renderAvg)}, ui ${ms(frame.uiAvg)}`],
    ['draw calls', `${stats.calls}${confetti.calls ? ` + ${confetti.calls} confetti` : ''}, triangles ${stats.triangles}`],
    ['gpu', `geometries ${stats.geometries}, textures ${stats.textures}, programs ${stats.programs}`],
    ['particles', `${stats.particles} (projectiles ${stats.projectiles}, blocks ${stats.blocks}, confetti ${confetti.confetti})`],
  ];
  if (ui) entries.push(['tweens', `${ui.tweens} (web animations ${ui.animations})`]);
  if (audio) entries.push(['voices', `${audio.voices}/${audio.max} (live ${audio.live}, ${audio.state})`]);
  if (probe) {
    entries.push(['heap', `${probe.heapMB.toFixed(1)} MB (+${probe.allocMBps.toFixed(2)} MB/s), gc ${probe.gcDrops}`]);
    entries.push(['long tasks', `${probe.longTasks}${probe.longTasks ? ` (max ${probe.longestTask.toFixed(0)} ms)` : ''}`]);
  }
  return entries;
}
