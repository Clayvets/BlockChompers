import { Unit, UnitState } from './Unit.js';
import { RejectReason } from './Events.js';

/**
 * Available-slot counter ("N/5") from a unit list (e.g. snapshot.units): N = total - (units moving + units parked).
 * Moving units hold no slot but still count, so the counter drops on every launch.
 * @param {Array<{ state: string }>} units
 * @param {number} total Config.inventory.activeSlots (= snapshot.slots.length)
 * @returns {{ free: number, total: number }}
 */
export function countAvailableSlots(units, total) {
  const used = units.filter((u) => USED_STATES.has(u.state)).length;
  return { free: Math.max(0, total - used), total };
}

const USED_STATES = new Set([UnitState.LAUNCHING, UnitState.RUNNING, UnitState.EATING, UnitState.RETURNED]);

/**
 * Owns the unit registry, the 4xN reserve grid and the 5 parking slots.
 * Pure bookkeeping: it never decides WHEN something happens (GameManager does).
 *
 * Limit: a launch needs (moving + parked) < activeSlots. Moving units hold no slot.
 * Slot status: 'free' -> 'blocked' when a unit finishes a lap with capacity left and parks in the leftmost free slot;
 *              'blocked' -> 'free' when that unit is relaunched (it keeps counting as moving).
 * Reserve columns are queues: row 0 is the front; when a unit leaves, the units behind it move up one cell.
 * `version` is monotonic for the life of the manager (a reload never resets it) and bumps on every change that the
 * renderer may draw (launch, relaunch, park, death, reserve shift).
 */
export class InventoryManager {
  /** @type {Map<string, Unit>} insertion order = definition order */
  #units = new Map();
  /** @type {Array<{ index: number, status: 'free'|'blocked', unitId: string|null }>} */
  #slots = [];
  #unitCount = 0;
  #launchCounter = 0;

  constructor({ config }) {
    this.config = config;
    this.reserveCols = config.inventory.reserveCols;
    this.activeSlotCount = config.inventory.activeSlots;
    this.version = 0;
  }

  /** Rows the reserve currently spans: ceil(units / reserveCols). */
  get reserveRows() {
    return Math.ceil(this.#unitCount / this.reserveCols);
  }

  /**
   * Create Units from level definitions. Ids are stable ('u0', 'u1', ...); reserve positions are
   * row-major over `reserveCols`. Missing capacity falls back to units.defaultCapacity; anything
   * below units.minCapacity or a non-positive colour throws.
   * @param {Array<{ color: number, capacity?: number }>} unitDefs
   * @returns {Unit[]}
   */
  load(unitDefs) {
    if (!Array.isArray(unitDefs)) throw new TypeError('InventoryManager.load: unitDefs must be an array');
    const { defaultCapacity, minCapacity } = this.config.units;
    const units = new Map();
    unitDefs.forEach((def, i) => {
      const capacity = def.capacity === undefined ? defaultCapacity : def.capacity;
      if (!Number.isInteger(def.color) || def.color <= 0) throw new RangeError(`unit ${i}: color must be a positive integer`);
      if (!Number.isInteger(capacity) || capacity < minCapacity) {
        throw new RangeError(`unit ${i}: capacity must be an integer >= ${minCapacity}`);
      }
      const unit = new Unit({ id: `u${i}`, color: def.color, capacity, reservePos: this.#reservePosFor(i) });
      units.set(unit.id, unit);
    });
    this.#units = units;
    this.#unitCount = unitDefs.length;
    this.#launchCounter = 0;
    this.#slots = Array.from({ length: this.activeSlotCount }, (_, index) => ({ index, status: 'free', unitId: null }));
    this.version += 1;
    return this.getAllUnits();
  }

  #reservePosFor(i) {
    return { col: i % this.reserveCols, row: Math.floor(i / this.reserveCols) };
  }

  /** @returns {Unit | undefined} */
  getUnit(id) {
    return this.#units.get(id);
  }

  /** @returns {Unit[]} in definition order */
  getAllUnits() {
    return [...this.#units.values()];
  }

  /** Units still in the reserve (state RESERVE). */
  getReserve() {
    return this.getAllUnits().filter((unit) => unit.state === UnitState.RESERVE);
  }

  /** Moving units (LAUNCHING | RUNNING | EATING), in launch order. */
  getRunners() {
    return this.getAllUnits()
      .filter((unit) => unit.isRunner())
      .sort((a, b) => a.launchSeq - b.launchSeq);
  }

  /** @returns {Array<{ index: number, status: string, unitId: string|null }>} copies, not live objects */
  getSlots() {
    return this.#slots.map((slot) => ({ ...slot }));
  }

  /** Leftmost (lowest-index) free slot, or -1. */
  findFreeSlot() {
    const slot = this.#slots.find((s) => s.status === 'free');
    return slot ? slot.index : -1;
  }

  hasFreeSlot() {
    return this.findFreeSlot() !== -1;
  }

  /** Units counting against the limit: moving + parked. */
  inUse() {
    return this.getAllUnits().filter((unit) => USED_STATES.has(unit.state)).length;
  }

  /** activeSlots - (moving + parked): what the "N/5" counter shows. */
  available() {
    return Math.max(0, this.activeSlotCount - this.inUse());
  }

  /** True while another unit may launch: (moving + parked) < activeSlots. */
  hasRoom() {
    return this.inUse() < this.activeSlotCount;
  }

  /**
   * RESERVE -> LAUNCHING: the unit flies straight to the track entry and takes no slot. Needs room under the limit.
   * The units behind it in its column move up one cell. Never throws; `shifted` lists those moves, front to back.
   * @returns {{ ok: boolean, reason?: string, shifted?: Array<{ unitId: string, from: object, to: object }> }}
   */
  launch(unitId) {
    const unit = this.#units.get(unitId);
    if (!unit) return { ok: false, reason: RejectReason.UNKNOWN_UNIT };
    if (unit.state !== UnitState.RESERVE) return { ok: false, reason: RejectReason.NOT_IN_RESERVE };
    if (!this.hasRoom()) return { ok: false, reason: RejectReason.NO_FREE_SLOT };
    unit.state = UnitState.LAUNCHING;
    unit.launchOrigin = { kind: 'reserve', ...unit.reservePos };
    this.#launchCounter += 1;
    unit.launchSeq = this.#launchCounter;
    const shifted = this.#shiftColumnUp(unit.reservePos);
    this.version += 1;
    return { ok: true, shifted };
  }

  /** Reserve units behind a vacated cell (same column, larger row) move up one cell, front to back. */
  #shiftColumnUp({ col, row }) {
    const behind = this.getReserve()
      .filter((u) => u.reservePos.col === col && u.reservePos.row > row)
      .sort((a, b) => a.reservePos.row - b.reservePos.row);
    return behind.map((u) => {
      const from = { ...u.reservePos };
      u.reservePos = { col, row: from.row - 1 };
      return { unitId: u.id, from, to: { ...u.reservePos } };
    });
  }

  /** Reserve units at the front (row 0) of their column. */
  getFrontUnits() {
    return this.getReserve().filter((u) => u.reservePos.row === 0);
  }

  /** True for a reserve unit at the front of its column. */
  isFront(unitId) {
    const unit = this.#units.get(unitId);
    return Boolean(unit) && unit.state === UnitState.RESERVE && unit.reservePos.row === 0;
  }

  /** Units parked in a slot after a lap with capacity left (state RETURNED), by slot index. */
  getParked() {
    return this.getAllUnits()
      .filter((u) => u.state === UnitState.RETURNED)
      .sort((a, b) => a.slotIndex - b.slotIndex);
  }

  /**
   * A moving unit finished its lap with capacity left: RETURNED in the leftmost free slot, which becomes 'blocked'.
   * The limit guarantees a free slot (the unit was counted while moving); running out means a broken invariant.
   * @returns {number} the slot index
   */
  park(unitId) {
    const unit = this.#units.get(unitId);
    const slotIndex = this.findFreeSlot();
    if (!unit || slotIndex === -1) throw new Error(`InventoryManager.park(${unitId}): no free slot`);
    const slot = this.#slots[slotIndex];
    slot.status = 'blocked';
    slot.unitId = unitId;
    unit.state = UnitState.RETURNED;
    unit.slotIndex = slotIndex;
    this.version += 1;
    return slotIndex;
  }

  /**
   * Send the unit parked in `slotIndex` back out: RETURNED -> LAUNCHING, and the slot becomes 'free'. The unit keeps
   * its capacity and still counts against the limit while it moves. Never throws.
   * @returns {{ ok: boolean, unitId?: string, reason?: string }}
   */
  relaunch(slotIndex) {
    const slot = this.#slots[slotIndex];
    if (!slot) return { ok: false, reason: RejectReason.UNKNOWN_SLOT };
    const unit = slot.status === 'blocked' ? this.#units.get(slot.unitId) : undefined;
    if (!unit || unit.state !== UnitState.RETURNED) return { ok: false, reason: RejectReason.NOT_PARKED };
    slot.status = 'free';
    slot.unitId = null;
    unit.state = UnitState.LAUNCHING;
    unit.slotIndex = null;
    unit.launchOrigin = { kind: 'slot', index: slotIndex };
    this.#launchCounter += 1;
    unit.launchSeq = this.#launchCounter;
    this.version += 1;
    return { ok: true, unitId: unit.id };
  }

  /** Capacity reached 0: DEAD, which frees its place under the limit. */
  retire(unitId) {
    const unit = this.#units.get(unitId);
    if (!unit) return;
    unit.state = UnitState.DEAD;
    unit.speed = 0;
    this.version += 1;
  }

  allSlotsBlocked() {
    return this.#slots.length > 0 && this.#slots.every((slot) => slot.status === 'blocked');
  }

  hasReserve() {
    return this.getAllUnits().some((unit) => unit.state === UnitState.RESERVE);
  }

  /** @returns {{ reserveCols: number, reserveRows: number, slots: Array<object>, version: number, inUse: number, available: number }} */
  toState() {
    return {
      reserveCols: this.reserveCols,
      reserveRows: this.reserveRows,
      slots: this.getSlots(),
      version: this.version,
      inUse: this.inUse(),
      available: this.available(),
    };
  }
}
