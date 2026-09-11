/**
 * Browser-side numbers for the debug panel (debug only): long tasks (> 50 ms, PerformanceObserver 'longtask') and the
 * JS heap (performance.memory, Chrome only), sampled once per frame. A heap drop of more than gcDropBytes marks a
 * garbage collection; the positive steps between samples give the allocation rate. Chrome reports the heap in coarse
 * steps, so the rate is a trend, not an exact figure.
 */
export class RuntimeProbe {
  constructor({ gcDropBytes = 512 * 1024 } = {}) {
    this.gcDropBytes = gcDropBytes;
    this.observer = null;
    this.reset();
  }

  start() {
    if (typeof PerformanceObserver !== 'function') return;
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTasks += 1;
          if (entry.duration > this.longestTask) this.longestTask = entry.duration;
        }
      });
      this.observer.observe({ type: 'longtask', buffered: false });
    } catch {
      this.observer = null; // not supported: long tasks stay 0
    }
  }

  /** Once per frame: heap level, GC drops and allocation. */
  sample(nowMs) {
    const memory = globalThis.performance && globalThis.performance.memory;
    if (!memory) return;
    const used = memory.usedJSHeapSize;
    if (this.lastUsed > 0) {
      const delta = used - this.lastUsed;
      if (delta < -this.gcDropBytes) this.gcDrops += 1;
      else if (delta > 0) this.allocated += delta;
    }
    this.lastUsed = used;
    if (this.since < 0) this.since = nowMs;
    const elapsed = nowMs - this.since;
    if (elapsed >= 1000) {
      this.allocMBps = this.allocated / (1024 * 1024) / (elapsed / 1000);
      this.allocated = 0;
      this.since = nowMs;
    }
  }

  stats() {
    return {
      longTasks: this.longTasks,
      longestTask: this.longestTask,
      gcDrops: this.gcDrops,
      heapMB: this.lastUsed / (1024 * 1024),
      allocMBps: this.allocMBps,
    };
  }

  reset() {
    this.longTasks = 0;
    this.longestTask = 0;
    this.gcDrops = 0;
    this.lastUsed = 0;
    this.allocated = 0;
    this.allocMBps = 0;
    this.since = -1;
  }

  stop() {
    if (this.observer) this.observer.disconnect();
    this.observer = null;
  }
}
