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
  /** { unitId, from: { col, row } } -- a reserve unit started its flight to the track entry (it takes no slot) */
  UNIT_ACTIVATED: 'unit:activated',
  /** { unitId, t } -- a launching unit reached the shared entry point and entered the track */
  UNIT_LAUNCHED: 'unit:launched',
  /** { unitId, row, col, color, side, laneIndex, capacityLeft } */
  BLOCK_CONSUMED: 'block:consumed',
  /** { unitId } -- capacity reached 0; the unit leaves play (and stops counting against the slot limit) */
  UNIT_DIED: 'unit:died',
  /** { unitId, slotIndex } -- lap completed with capacity > 0; parked in the leftmost free slot, which is blocked */
  UNIT_RETURNED: 'unit:returned',
  /** { slotIndex } -- a parked unit was relaunched and left its slot */
  SLOT_FREED: 'slot:freed',
  /** { slotIndex, unitId } */
  SLOT_BLOCKED: 'slot:blocked',
  /** { slotIndex, from, to, slots } -- any slot status change (free/blocked); `slots` is the new slot list */
  SLOT_STATE_CHANGED: 'slot:state-changed',
  /** { unitId?, slotIndex?, reason } -- activateUnit / launchFromSlot refused; see RejectReason */
  LAUNCH_REJECTED: 'launch:rejected',
  /** { column, moves: [{ unitId, from: { col, row }, to: { col, row } }] } -- units behind a departed unit moved up */
  RESERVE_SHIFTED: 'reserve:shifted',
  /** { unitId, slotIndex, capacity } -- a parked unit left its slot (now free) and flies back to the track entry */
  UNIT_RELAUNCHED: 'unit:relaunched',
  /** { stepCount, multiplier, rampMs } -- the reserve just emptied: moving units ramp up to rules.finalRushSpeedMultiplier (once per level) */
  FINAL_RUSH_STARTED: 'final-rush:started',
  /** {} -- simulation frozen by GameManager.pause(); LEVEL_LOADED also implies unpaused */
  GAME_PAUSED: 'game:paused',
  /** {} */
  GAME_RESUMED: 'game:resumed',
  /** { money, delta, levelNumber } -- the won level's reward was paid (GameManager.continueToNextLevel) */
  MONEY_CHANGED: 'money:changed',
  /** { levelNumber, levelId } -- progression moved to the next level; LEVEL_LOADED follows */
  LEVEL_ADVANCED: 'level:advanced',
  /** { stepCount } */
  LEVEL_WON: 'level:won',
  /** { reason } -- see LoseReason */
  LEVEL_LOST: 'level:lost',
});

/** Reasons a command is rejected: LAUNCH_REJECTED payload for activateUnit / launchFromSlot, `reason` in every command result. */
export const RejectReason = Object.freeze({
  NOT_PLAYING: 'not-playing',
  UNKNOWN_UNIT: 'unknown-unit',
  NOT_IN_RESERVE: 'not-in-reserve',
  /** activateUnit while units moving + units parked already equal inventory.activeSlots (the "N/5" counter is 0) */
  NO_FREE_SLOT: 'no-free-slot',
  NO_TARGET: 'no-target',
  /** activateUnit on a reserve unit that is not the front of its column (inventory.frontOnlyPick) */
  NOT_FRONT: 'not-front',
  /** launchFromSlot on a slot without a parked unit */
  NOT_PARKED: 'not-parked',
  /** launchFromSlot with an index outside the active slots */
  UNKNOWN_SLOT: 'unknown-slot',
  /** launchFromSlot while rules.allowRelaunchParked is off */
  RELAUNCH_DISABLED: 'relaunch-disabled',
  /** activateUnit / launchFromSlot while the simulation is paused */
  PAUSED: 'paused',
  /** continueToNextLevel before the level is won (or after the reward was taken) */
  NOT_WON: 'not-won',
  /** restartLevel before any level was loaded */
  NO_LEVEL: 'no-level',
  /** continueToNextLevel with an empty progression list */
  NO_LEVELS: 'no-levels',
});

/**
 * Reasons a level is lost (payload of LEVEL_LOST); see GameManager.isLost and Config.rules.loseMode.
 */
export const LoseReason = Object.freeze({
  /** all slots hold parked units and nothing moves (in 'deadlock' mode: and none of them could hit a block) */
  SLOTS_BLOCKED: 'slots_blocked',
  /** reserve empty, nothing moves, blocks remain, and no parked unit could hit a block */
  OUT_OF_UNITS: 'out_of_units',
});

/** Values of Config.rules.loseMode. */
export const LoseMode = Object.freeze({
  /** lose as soon as every slot is blocked and nothing moves, even if a parked unit could be relaunched */
  ALL_SLOTS_BLOCKED: 'allSlotsBlocked',
  /** in that state, lose only if no parked unit could hit a block on a lap */
  DEADLOCK: 'deadlock',
});
