import { Unit, UnitState } from './Unit.js';
import { RejectReason } from './Events.js';

/**
 * Owns the unit registry, the 4xN reserve grid and the 5 active slots.
 * Pure bookkeeping: it never decides WHEN something happens (GameManager does).
 *
 * Slot status: 'free' -> 'occupied' (unit activated) -> 'free' (unit died) | 'blocked' (unit returned, permanent).
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
   * RESERVE -> ACTIVE and occupy the lowest free slot. Never throws.
   * @returns {{ ok: boolean, slotIndex: number, reason?: string }}
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
    if (this.config.inventory.compactReserve) this.#compact();
    this.version += 1;
    return { ok: true, slotIndex };
  }

  /** Re-lay the remaining reserve units row-major from the front (inventory.compactReserve). */
  #compact() {
    this.getReserve().forEach((unit, i) => {
      unit.reservePos = this.#reservePosFor(i);
    });
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
