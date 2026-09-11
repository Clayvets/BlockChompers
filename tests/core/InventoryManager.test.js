import { describe, it, expect } from 'vitest';
import { InventoryManager } from '../../src/core/InventoryManager.js';
import { Config } from '../../src/config/Config.js';
import { UnitState } from '../../src/core/Unit.js';
import { RejectReason } from '../../src/core/Events.js';

const defs = (n, color = 1, capacity = 1) => Array.from({ length: n }, () => ({ color, capacity }));
const make = (units, config = Config) => {
  const inv = new InventoryManager({ config });
  inv.load(units);
  return inv;
};

describe('InventoryManager', () => {
  describe('load', () => {
    it('assigns stable ids u0, u1, ... in definition order', () => {
      const inv = make(defs(3));
      expect(inv.getAllUnits().map((u) => u.id)).toEqual(['u0', 'u1', 'u2']);
      expect(inv.getUnit('u1').color).toBe(1);
      expect(inv.getUnit('nope')).toBeUndefined();
    });

    it('lays units out row-major into reserveCols columns', () => {
      const inv = make(defs(6));
      expect(inv.getUnit('u0').reservePos).toEqual({ col: 0, row: 0 });
      expect(inv.getUnit('u3').reservePos).toEqual({ col: 3, row: 0 });
      expect(inv.getUnit('u4').reservePos).toEqual({ col: 0, row: 1 });
      expect(inv.getUnit('u5').reservePos).toEqual({ col: 1, row: 1 });
      expect(inv.reserveRows).toBe(2);
      expect(inv.toState().reserveRows).toBe(2);
    });

    it('defaults capacity to Config.units.defaultCapacity and rejects bad definitions', () => {
      expect(make([{ color: 2 }]).getUnit('u0').capacity).toBe(Config.units.defaultCapacity);
      expect(() => make([{ color: 1, capacity: 0 }])).toThrow(RangeError);
      expect(() => make([{ color: 0, capacity: 1 }])).toThrow(RangeError);
      expect(() => new InventoryManager({ config: Config }).load('nope')).toThrow(TypeError);
    });

    it('creates exactly Config.inventory.activeSlots free slots and bumps version', () => {
      const inv = new InventoryManager({ config: Config });
      expect(inv.version).toBe(0);
      inv.load(defs(2));
      expect(inv.version).toBe(1);
      expect(inv.getSlots()).toEqual([0, 1, 2, 3, 4].map((index) => ({ index, status: 'free', unitId: null })));
      expect(inv.hasFreeSlot()).toBe(true);
      expect(inv.findFreeSlot()).toBe(0);
    });
  });

  describe('activate', () => {
    it('moves a RESERVE unit to ACTIVE, occupies the lowest free slot and records slotIndex', () => {
      const inv = make(defs(3));
      expect(inv.activate('u1')).toEqual({ ok: true, slotIndex: 0, shifted: [] });
      expect(inv.activate('u0')).toEqual({ ok: true, slotIndex: 1, shifted: [] });
      expect(inv.getUnit('u1')).toMatchObject({ state: UnitState.ACTIVE, slotIndex: 0 });
      expect(inv.getSlots()[0]).toEqual({ index: 0, status: 'occupied', unitId: 'u1' });
      expect(inv.getReserve().map((u) => u.id)).toEqual(['u2']);
      expect(inv.version).toBe(3);
    });

    it('fails without throwing when no slot is free', () => {
      const inv = make(defs(6));
      for (let i = 0; i < 5; i += 1) expect(inv.activate(`u${i}`).ok).toBe(true);
      expect(inv.activate('u5')).toEqual({ ok: false, slotIndex: -1, reason: RejectReason.NO_FREE_SLOT });
      expect(inv.hasFreeSlot()).toBe(false);
    });

    it('fails without throwing for unknown units or units that are not in the reserve', () => {
      const inv = make(defs(2));
      expect(inv.activate('zz')).toEqual({ ok: false, slotIndex: -1, reason: RejectReason.UNKNOWN_UNIT });
      inv.activate('u0');
      expect(inv.activate('u0')).toEqual({ ok: false, slotIndex: -1, reason: RejectReason.NOT_IN_RESERVE });
    });

    it('moves the units behind a departed unit up one cell in its column only', () => {
      const inv = make(defs(10)); // col 0 = u0, u4, u8; col 1 = u1, u5, u9; cols 2-3 = u2, u6 / u3, u7
      expect(inv.activate('u0').shifted).toEqual([
        { unitId: 'u4', from: { col: 0, row: 1 }, to: { col: 0, row: 0 } },
        { unitId: 'u8', from: { col: 0, row: 2 }, to: { col: 0, row: 1 } },
      ]);
      expect(inv.getUnit('u5').reservePos).toEqual({ col: 1, row: 1 });
      expect(inv.getFrontUnits().map((u) => u.id)).toEqual(['u1', 'u2', 'u3', 'u4']);
      expect([inv.isFront('u4'), inv.isFront('u8'), inv.isFront('u0')]).toEqual([true, false, false]);
      expect(inv.activate('u3').shifted).toEqual([{ unitId: 'u7', from: { col: 3, row: 1 }, to: { col: 3, row: 0 } }]);
    });

    it('relaunch turns a parked unit back to ACTIVE and its slot back to occupied', () => {
      const inv = make(defs(2));
      inv.activate('u0');
      expect(inv.relaunch(0)).toEqual({ ok: false, reason: RejectReason.NOT_PARKED }); // occupied, not parked
      inv.getUnit('u0').state = UnitState.RETURNED;
      inv.block(0);
      expect(inv.getParked().map((u) => u.id)).toEqual(['u0']);
      expect(inv.relaunch(0)).toEqual({ ok: true, unitId: 'u0' });
      expect(inv.getSlots()[0]).toEqual({ index: 0, status: 'occupied', unitId: 'u0' });
      expect(inv.getUnit('u0')).toMatchObject({ state: UnitState.ACTIVE, slotIndex: 0 });
      expect(inv.relaunch(1)).toEqual({ ok: false, reason: RejectReason.NOT_PARKED }); // free
      expect(inv.relaunch(9)).toEqual({ ok: false, reason: RejectReason.UNKNOWN_SLOT });
    });
  });

  describe('release / block', () => {
    it('release frees the slot and clears its unitId', () => {
      const inv = make(defs(2));
      inv.activate('u0');
      inv.release(0);
      expect(inv.getSlots()[0]).toEqual({ index: 0, status: 'free', unitId: null });
      expect(inv.findFreeSlot()).toBe(0);
    });

    it('block marks the slot blocked and keeps the unitId; out-of-range indices are ignored', () => {
      const inv = make(defs(2));
      inv.activate('u0');
      inv.block(0);
      expect(inv.getSlots()[0]).toEqual({ index: 0, status: 'blocked', unitId: 'u0' });
      expect(inv.findFreeSlot()).toBe(1);
      inv.release(99);
      inv.block(99);
      expect(inv.getSlots()).toHaveLength(5);
    });

    it('allSlotsBlocked is true only when every slot is blocked', () => {
      const inv = make(defs(5));
      for (let i = 0; i < 5; i += 1) inv.activate(`u${i}`);
      for (let i = 0; i < 4; i += 1) inv.block(i);
      expect(inv.allSlotsBlocked()).toBe(false);
      inv.block(4);
      expect(inv.allSlotsBlocked()).toBe(true);
    });
  });

  describe('queries', () => {
    it('getRunners returns ACTIVE, RUNNING and EATING units only, sorted by slot', () => {
      const inv = make(defs(5));
      for (let i = 0; i < 5; i += 1) inv.activate(`u${i}`); // slots 0..4
      inv.getUnit('u0').state = UnitState.EATING;
      inv.getUnit('u1').state = UnitState.RETURNED;
      inv.getUnit('u2').state = UnitState.RUNNING;
      inv.getUnit('u3').state = UnitState.DEAD;
      inv.getUnit('u4').state = UnitState.ACTIVE;
      inv.getUnit('u4').slotIndex = 0; // swap slots to prove the sort is by slot, not by id
      inv.getUnit('u0').slotIndex = 4;
      expect(inv.getRunners().map((u) => u.id)).toEqual(['u4', 'u2', 'u0']);
    });

    it('hasReserve is false once every unit has left the reserve', () => {
      const inv = make(defs(2));
      expect(inv.hasReserve()).toBe(true);
      inv.activate('u0');
      inv.activate('u1');
      expect(inv.hasReserve()).toBe(false);
    });

    it('toState and getSlots return plain copies', () => {
      const inv = make(defs(1));
      const state = inv.toState();
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      state.slots[0].status = 'blocked';
      expect(inv.getSlots()[0].status).toBe('free');
    });
  });
});
