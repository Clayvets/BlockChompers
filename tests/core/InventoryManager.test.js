import { describe, it } from 'vitest';
import { InventoryManager } from '../../src/core/InventoryManager.js';
import { Config } from '../../src/config/Config.js';

describe('InventoryManager', () => {
  describe('load', () => {
    it.todo('assigns stable ids u0, u1, ... in definition order');
    it.todo('lays units out row-major into reserveCols columns');
    it.todo('defaults capacity to Config.units.defaultCapacity');
    it.todo('creates exactly Config.inventory.activeSlots free slots');
  });

  describe('activate', () => {
    it.todo('moves a RESERVE unit to ACTIVE and occupies the lowest free slot');
    it.todo('records slotIndex on the unit');
    it.todo('fails without throwing when no slot is free');
    it.todo('fails without throwing for a unit that is not in the reserve');
  });

  describe('release / block', () => {
    it.todo('release frees the slot and clears its unitId');
    it.todo('block marks the slot blocked and keeps the unitId');
    it.todo('allSlotsBlocked is true only when every slot is blocked');
  });

  describe('queries', () => {
    it.todo('getRunners returns ACTIVE, RUNNING and EATING units only');
    it.todo('hasReserve is false once every unit has left the reserve');
    it.todo('toState is plain JSON and includes reserveRows');
  });
});
