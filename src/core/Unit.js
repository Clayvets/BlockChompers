/**
 * Lifecycle of a unit ("chomper"):
 *
 *   RESERVE --activateUnit--> LAUNCHING --entry clear--> RUNNING <--> EATING --capacity 0--> DEAD
 *                                  ^                         |
 *                                  |                    lap complete, capacity left
 *                         launchFromSlot                     v
 *                                  +-------------------- RETURNED (parked in the leftmost free slot)
 */
export const UnitState = Object.freeze({
  /** Sitting in the 4xN reserve grid; the front of each column is clickable. */
  RESERVE: 'reserve',
  /** Flying from its reserve cell (or its parking slot, for a relaunch) to the track entry; holds no slot. */
  LAUNCHING: 'launching',
  /** Travelling the perimeter loop. */
  RUNNING: 'running',
  /** Paused on the track while consuming a block (timing.eatDuration). */
  EATING: 'eating',
  /** Completed a lap with capacity > 0; parked in (and blocking) a slot until relaunched. */
  RETURNED: 'returned',
  /** Capacity reached 0; removed from play. */
  DEAD: 'dead',
});

/** States that count as "moving" for the slot limit and the lose check. */
const MOVING_STATES = new Set([UnitState.LAUNCHING, UnitState.RUNNING, UnitState.EATING]);

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
    /** Slot index while parked (RETURNED); null otherwise. Moving units hold no slot. */
    this.slotIndex = null;
    /** Position in the reserve grid (kept after launch: it is where the unit left from). */
    this.reservePos = { ...reservePos };
    /** Where the current launch started: { kind: 'reserve', col, row } | { kind: 'slot', index } | null. */
    this.launchOrigin = null;
    /** Order of the latest launch or relaunch (1, 2, ...); ties between moving units break on it. */
    this.launchSeq = null;
    /** Track parameter in cell units; equals distanceTraveled while on the track (entry is t = 0). */
    this.t = 0;
    /** Distance travelled this lap; a lap completes at Track.length (never compare t to entryT). */
    this.distanceTraveled = 0;
    /** distanceTraveled at the start of the latest step; the renderer interpolates prevDistance -> distanceTraveled. */
    this.prevDistance = 0;
    /** Whole logic steps since this unit entered the track on its current lap (drives the acceleration ramp). */
    this.trackSteps = 0;
    /** Speed (cells/s) of the latest move step, including the final-rush factor; 0 off the track. */
    this.speed = 0;
    /** Countdown in whole logic STEPS (not seconds) used by the LAUNCHING (flight) and EATING states. */
    this.timer = 0;
  }

  /** True while the unit is moving: LAUNCHING, RUNNING or EATING. Moving units count against the slot limit. */
  isRunner() {
    return MOVING_STATES.has(this.state);
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
      launchOrigin: this.launchOrigin ? { ...this.launchOrigin } : null,
      launchSeq: this.launchSeq,
      t: this.t,
      distanceTraveled: this.distanceTraveled,
      prevDistance: this.prevDistance,
      trackSteps: this.trackSteps,
      speed: this.speed,
      timer: this.timer,
    };
  }
}
