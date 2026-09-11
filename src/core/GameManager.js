import { GridManager } from './GridManager.js';
import { InventoryManager } from './InventoryManager.js';
import { Track } from './Track.js';
import { UnitState } from './Unit.js';
import { Events, RejectReason, LoseReason } from './Events.js';
import { findValidMoves } from './Simulator.js';

export const GamePhase = Object.freeze({ IDLE: 'idle', PLAYING: 'playing', WON: 'won', LOST: 'lost' });

/**
 * Orchestrator. The ONLY class that mutates game state in response to time (step) or commands
 * (activateUnit). Emits domain events; exposes a plain snapshot.
 *
 *   commands in : activateUnit(unitId) -> { ok, reason }, never throws; its events emit at once
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
   * @param {{ config: object, eventBus: import('./EventBus.js').EventBus, grid?: GridManager, inventory?: InventoryManager }} deps
   */
  constructor({ config, eventBus, grid = new GridManager({ config }), inventory = new InventoryManager({ config }) }) {
    this.config = config;
    this.eventBus = eventBus;
    this.grid = grid;
    this.inventory = inventory;
    /** @type {Track | null} built in loadLevel from the grid's dimensions */
    this.track = null;
    this.phase = GamePhase.IDLE;
    this.level = null;
    this.stepCount = 0;
    /** Advisory notes from the last loadLevel (e.g. a grid colour with no unit). */
    this.levelWarnings = [];
  }

  /**
   * Validate, load grid + inventory, build the track, enter PLAYING. Throws on an invalid level.
   * @param {{ id: string, grid: number[][], units: Array<{ color: number, capacity?: number }> }} level
   */
  loadLevel(level) {
    if (!level || typeof level !== 'object') throw new TypeError('GameManager.loadLevel: level object required');
    const { ok, errors } = GridManager.validate(level.grid, { emptyValue: this.config.grid.emptyValue });
    if (!ok) throw new Error(`GameManager.loadLevel(${level.id}): ${errors.join('; ')}`);
    if (!Array.isArray(level.units) || level.units.length === 0) {
      throw new Error(`GameManager.loadLevel(${level.id}): units must be a non-empty array`);
    }
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
    this.#movesCache = { gridVersion: -1, inventoryVersion: -1, moves: [] };
    this.levelWarnings = this.#collectWarnings();

    this.#setPhase(GamePhase.PLAYING);
    this.#emit(Events.LEVEL_LOADED, { snapshot: this.getSnapshot() });
  }

  /** Reload the current level from scratch. */
  reset() {
    if (this.level) this.loadLevel(this.level);
  }

  /** Real-time entry point: clamp, accumulate, run whole fixed steps. */
  update(dtSeconds) {
    if (!(dtSeconds > 0)) return;
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
    for (let i = 0; i < n && this.phase === GamePhase.PLAYING; i += 1) {
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
   * Never throws; a rejection emits MOVE_REJECTED with a RejectReason.
   * @returns {{ ok: boolean, slotIndex?: number, reason?: string }}
   */
  activateUnit(unitId) {
    const check = this.canActivate(unitId);
    if (!check.ok) {
      this.#emit(Events.MOVE_REJECTED, { unitId, reason: check.reason });
      return check;
    }
    const result = this.inventory.activate(unitId);
    if (!result.ok) {
      this.#emit(Events.MOVE_REJECTED, { unitId, reason: result.reason });
      return { ok: false, reason: result.reason };
    }
    this.inventory.getUnit(unitId).timer = this.#launchSteps;
    this.#emit(Events.UNIT_ACTIVATED, { unitId, slotIndex: result.slotIndex });
    return { ok: true, slotIndex: result.slotIndex };
  }

  /** Same checks as activateUnit without side effects. */
  canActivate(unitId) {
    if (this.phase !== GamePhase.PLAYING) return { ok: false, reason: RejectReason.NOT_PLAYING };
    const unit = this.inventory.getUnit(unitId);
    if (!unit) return { ok: false, reason: RejectReason.UNKNOWN_UNIT };
    if (unit.state !== UnitState.RESERVE) return { ok: false, reason: RejectReason.NOT_IN_RESERVE };
    if (!this.inventory.hasFreeSlot()) return { ok: false, reason: RejectReason.NO_FREE_SLOT };
    if (!this.config.rules.allowNoTargetActivation && this.grid.countRemaining(unit.color) === 0) {
      return { ok: false, reason: RejectReason.NO_TARGET };
    }
    return { ok: true };
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

  /** no runners && blocks remain && (all slots blocked | reserve empty | nothing activatable | early dead end) */
  isLost() {
    return this.#loseReason() !== null;
  }

  #loseReason() {
    if (!this.track || this.grid.isCleared() || this.inventory.getRunners().length > 0) return null;
    if (!this.inventory.hasFreeSlot()) return LoseReason.ALL_SLOTS_BLOCKED;
    if (!this.inventory.hasReserve()) return LoseReason.RESERVE_EMPTY;
    if (!this.inventory.getReserve().some((unit) => this.canActivate(unit.id).ok)) return LoseReason.NO_VALID_MOVES;
    if (this.config.rules.detectDeadEndsEarly && this.getValidMoves().length === 0) return LoseReason.NO_VALID_MOVES;
    return null;
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
      grid: this.grid.toState(),
      track,
      units,
      slots: inventory.slots,
      inventory: { reserveCols: inventory.reserveCols, reserveRows: inventory.reserveRows, version: inventory.version },
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

  #collectWarnings() {
    const gridColors = new Set(this.grid.getColors());
    const unitColors = new Set(this.inventory.getAllUnits().map((unit) => unit.color));
    const warnings = [];
    for (const color of gridColors) if (!unitColors.has(color)) warnings.push(`colour ${color} has blocks but no unit`);
    for (const color of unitColors) if (!gridColors.has(color)) warnings.push(`unit colour ${color} has no blocks`);
    return warnings;
  }
}
