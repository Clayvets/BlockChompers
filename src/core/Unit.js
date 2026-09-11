/** Lifecycle of a unit ("chomper"). */
export const UnitState = Object.freeze({
  /** Sitting in the 4xN reserve grid; clickable. */
  RESERVE: 'reserve',
  /** Moved into an active slot; counting down the launch delay before entering the track. */
  ACTIVE: 'active',
  /** Travelling the perimeter loop. */
  RUNNING: 'running',
  /** Paused on the track while consuming a block (timing.eatDuration). */
  EATING: 'eating',
  /** Completed a lap with capacity > 0; permanently occupies (blocks) its slot. */
  RETURNED: 'returned',
  /** Capacity reached 0; removed from play, slot freed. */
  DEAD: 'dead',
});

const RUNNER_STATES = new Set([UnitState.ACTIVE, UnitState.RUNNING, UnitState.EATING]);

/**
 * Dumb data holder for one unit. No rules live here -- GameManager drives the state machine.
 * Ids are stable for the life of a level so the renderer can key meshes by them.
 */
export class Unit {
  /**
   * @param {{ id: string, color: number, capacity: number, reservePos: { col: number, row: number } }} init
   */
  constructor({ id, color, capacity, reservePos }) {
    /** @type {string} */
    this.id = id;
    /** Logical colour id (matches matrix values). */
    this.color = color;
    /** Remaining blocks this unit can eat. */
    this.capacity = capacity;
    /** Capacity at load time (for HUD / progress). */
    this.initialCapacity = capacity;
    /** @type {string} one of UnitState */
    this.state = UnitState.RESERVE;
    /** Active slot index once activated; the unit returns to / blocks THIS slot. */
    this.slotIndex = null;
    /** Position in the reserve grid. */
    this.reservePos = { ...reservePos };
    /** Track parameter in cell units; equals distanceTraveled while on the track (entry is t = 0). */
    this.t = 0;
    /** Distance travelled this lap; a lap completes at Track.length (never compare t to entryT). */
    this.distanceTraveled = 0;
    /** distanceTraveled at the start of the latest step; the renderer interpolates prevDistance -> distanceTraveled. */
    this.prevDistance = 0;
    /** Countdown in whole logic STEPS (not seconds) used by the ACTIVE (launch) and EATING states. */
    this.timer = 0;
  }

  /** True while the unit occupies a slot AND is in motion or about to be (ACTIVE | RUNNING | EATING). */
  isRunner() {
    return RUNNER_STATES.has(this.state);
  }

  /** Decrease capacity by n, never below 0. */
  consume(n = 1) {
    this.capacity = Math.max(0, this.capacity - n);
  }

  /** Plain, JSON-serialisable copy for snapshots. */
  toState() {
    return {
      id: this.id,
      color: this.color,
      capacity: this.capacity,
      initialCapacity: this.initialCapacity,
      state: this.state,
      slotIndex: this.slotIndex,
      reservePos: { ...this.reservePos },
      t: this.t,
      distanceTraveled: this.distanceTraveled,
      prevDistance: this.prevDistance,
      timer: this.timer,
    };
  }
}
