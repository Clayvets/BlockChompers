import { Unit, UnitState } from './Unit.js';
import { RejectReason } from './Events.js';

/**
 * Owns the unit registry, the 4xN reserve grid and the 5 active slots.
 * Pure bookkeeping: it never decides WHEN something happens (GameManager does).
 *
 * Slot status: 'free' -> 'occupied' (unit activated) -> 'free' (unit died) | 'blocked' (unit parked).
 *              'blocked' -> 'occupied' again when the parked unit is relaunched from its slot.
 * Reserve columns are queues: row 0 is the front; when a unit leaves, the units behind it move up one cell.
 * `version` is monotonic for the life of the manager (a reload never resets it).
 */
export class InventoryManager {
  /** @type {Map<string, Unit>} insertion order = definition order */
  #units = new Map();
  /** @type {Array<{ index: number, status: 'free'|'occupied'|'blocked', unitId: string|null }>} */
  #slots = [];
  #unitCount = 0;

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

  /** Units occupying a slot and in motion or about to be (ACTIVE | RUNNING | EATING), sorted by slot index. */
  getRunners() {
    return this.getAllUnits()
      .filter((unit) => unit.isRunner())
      .sort((a, b) => a.slotIndex - b.slotIndex);
  }

  /** @returns {Array<{ index: number, status: string, unitId: string|null }>} copies, not live objects */
  getSlots() {
    return this.#slots.map((slot) => ({ ...slot }));
  }

  /** Lowest free slot index, or -1. */
  findFreeSlot() {
    const slot = this.#slots.find((s) => s.status === 'free');
    return slot ? slot.index : -1;
  }

  hasFreeSlot() {
    return this.findFreeSlot() !== -1;
  }

  /**
   * RESERVE -> ACTIVE and occupy the lowest free slot; the units behind it in its column move up one cell.
   * Never throws. `shifted` lists those moves, front to back.
   * @returns {{ ok: boolean, slotIndex: number, reason?: string, shifted?: Array<{ unitId: string, from: object, to: object }> }}
   */
  activate(unitId) {
    const unit = this.#units.get(unitId);
    if (!unit) return { ok: false, slotIndex: -1, reason: RejectReason.UNKNOWN_UNIT };
    if (unit.state !== UnitState.RESERVE) return { ok: false, slotIndex: -1, reason: RejectReason.NOT_IN_RESERVE };
    const slotIndex = this.findFreeSlot();
    if (slotIndex === -1) return { ok: false, slotIndex: -1, reason: RejectReason.NO_FREE_SLOT };

    const slot = this.#slots[slotIndex];
    slot.status = 'occupied';
    slot.unitId = unitId;
    unit.state = UnitState.ACTIVE;
    unit.slotIndex = slotIndex;
    const shifted = this.#shiftColumnUp(unit.reservePos);
    this.version += 1;
    return { ok: true, slotIndex, shifted };
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
   * Put the unit parked in `slotIndex` back on duty: slot 'blocked' -> 'occupied', unit RETURNED -> ACTIVE. It keeps
   * its capacity and its slot. Never throws.
   * @returns {{ ok: boolean, unitId?: string, reason?: string }}
   */
  relaunch(slotIndex) {
    const slot = this.#slots[slotIndex];
    if (!slot) return { ok: false, reason: RejectReason.UNKNOWN_SLOT };
    const unit = slot.status === 'blocked' ? this.#units.get(slot.unitId) : undefined;
    if (!unit || unit.state !== UnitState.RETURNED) return { ok: false, reason: RejectReason.NOT_PARKED };
    slot.status = 'occupied';
    unit.state = UnitState.ACTIVE;
    this.version += 1;
    return { ok: true, unitId: unit.id };
  }

  /** Unit died: the slot becomes free again. */
  release(slotIndex) {
    const slot = this.#slots[slotIndex];
    if (!slot) return;
    slot.status = 'free';
    slot.unitId = null;
    this.version += 1;
  }

  /** Unit returned with capacity left: the slot is blocked for the rest of the level (unitId kept). */
  block(slotIndex) {
    const slot = this.#slots[slotIndex];
    if (!slot) return;
    slot.status = 'blocked';
    this.version += 1;
  }

  allSlotsBlocked() {
    return this.#slots.length > 0 && this.#slots.every((slot) => slot.status === 'blocked');
  }

  hasReserve() {
    return this.getAllUnits().some((unit) => unit.state === UnitState.RESERVE);
  }

  /** @returns {{ reserveCols: number, reserveRows: number, slots: Array<object>, version: number }} */
  toState() {
    return { reserveCols: this.reserveCols, reserveRows: this.reserveRows, slots: this.getSlots(), version: this.version };
  }
}
