import { describe, it, expect } from 'vitest';
import { InventoryManager, countAvailableSlots } from '../../src/core/InventoryManager.js';
import { Config } from '../../src/config/Config.js';
import { UnitState } from '../../src/core/Unit.js';
import { RejectReason } from '../../src/core/Events.js';

const defs = (n, color = 1, capacity = 1) => Array.from({ length: n }, () => ({ color, capacity }));
const make = (units, config = Config) => {
  const inv = new InventoryManager({ config });
  inv.load(units);
  return inv;
};
const statuses = (inv) => inv.getSlots().map((s) => s.status);

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
      expect(inv.findFreeSlot()).toBe(0);
      expect([inv.inUse(), inv.available(), inv.hasRoom()]).toEqual([0, 5, true]);
    });
  });

  describe('launch', () => {
    it('moves a RESERVE unit to LAUNCHING without taking a slot and records where it left from', () => {
      const inv = make(defs(3));
      expect(inv.launch('u1')).toEqual({ ok: true, shifted: [] });
      expect(inv.launch('u0')).toEqual({ ok: true, shifted: [] });
      expect(inv.getUnit('u1')).toMatchObject({
        state: UnitState.LAUNCHING, slotIndex: null, launchSeq: 1, launchOrigin: { kind: 'reserve', col: 1, row: 0 },
      });
      expect(inv.getUnit('u0').launchSeq).toBe(2);
      expect(statuses(inv)).toEqual(Array(5).fill('free'));
      expect([inv.inUse(), inv.available()]).toEqual([2, 3]);
      expect(inv.getReserve().map((u) => u.id)).toEqual(['u2']);
      expect(inv.version).toBe(3);
    });

    it('refuses a launch once moving + parked units reach activeSlots, even with every slot free', () => {
      const inv = make(defs(7));
      for (let i = 0; i < 5; i += 1) expect(inv.launch(`u${i}`).ok).toBe(true);
      expect(inv.launch('u5')).toEqual({ ok: false, reason: RejectReason.NO_FREE_SLOT });
      expect([inv.hasRoom(), inv.hasFreeSlot()]).toEqual([false, true]); // moving units hold no slot
      inv.park('u0'); // parked still counts
      expect(inv.launch('u5').ok).toBe(false);
      inv.retire('u1'); // a death makes room
      expect(inv.launch('u5')).toMatchObject({ ok: true });
      expect(inv.launch('u6').reason).toBe(RejectReason.NO_FREE_SLOT);
    });

    it('fails without throwing for unknown units or units that are not in the reserve', () => {
      const inv = make(defs(2));
      expect(inv.launch('zz')).toEqual({ ok: false, reason: RejectReason.UNKNOWN_UNIT });
      inv.launch('u0');
      expect(inv.launch('u0')).toEqual({ ok: false, reason: RejectReason.NOT_IN_RESERVE });
    });

    it('moves the units behind a departed unit up one cell in its column only', () => {
      const inv = make(defs(10)); // col 0 = u0, u4, u8; col 1 = u1, u5, u9; cols 2-3 = u2, u6 / u3, u7
      expect(inv.launch('u0').shifted).toEqual([
        { unitId: 'u4', from: { col: 0, row: 1 }, to: { col: 0, row: 0 } },
        { unitId: 'u8', from: { col: 0, row: 2 }, to: { col: 0, row: 1 } },
      ]);
      expect(inv.getUnit('u5').reservePos).toEqual({ col: 1, row: 1 });
      expect(inv.getFrontUnits().map((u) => u.id)).toEqual(['u1', 'u2', 'u3', 'u4']);
      expect([inv.isFront('u4'), inv.isFront('u8'), inv.isFront('u0')]).toEqual([true, false, false]);
      expect(inv.launch('u3').shifted).toEqual([{ unitId: 'u7', from: { col: 3, row: 1 }, to: { col: 3, row: 0 } }]);
    });
  });

  describe('park / relaunch / retire', () => {
    it('parks a finished unit in the leftmost FREE slot and blocks it', () => {
      const inv = make(defs(4));
      ['u0', 'u1', 'u2'].forEach((id) => inv.launch(id));
      expect(inv.park('u1')).toBe(0);
      expect(inv.park('u0')).toBe(1);
      expect(inv.getUnit('u1')).toMatchObject({ state: UnitState.RETURNED, slotIndex: 0 });
      expect(inv.getSlots()[0]).toEqual({ index: 0, status: 'blocked', unitId: 'u1' });
      expect(inv.relaunch(0)).toEqual({ ok: true, unitId: 'u1' }); // slot 0 is free again
      expect(inv.park('u2')).toBe(0); // leftmost free, not slot 2
      expect(statuses(inv)).toEqual(['blocked', 'blocked', 'free', 'free', 'free']);
    });

    it('relaunch frees the slot, and the unit keeps counting while it moves', () => {
      const inv = make(defs(2));
      inv.launch('u0');
      expect(inv.relaunch(0)).toEqual({ ok: false, reason: RejectReason.NOT_PARKED }); // free slot: nothing parked
      inv.park('u0');
      expect(inv.getParked().map((u) => u.id)).toEqual(['u0']);
      const before = inv.inUse();
      expect(inv.relaunch(0)).toEqual({ ok: true, unitId: 'u0' });
      expect(inv.getSlots()[0]).toEqual({ index: 0, status: 'free', unitId: null });
      expect(inv.getUnit('u0')).toMatchObject({
        state: UnitState.LAUNCHING, slotIndex: null, launchSeq: 2, launchOrigin: { kind: 'slot', index: 0 },
      });
      expect(inv.inUse()).toBe(before);
      expect(inv.relaunch(1)).toEqual({ ok: false, reason: RejectReason.NOT_PARKED });
      expect(inv.relaunch(9)).toEqual({ ok: false, reason: RejectReason.UNKNOWN_SLOT });
    });

    it('park throws when no slot is free (the launch limit makes that impossible in play)', () => {
      const inv = make(defs(6));
      for (let i = 0; i < 5; i += 1) inv.launch(`u${i}`);
      for (let i = 0; i < 5; i += 1) inv.park(`u${i}`);
      inv.getUnit('u5').state = UnitState.RUNNING; // bypass the limit on purpose
      expect(() => inv.park('u5')).toThrow(/no free slot/);
    });

    it('retire marks the unit DEAD and gives its place back', () => {
      const inv = make(defs(2));
      inv.launch('u0');
      const version = inv.version;
      inv.retire('u0');
      expect(inv.getUnit('u0').state).toBe(UnitState.DEAD);
      expect([inv.inUse(), inv.available()]).toEqual([0, 5]);
      expect(inv.version).toBe(version + 1);
      inv.retire('nope'); // ignored
    });

    it('allSlotsBlocked is true only when every slot is blocked', () => {
      const inv = make(defs(5));
      for (let i = 0; i < 5; i += 1) inv.launch(`u${i}`);
      for (let i = 0; i < 4; i += 1) inv.park(`u${i}`);
      expect(inv.allSlotsBlocked()).toBe(false);
      inv.park('u4');
      expect(inv.allSlotsBlocked()).toBe(true);
    });
  });

  describe('queries', () => {
    it('getRunners returns LAUNCHING, RUNNING and EATING units only, in launch order', () => {
      const inv = make(defs(6));
      for (let i = 0; i < 5; i += 1) inv.launch(`u${i}`); // launchSeq 1..5
      inv.getUnit('u0').state = UnitState.EATING;
      inv.park('u1');
      inv.getUnit('u2').state = UnitState.RUNNING;
      inv.retire('u3');
      expect(inv.getRunners().map((u) => u.id)).toEqual(['u0', 'u2', 'u4']);
      inv.relaunch(0); // u1 goes out again and joins the back of the order
      expect(inv.getRunners().map((u) => u.id)).toEqual(['u0', 'u2', 'u4', 'u1']);
    });

    it('counts available slots as activeSlots - (moving + parked)', () => {
      const units = (...states) => states.map((state) => ({ state }));
      expect(countAvailableSlots(units('reserve', 'reserve'), 5)).toEqual({ free: 5, total: 5 });
      expect(countAvailableSlots(units('launching', 'running', 'eating', 'reserve'), 5)).toEqual({ free: 2, total: 5 });
      expect(countAvailableSlots(units('returned', 'returned', 'dead', 'running'), 5)).toEqual({ free: 2, total: 5 });
      expect(countAvailableSlots(units(...Array(5).fill('returned')), 5)).toEqual({ free: 0, total: 5 });
      const inv = make(defs(3));
      inv.launch('u0');
      inv.park('u0');
      inv.launch('u1');
      expect(countAvailableSlots(inv.getAllUnits(), 5).free).toBe(inv.available());
      expect(inv.toState()).toMatchObject({ inUse: 2, available: 3 });
    });

    it('hasReserve is false once every unit has left the reserve', () => {
      const inv = make(defs(2));
      expect(inv.hasReserve()).toBe(true);
      inv.launch('u0');
      inv.launch('u1');
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
