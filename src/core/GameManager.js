import { GridManager } from './GridManager.js';
import { InventoryManager } from './InventoryManager.js';
import { Track } from './Track.js';
import { UnitState } from './Unit.js';
import { Events, RejectReason, LoseReason } from './Events.js';
import { findValidMoves } from './Simulator.js';
import { ProgressManager } from './ProgressManager.js';

export const GamePhase = Object.freeze({ IDLE: 'idle', PLAYING: 'playing', WON: 'won', LOST: 'lost' });

/**
 * Orchestrator. The ONLY class that mutates game state in response to time (step) or commands
 * (activateUnit). Emits domain events; exposes a plain snapshot.
 *
 *   commands in : activateUnit, launchFromSlot, pause, resume, restartLevel, continueToNextLevel -> { ok, reason };
 *                 the two launch commands never throw; command events emit at once
 *   state out   : getSnapshot() every frame (structure)
 *   events out  : collected during step() and flushed after it (effects)
 *
 * Determinism: no clock, no randomness; timers are whole steps; a unit's t equals its distance
 * travelled (entry is t = 0) so no float wrap ever happens inside the step loop.
 */
export class GameManager {
  #accumulator = 0;
  #pendingEvents = [];
  #stepping = false;
  #launchSteps = 0;
  #eatSteps = 0;
  #movesCache = { gridVersion: -1, inventoryVersion: -1, moves: [] };

  /**
   * @param {{ config: object, eventBus: import('./EventBus.js').EventBus, grid?: GridManager, inventory?: InventoryManager,
   *           progress?: ProgressManager }} deps
   */
  constructor({
    config,
    eventBus,
    grid = new GridManager({ config }),
    inventory = new InventoryManager({ config }),
    progress = new ProgressManager({ config }),
  }) {
    this.config = config;
    this.eventBus = eventBus;
    this.grid = grid;
    this.inventory = inventory;
    /** @type {Track | null} built in loadLevel from the grid's dimensions */
    this.track = null;
    this.phase = GamePhase.IDLE;
    this.level = null;
    this.stepCount = 0;
    /** Money and level progression (pure; see ProgressManager). */
    this.progress = progress;
    /** Simulation frozen by pause(); cleared by resume() and by every loadLevel. */
    this.paused = false;
  }

  /**
   * Full level check, run by loadLevel before any state changes. Everything here is a hard error:
   *   - grid structure (GridManager.validate)
   *   - units: a non-empty array; each colour a positive integer; each capacity (default
   *     units.defaultCapacity) an integer >= units.minCapacity
   *   - per-colour balance: the capacities of a colour's units must sum EXACTLY to that colour's block
   *     count. Too much capacity parks a unit and blocks its slot forever; too little leaves blocks nobody
   *     can eat. A colour present on only one side counts as 0 on the other.
   * Consequence: a level is won only by running every unit down to capacity 0, and a parked unit makes
   * the level unwinnable.
   * @param {{ id?: string, grid: number[][], units: Array<{ color: number, capacity?: number }> }} level
   * @param {object} config
   * @returns {{ ok: boolean, errors: string[] }}
   */
  static validateLevel(level, config) {
    if (!level || typeof level !== 'object') return { ok: false, errors: ['level must be an object'] };
    const { emptyValue } = config.grid;
    const { defaultCapacity, minCapacity } = config.units;
    const errors = [...GridManager.validate(level.grid, { emptyValue }).errors];

    const capacityByColor = new Map();
    if (!Array.isArray(level.units) || level.units.length === 0) {
      errors.push('units must be a non-empty array');
    } else {
      level.units.forEach((raw, i) => {
        const def = raw || {};
        const capacity = def.capacity === undefined ? defaultCapacity : def.capacity;
        if (!Number.isInteger(def.color) || def.color <= 0) errors.push(`unit ${i}: color must be a positive integer`);
        else if (!Number.isInteger(capacity) || capacity < minCapacity) errors.push(`unit ${i}: capacity must be an integer >= ${minCapacity}`);
        else capacityByColor.set(def.color, (capacityByColor.get(def.color) || 0) + capacity);
      });
    }
    if (errors.length > 0) return { ok: false, errors };

    const blocksByColor = new Map();
    for (const row of level.grid) {
      for (const value of row) if (value !== emptyValue) blocksByColor.set(value, (blocksByColor.get(value) || 0) + 1);
    }
    const colors = [...new Set([...blocksByColor.keys(), ...capacityByColor.keys()])].sort((a, b) => a - b);
    for (const color of colors) {
      const blocks = blocksByColor.get(color) || 0;
      const capacity = capacityByColor.get(color) || 0;
      if (capacity > blocks) errors.push(`colour ${color}: unit capacity ${capacity} exceeds its ${blocks} block(s) by ${capacity - blocks}`);
      if (capacity < blocks) errors.push(`colour ${color}: unit capacity ${capacity} is ${blocks - capacity} short of its ${blocks} block(s)`);
    }
    return { ok: errors.length === 0, errors };
  }

  /**
   * Validate, load grid + inventory, build the track, enter PLAYING. Throws on an invalid level.
   * @param {{ id: string, grid: number[][], units: Array<{ color: number, capacity?: number }> }} level
   */
  loadLevel(level) {
    const { ok, errors } = GameManager.validateLevel(level, this.config);
    if (!ok) throw new Error(`GameManager.loadLevel(${level && level.id}): ${errors.join('; ')}`);
    this.level = level;
    this.grid.load(level.grid);
    this.inventory.load(level.units);
    this.track = new Track({ rows: this.grid.rows, cols: this.grid.cols, ...this.config.track, epsilon: this.config.timing.epsilon });

    const { fixedStep, launchDelay, eatDuration } = this.config.timing;
    this.#launchSteps = Math.round(launchDelay / fixedStep);
    this.#eatSteps = Math.round(eatDuration / fixedStep);
    this.stepCount = 0;
    this.#accumulator = 0;
    this.#pendingEvents = [];
    this.paused = false;
    this.#movesCache = { gridVersion: -1, inventoryVersion: -1, moves: [] };

    this.#setPhase(GamePhase.PLAYING);
    this.#emit(Events.LEVEL_LOADED, { snapshot: this.getSnapshot() });
  }

  /** Reload the current level from scratch (no command checks; see restartLevel). */
  reset() {
    if (this.level) this.loadLevel(this.level);
  }

  /** Real-time entry point: clamp, accumulate, run whole fixed steps. */
  update(dtSeconds) {
    if (!(dtSeconds > 0) || this.paused) return;
    const { fixedStep, maxFrameDt, epsilon } = this.config.timing;
    this.#accumulator += Math.min(dtSeconds, maxFrameDt);
    while (this.#accumulator >= fixedStep - epsilon) {
      this.step();
      this.#accumulator -= fixedStep;
    }
  }

  /**
   * Advance n fixed steps (no-op unless PLAYING). Per step: launch -> move/scan -> resolve win/lose,
   * then flush the events collected during the step. Returns the flushed events.
   * @returns {Array<{ type: string, payload: any }>}
   */
  step(n = 1) {
    if (this.#stepping) throw new Error('GameManager.step: re-entrant call from an event listener');
    const flushed = [];
    for (let i = 0; i < n && this.phase === GamePhase.PLAYING && !this.paused; i += 1) {
      this.#stepping = true;
      try {
        this.stepCount += 1;
        this.#launchUnits();
        this.#moveUnits();
        this.#resolvePhase();
      } finally {
        this.#stepping = false;
      }
      const events = this.#pendingEvents;
      this.#pendingEvents = [];
      for (const event of events) this.eventBus.emit(event.type, event.payload);
      flushed.push(...events);
    }
    return flushed;
  }

  /**
   * Player command: move a reserve unit into a free active slot; it launches after timing.launchDelay.
   * Never throws; a rejection emits LAUNCH_REJECTED with a RejectReason. The units behind it in its reserve column
   * move up one cell (RESERVE_SHIFTED).
   * @returns {{ ok: boolean, slotIndex?: number, reason?: string }}
   */
  activateUnit(unitId) {
    const check = this.canActivate(unitId);
    if (!check.ok) {
      this.#emit(Events.LAUNCH_REJECTED, { unitId, reason: check.reason });
      return check;
    }
    const result = this.inventory.activate(unitId);
    if (!result.ok) {
      this.#emit(Events.LAUNCH_REJECTED, { unitId, reason: result.reason });
      return { ok: false, reason: result.reason };
    }
    this.inventory.getUnit(unitId).timer = this.#launchSteps;
    this.#emit(Events.UNIT_ACTIVATED, { unitId, slotIndex: result.slotIndex });
    if (result.shifted.length > 0) {
      this.#emit(Events.RESERVE_SHIFTED, { column: result.shifted[0].from.col, moves: result.shifted });
    }
    return { ok: true, slotIndex: result.slotIndex };
  }

  /** Same checks as activateUnit without side effects. */
  canActivate(unitId) {
    if (this.phase !== GamePhase.PLAYING) return { ok: false, reason: RejectReason.NOT_PLAYING };
    if (this.paused) return { ok: false, reason: RejectReason.PAUSED };
    const unit = this.inventory.getUnit(unitId);
    if (!unit) return { ok: false, reason: RejectReason.UNKNOWN_UNIT };
    const reason = this.#activationBlocker(unit);
    return reason ? { ok: false, reason } : { ok: true };
  }

  /** Why `unit` cannot take a slot right now, ignoring phase and pause; null when it can. */
  #activationBlocker(unit) {
    if (unit.state !== UnitState.RESERVE) return RejectReason.NOT_IN_RESERVE;
    if (this.config.inventory.frontOnlyPick && !this.inventory.isFront(unit.id)) return RejectReason.NOT_FRONT;
    if (!this.inventory.hasFreeSlot()) return RejectReason.NO_FREE_SLOT;
    if (!this.config.rules.allowNoTargetActivation && this.grid.countRemaining(unit.color) === 0) return RejectReason.NO_TARGET;
    return null;
  }

  /**
   * Player command: send the unit parked in `slotIndex` back on the track (rules.allowRelaunchParked). It keeps its
   * capacity and its slot (OCCUPIED while it moves), launches after timing.launchDelay like a fresh activation, dies
   * and frees the slot at capacity 0, or parks in the same slot again after the lap. Never throws; a rejection emits
   * LAUNCH_REJECTED.
   * @returns {{ ok: boolean, unitId?: string, reason?: string }}
   */
  launchFromSlot(slotIndex) {
    const check = this.canLaunchFromSlot(slotIndex);
    if (!check.ok) {
      this.#emit(Events.LAUNCH_REJECTED, { slotIndex, reason: check.reason });
      return check;
    }
    const { unitId } = this.inventory.relaunch(slotIndex);
    const unit = this.inventory.getUnit(unitId);
    unit.timer = this.#launchSteps;
    this.#emit(Events.UNIT_RELAUNCHED, { unitId, slotIndex, capacity: unit.capacity });
    return { ok: true, unitId };
  }

  /** Same checks as launchFromSlot without side effects. */
  canLaunchFromSlot(slotIndex) {
    if (this.phase !== GamePhase.PLAYING) return { ok: false, reason: RejectReason.NOT_PLAYING };
    if (this.paused) return { ok: false, reason: RejectReason.PAUSED };
    if (!this.config.rules.allowRelaunchParked) return { ok: false, reason: RejectReason.RELAUNCH_DISABLED };
    const slot = this.inventory.getSlots()[slotIndex];
    if (!slot) return { ok: false, reason: RejectReason.UNKNOWN_SLOT };
    if (slot.status !== 'blocked') return { ok: false, reason: RejectReason.NOT_PARKED };
    return { ok: true };
  }


  /**
   * Freeze the simulation (settings panel). update() and step() do nothing and activateUnit is rejected
   * with PAUSED until resume() or the next loadLevel. Only a level in PLAYING can be paused.
   * @returns {{ ok: boolean, reason?: string }}
   */
  pause() {
    if (this.phase !== GamePhase.PLAYING) return { ok: false, reason: RejectReason.NOT_PLAYING };
    if (!this.paused) {
      this.paused = true;
      this.#accumulator = 0;
      this.#emit(Events.GAME_PAUSED, {});
    }
    return { ok: true };
  }

  /** Unfreeze the simulation. Idempotent. @returns {{ ok: boolean }} */
  resume() {
    if (this.paused) {
      this.paused = false;
      this.#emit(Events.GAME_RESUMED, {});
    }
    return { ok: true };
  }

  /**
   * Reload the current level from scratch (settings "Restart level", lose card "Retry"). Pays nothing and
   * keeps the level number; an unclaimed win is forfeited.
   * @returns {{ ok: boolean, reason?: string }}
   */
  restartLevel() {
    if (!this.level) return { ok: false, reason: RejectReason.NO_LEVEL };
    this.reset();
    return { ok: true };
  }

  /**
   * Win card "Continue": pay the level reward once, advance the progression and load the next level.
   * Only valid in WON; the phase leaves WON immediately, so a second call is rejected and pays nothing.
   * Throws (before paying) if the next level fails validateLevel.
   * @returns {{ ok: boolean, reason?: string, reward?: number, money?: number, levelNumber?: number }}
   */
  continueToNextLevel() {
    if (this.phase !== GamePhase.WON) return { ok: false, reason: RejectReason.NOT_WON };
    const next = this.progress.nextLevel();
    if (!next) return { ok: false, reason: RejectReason.NO_LEVELS };
    const check = GameManager.validateLevel(next, this.config);
    if (!check.ok) throw new Error(`GameManager.continueToNextLevel(${next.id}): ${check.errors.join('; ')}`);

    const paid = this.progress.completeLevel();
    if (!paid.ok) return { ok: false, reason: RejectReason.NOT_WON };
    this.#emit(Events.MONEY_CHANGED, { money: paid.money, delta: paid.reward, levelNumber: this.progress.levelNumber });
    const { level, levelNumber } = this.progress.advance();
    this.#emit(Events.LEVEL_ADVANCED, { levelNumber, levelId: level.id });
    this.loadLevel(level);
    return { ok: true, reward: paid.reward, money: paid.money, levelNumber };
  }

  /** Reserve unit ids whose activation would consume at least one block (Simulator dry run, memoised). */
  getValidMoves() {
    const cache = this.#movesCache;
    if (cache.gridVersion !== this.grid.version || cache.inventoryVersion !== this.inventory.version) {
      this.#movesCache = {
        gridVersion: this.grid.version,
        inventoryVersion: this.inventory.version,
        moves: this.track ? findValidMoves(this.getSnapshot(), this.config) : [],
      };
    }
    return this.#movesCache.moves.slice();
  }

  /** grid cleared && (!rules.winWaitsForRunners || no runners) */
  isWon() {
    if (!this.track || !this.grid.isCleared()) return false;
    return !this.config.rules.winWaitsForRunners || this.inventory.getRunners().length === 0;
  }

  /**
   * Deadlock: blocks remain, no unit is moving, no reserve unit can take a free slot, and no parked unit could eat
   * on a full lap (its colour is first on no lane; only counted when rules.allowRelaunchParked is on).
   */
  isLost() {
    return this.#loseReason() !== null;
  }

  #loseReason() {
    if (!this.track || this.grid.isCleared() || this.inventory.getRunners().length > 0) return null;
    if (this.inventory.getReserve().some((unit) => this.#activationBlocker(unit) === null)) return null;
    if (this.config.rules.allowRelaunchParked) {
      const exposed = new Set(this.grid.exposedColors());
      if (this.inventory.getParked().some((unit) => exposed.has(unit.color))) return null;
    }
    return this.inventory.hasFreeSlot() ? LoseReason.OUT_OF_UNITS : LoseReason.SLOTS_BLOCKED;
  }

  /**
   * Plain JSON snapshot in cell units. Renderer.sync(snapshot) must be able to draw the whole game
   * from this alone. grid is the manager's frozen, version-memoised state.
   */
  getSnapshot() {
    const track = this.track
      ? { length: this.track.length, entryT: this.track.entryT, margin: this.track.margin, direction: this.track.direction, corners: this.track.getCorners() }
      : null;
    const units = this.inventory.getAllUnits().map((unit) => {
      const onTrack = unit.state === UnitState.RUNNING || unit.state === UnitState.EATING;
      return {
        ...unit.toState(),
        pose: onTrack ? this.track.poseAt(unit.t) : null,
        progress: unit.initialCapacity > 0 ? (unit.initialCapacity - unit.capacity) / unit.initialCapacity : 0,
      };
    });
    const inventory = this.inventory.toState();
    return {
      phase: this.phase,
      stepCount: this.stepCount,
      paused: this.paused,
      /** Id of the loaded level; the renderer keys per-level presentation (Config.render.levels) on it. */
      levelId: this.level ? this.level.id : null,
      grid: this.grid.toState(),
      track,
      units,
      slots: inventory.slots,
      inventory: { reserveCols: inventory.reserveCols, reserveRows: inventory.reserveRows, version: inventory.version },
      progress: this.progress.getState(),
    };
  }

  // ---- step phases (private) ----

  #launchUnits() {
    for (const unit of this.inventory.getRunners()) {
      if (unit.state !== UnitState.ACTIVE) continue;
      unit.timer -= 1;
      if (unit.timer > 0 || this.#launchBlocked()) continue;
      unit.state = UnitState.RUNNING;
      unit.t = 0;
      unit.distanceTraveled = 0;
      unit.timer = 0;
      this.#emit(Events.UNIT_LAUNCHED, { unitId: unit.id, t: 0 });
    }
  }

  #launchBlocked() {
    const spacing = this.config.track.launchSpacing;
    if (!(spacing > 0)) return false;
    return this.inventory
      .getRunners()
      .some((unit) => (unit.state === UnitState.RUNNING || unit.state === UnitState.EATING) && unit.distanceTraveled < spacing);
  }

  #moveUnits() {
    const { fixedStep, epsilon } = this.config.timing;
    const dist = this.config.track.speed * fixedStep;
    const length = this.track.length;
    const perPass = this.config.rules.blocksPerLanePass;

    for (const unit of this.inventory.getRunners()) {
      if (unit.state === UnitState.EATING) {
        unit.timer -= 1;
        if (unit.timer > 0) continue;
        unit.state = UnitState.RUNNING;
        unit.timer = 0;
      }
      if (unit.state !== UnitState.RUNNING) continue;

      const remaining = length - unit.distanceTraveled;
      const completesLap = dist >= remaining - epsilon;
      const allowed = completesLap ? remaining : dist;
      const tFrom = unit.t;
      const tTo = tFrom + allowed;

      let stopped = false;
      for (const lane of this.track.lanesCrossed(tFrom, tTo)) {
        const max = Math.min(perPass, unit.capacity);
        const consumed = this.grid.consumeFromEdge(lane.side, lane.laneIndex, unit.color, { max });
        if (consumed.length === 0) continue;
        for (const cell of consumed) {
          unit.consume(1);
          this.#emit(Events.BLOCK_CONSUMED, {
            unitId: unit.id, row: cell.row, col: cell.col, color: cell.color,
            side: lane.side, laneIndex: lane.laneIndex, capacityLeft: unit.capacity,
          });
        }
        if (unit.capacity === 0) {
          this.#kill(unit);
          stopped = true;
          break;
        }
        if (this.#eatSteps > 0) {
          unit.t = lane.tCenter;
          unit.distanceTraveled = lane.tCenter;
          unit.state = UnitState.EATING;
          unit.timer = this.#eatSteps;
          stopped = true;
          break;
        }
      }
      if (stopped) continue;

      unit.t = tTo;
      unit.distanceTraveled = tTo;
      if (completesLap) {
        unit.t = length;
        unit.distanceTraveled = length;
        this.#return(unit);
      }
    }
  }

  #kill(unit) {
    const slotIndex = unit.slotIndex;
    unit.state = UnitState.DEAD;
    this.inventory.release(slotIndex);
    this.#emit(Events.UNIT_DIED, { unitId: unit.id, slotIndex });
    this.#emit(Events.SLOT_FREED, { slotIndex });
  }

  #return(unit) {
    const slotIndex = unit.slotIndex;
    unit.state = UnitState.RETURNED;
    this.inventory.block(slotIndex);
    this.#emit(Events.UNIT_RETURNED, { unitId: unit.id, slotIndex });
    this.#emit(Events.SLOT_BLOCKED, { slotIndex, unitId: unit.id });
  }

  #resolvePhase() {
    if (this.isWon()) {
      this.#setPhase(GamePhase.WON);
      this.#emit(Events.LEVEL_WON, { stepCount: this.stepCount });
      return;
    }
    const reason = this.#loseReason();
    if (reason) {
      this.#setPhase(GamePhase.LOST);
      this.#emit(Events.LEVEL_LOST, { reason });
    }
  }

  #setPhase(to) {
    const from = this.phase;
    if (from === to) return;
    this.phase = to;
    this.#emit(Events.PHASE_CHANGED, { from, to });
  }

  /** Inside a step events queue up and flush afterwards; commands emit immediately. */
  #emit(type, payload) {
    if (this.#stepping) this.#pendingEvents.push({ type, payload });
    else this.eventBus.emit(type, payload);
  }

}
