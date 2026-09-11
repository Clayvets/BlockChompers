/**
 * Rolling frame statistics for the debug panel and the benchmarks (pure: no DOM, no clock; the frame loop passes the
 * times in). record() keeps the last `size` frames in preallocated ring buffers and summary() sorts a preallocated copy,
 * so neither allocates per frame.
 *
 *   record(intervalMs, simMs, renderMs, uiMs)   interval: time since the previous frame (what the player feels);
 *                                               sim / render / ui: main-thread work of this frame, by part
 *   summary() -> { samples, fps, frameAvg, frameP95, frameMax, workAvg, workP95, simAvg, renderAvg, uiAvg }
 */
export class FrameStats {
  constructor(size = 240) {
    this.size = size;
    this.interval = new Float64Array(size);
    this.sim = new Float64Array(size);
    this.render = new Float64Array(size);
    this.ui = new Float64Array(size);
    this.scratch = new Float64Array(size);
    this.count = 0;
    this.next = 0;
  }

  record(intervalMs, simMs, renderMs, uiMs) {
    const i = this.next;
    this.interval[i] = intervalMs;
    this.sim[i] = simMs;
    this.render[i] = renderMs;
    this.ui[i] = uiMs;
    this.next = (i + 1) % this.size;
    if (this.count < this.size) this.count += 1;
  }

  reset() {
    this.count = 0;
    this.next = 0;
  }

  summary() {
    const n = this.count;
    if (n === 0) return { samples: 0, fps: 0, frameAvg: 0, frameP95: 0, frameMax: 0, workAvg: 0, workP95: 0, simAvg: 0, renderAvg: 0, uiAvg: 0 };
    let interval = 0;
    let sim = 0;
    let render = 0;
    let ui = 0;
    let max = 0;
    for (let k = 0; k < n; k += 1) {
      interval += this.interval[k];
      sim += this.sim[k];
      render += this.render[k];
      ui += this.ui[k];
      if (this.interval[k] > max) max = this.interval[k];
    }
    const frameP95 = this.#p95(this.interval, n);
    for (let k = 0; k < n; k += 1) this.scratch[k] = this.sim[k] + this.render[k] + this.ui[k];
    const workP95 = this.#p95Scratch(n);
    return {
      samples: n,
      fps: interval > 0 ? (1000 * n) / interval : 0,
      frameAvg: interval / n,
      frameP95,
      frameMax: max,
      workAvg: (sim + render + ui) / n,
      workP95,
      simAvg: sim / n,
      renderAvg: render / n,
      uiAvg: ui / n,
    };
  }

  #p95(values, n) {
    for (let k = 0; k < n; k += 1) this.scratch[k] = values[k];
    return this.#p95Scratch(n);
  }

  /** 95th percentile (nearest rank) of scratch[0 .. n). */
  #p95Scratch(n) {
    const view = this.scratch.subarray(0, n);
    view.sort();
    return view[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  }
}
