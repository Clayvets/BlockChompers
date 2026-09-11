/**
 * Domain event catalogue. GameManager collects events during a step and flushes them on the
 * EventBus AFTER the step completes, so no listener can re-enter a tick.
 *
 * Events are presentation garnish: Renderer.sync(snapshot) must produce a correct picture even
 * if every event is ignored. Continuous unit motion is therefore NOT an event -- it is state.
 */
export const Events = Object.freeze({
  /** { snapshot } */
  LEVEL_LOADED: 'level:loaded',
  /** { from, to } -- GamePhase values */
  PHASE_CHANGED: 'phase:changed',
  /** { unitId, slotIndex } -- reserve unit moved into an active slot */
  UNIT_ACTIVATED: 'unit:activated',
  /** { unitId, t } -- unit left its slot and entered the track at the shared entry point */
  UNIT_LAUNCHED: 'unit:launched',
  /** { unitId, row, col, color, side, laneIndex, capacityLeft } */
  BLOCK_CONSUMED: 'block:consumed',
  /** { unitId, slotIndex } -- capacity reached 0; the slot is freed */
  UNIT_DIED: 'unit:died',
  /** { unitId, slotIndex } -- lap completed with capacity > 0; the slot is blocked */
  UNIT_RETURNED: 'unit:returned',
  /** { slotIndex } */
  SLOT_FREED: 'slot:freed',
  /** { slotIndex, unitId } */
  SLOT_BLOCKED: 'slot:blocked',
  /** { unitId, reason } -- see RejectReason */
  MOVE_REJECTED: 'move:rejected',
  /** { stepCount } */
  LEVEL_WON: 'level:won',
  /** { reason } -- see LoseReason */
  LEVEL_LOST: 'level:lost',
});

/** Reasons a command can be rejected (payload of MOVE_REJECTED / return of canActivate). */
export const RejectReason = Object.freeze({
  NOT_PLAYING: 'not-playing',
  UNKNOWN_UNIT: 'unknown-unit',
  NOT_IN_RESERVE: 'not-in-reserve',
  NO_FREE_SLOT: 'no-free-slot',
  NO_TARGET: 'no-target',
});

/** Reasons a level is lost (payload of LEVEL_LOST). */
export const LoseReason = Object.freeze({
  ALL_SLOTS_BLOCKED: 'all-slots-blocked',
  RESERVE_EMPTY: 'reserve-empty',
  NO_VALID_MOVES: 'no-valid-moves',
});
