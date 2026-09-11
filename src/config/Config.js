/**
 * Central, frozen game configuration.
 *
 * Sections read by the pure logic layer (src/core): grid, track, units, inventory, rules, timing, progression.
 * Sections read by the presentation layer only (src/render, src/ui): render, ui, debug.
 * Core code must never read `render`.
 *
 * Units of measure: distances are CELL UNITS (one grid cell = 1); durations are SECONDS;
 * speeds are cells per second. Pixels/world units only appear in `render`.
 */
export const Config = Object.freeze({
  grid: Object.freeze({
    /** Matrix value that means "no block". */
    emptyValue: 0,
    /** Logical colour ids -> human labels. Hex colours live in render.palette. */
    colors: Object.freeze({ 1: 'A', 2: 'B' }),
  }),

  track: Object.freeze({
    /** Cells between the grid edge and the track lane. */
    margin: 1,
    /** Track rejects a smaller margin (0 would overlap the grid). */
    minMargin: 1,
    /** 'cw' | 'ccw' (top-down view). Only Track interprets this. */
    direction: 'cw',
    /** Unit travel speed, cells per second. */
    speed: 4,
    /** Shared entry corner for every activated unit; a lap runs from here back to here. */
    entry: Object.freeze({ corner: 'SW' }),
    /**
     * Minimum distance (cells) between runners, along the track only: a launch waits until the previous runner is this
     * far ahead, and a runner never closes in on the unit ahead beyond it (it waits while that unit eats). Keep it at
     * least render.unitSize so meshes never overlap. 0 = pass-through (units may overlap on the path).
     */
    launchSpacing: 1,
  }),

  units: Object.freeze({
    /** Used when a level's unit definition omits capacity. */
    defaultCapacity: 5,
    /** Levels with a smaller capacity are rejected (such a unit could only block a slot). */
    minCapacity: 1,
  }),

  inventory: Object.freeze({
    /** Reserve grid width; rows are derived from the level's unit count. */
    reserveCols: 4,
    /** Strict limit of the active playing zone. */
    activeSlots: 5,
    /**
     * Only the front row of each reserve column can be launched: core rejects other picks with NOT_FRONT and the
     * renderer does not raycast them. When a unit leaves, the units behind it in its column move up one cell.
     */
    frontOnlyPick: true,
  }),

  rules: Object.freeze({
    /** Blocks a unit may eat from ONE lane during ONE pass. Infinity = chain inward until blocked. */
    blocksPerLanePass: 1,
    /** If true, a cleared grid only counts as a win once every runner has died or returned. */
    winWaitsForRunners: false,
    /** Allow activating a unit whose colour has no remaining blocks (a guaranteed slot block). */
    allowNoTargetActivation: true,
    /** A parked unit (lap finished with capacity left) can go back on the track from its slot: launchFromSlot(). */
    allowRelaunchParked: true,
    /**
     * 'allSlotsBlocked': LOSE (slots_blocked) as soon as every slot is blocked and nothing moves, even if a parked unit
     * could still be relaunched. 'deadlock': in that state, LOSE only if no parked unit could hit a block on a lap.
     * Both modes also lose with out_of_units (reserve empty, nothing moving, blocks left, no parked unit can hit).
     */
    loseMode: 'allSlotsBlocked',
  }),

  timing: Object.freeze({
    /** Logic step length; update(dt) accumulates real time and runs whole steps. */
    fixedStep: 1 / 60,
    /** Clamp for a single frame's dt (hidden-tab catch-up guard). */
    maxFrameDt: 0.1,
    /** Delay between activation (unit in slot) and launch onto the track. */
    launchDelay: 0.25,
    /** Pause on the track per consumed block. 0 = instant. */
    eatDuration: 0.15,
    /** Presentation-side tween time for a returning unit (logic marks RETURNED immediately). */
    returnDuration: 0.4,
    /** Single float tolerance used by the accumulator and lap completion. */
    epsilon: 1e-9,
  }),

  /** Money and level progression (read by src/core/ProgressManager). */
  progression: Object.freeze({
    startingMoney: 0,
    /** Paid once per won level, when the player presses Continue. */
    rewardPerLevel: 50,
  }),

  render: Object.freeze({
    /** World units per cell. The ONLY place cell units become world units. */
    cellSize: 1,
    gap: 0.08,
    blockHeight: 0.6,
    unitSize: 0.8,
    unitHeight: 0.9,
    background: 0x000000,
    /** Logical colour id -> hex. */
    palette: Object.freeze({ 1: 0xff5c5c, 2: 0x4cb5ff }),
    slotColors: Object.freeze({ free: 0x333333, occupied: 0x777777, blocked: 0xaa2222 }),
    track: Object.freeze({
      showGuide: true,
      guideColor: 0x1c1c26,
      /** Tint of the shared entry corner tile. */
      entryColor: 0x3a3a58,
      /** Guide tile edge as a fraction of a cell. */
      tileScale: 0.9,
    }),
    camera: Object.freeze({ height: 20, padding: 1, near: 0.1, far: 100 }),
    inventory: Object.freeze({
      /** Cells between the outermost runner sub-lane and the top of the inventory panel. */
      gapBelowGrid: 0.6,
      /** Extra space between neighbouring slots / reserve tiles, in cells (pitch = 1 + slotGap). */
      slotGap: 0.2,
      /** Panel top -> slot row centre, in cells. */
      slotsRowOffset: 0.5,
      /** Panel top -> first reserve row centre, in cells. */
      reserveRowOffset: 2.1,
      tileColor: 0x16161e,
      /** Slot / reserve tile edge as a fraction of a cell. */
      tileScale: 0.9,
    }),
    /** Physically based (three r155+): lit diffuse ~ colour x intensity / PI, so ~2 + ~1.5 keeps palette colours true. */
    lights: Object.freeze({
      ambient: 0xffffff,
      ambientIntensity: 2,
      directional: 0xffffff,
      directionalIntensity: 1.5,
      directionalPosition: Object.freeze([4, 10, 6]),
    }),
    /** The "chomper": a cone lying on its side, apex = heading. */
    unit: Object.freeze({ radialSegments: 3, coneRadiusFactor: 0.45 }),
    /** Capacity number drawn on a CanvasTexture sprite above each unit. */
    label: Object.freeze({
      canvasSize: 64,
      font: 'bold 42px system-ui, sans-serif',
      color: '#ffffff',
      outline: '#000000',
      outlineWidth: 8,
      worldSize: 0.6,
      yOffset: 1.5,
    }),
    /** Background tint applied on LEVEL_WON / LEVEL_LOST (event garnish). */
    endTint: Object.freeze({ won: 0x0b2410, lost: 0x2a0b0b }),
    pixelRatioMax: 2,
    /** Available-slot counter "N/5": plain text right of the slot row. Offsets in cells from the last slot's centre;
     *  height in cells (width follows the canvas aspect). */
    slotCounter: Object.freeze({
      offsetX: 1.4,
      offsetY: 0,
      height: 0.7,
      canvasWidth: 128,
      canvasHeight: 64,
      font: 'bold 44px system-ui, sans-serif',
      color: '#ffffff',
      outline: '#000000',
      outlineWidth: 6,
    }),
    /** Reserve shift: each unit glides one cell toward the front over reserveShiftMs, front to back, starting
     *  reserveShiftStaggerMs after the unit ahead and never closer than one cell to it (meshes never overlap). */
    reserveShiftMs: 160,
    reserveShiftStaggerMs: 60,
    /**
     * Per-level presentation overrides keyed by level id (merged over the defaults above). Level files in
     * src/core/levels stay pure: colour ids there are only numbers, and their meaning lives here.
     */
    levels: Object.freeze({
      watermelon: Object.freeze({
        background: 0xc5ecfb,
        palette: Object.freeze({ 1: 0x000000, 2: 0xff5a78, 3: 0xf50f3c, 4: 0xffffff, 5: 0x23ab57, 6: 0x0f8a3c }),
        /**
         * Empty ring / reserve cells: a mid blue, so both black (~6.6:1) and white (~3.2:1) units stay readable on
         * them (a light tile left white units at ~1.7:1).
         */
        track: Object.freeze({ guideColor: 0x5f97b3, entryColor: 0x467d99 }),
        inventory: Object.freeze({ tileColor: 0x5f97b3 }),
      }),
    }),
  }),

  /** DOM overlay: copy, colours, sizes (px) and timings (s). Read by src/ui only; published as CSS custom properties. */
  ui: Object.freeze({
    text: Object.freeze({
      level: 'Level',
      currency: '$',
      settings: 'Settings',
      paused: 'Paused',
      resume: 'Resume',
      restartLevel: 'Restart level',
      won: 'Congratulations!',
      continue: 'Continue',
      lost: 'Out of space',
      retry: 'Retry',
    }),
    colors: Object.freeze({
      text: '#ffffff',
      panel: '#1d1d27',
      /** Solid top bar, so the HUD text stays readable on light level backgrounds. */
      bar: '#15151d',
      backdrop: 'rgba(0, 0, 0, 0.6)',
      money: '#ffd24a',
      won: '#7cff8a',
      lost: '#ff7c7c',
      button: '#ffffff',
      buttonText: '#000000',
      buttonSecondary: '#34343f',
      buttonSecondaryText: '#ffffff',
    }),
    /** Pixels. The renderer keeps the board below barHeight (main.js passes it as a viewport inset). */
    sizes: Object.freeze({
      font: 16,
      titleFont: 26,
      barHeight: 56,
      barPadding: 12,
      iconButton: 40,
      iconBarWidth: 18,
      iconBarHeight: 2,
      iconBarGap: 4,
      radius: 10,
      gap: 12,
      cardWidth: 280,
      cardPadding: 24,
      buttonPadY: 10,
      buttonPadX: 20,
    }),
    /** Seconds. The win/lose cards wait this long after LEVEL_WON / LEVEL_LOST so the last move stays visible. */
    timing: Object.freeze({ winOverlayDelay: 0.6, loseOverlayDelay: 0.6, fade: 0.15 }),
    /** Opacity of the settings button while it cannot be used (level over). */
    disabledOpacity: 0.35,
  }),

  debug: Object.freeze({ logEvents: false }),
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function merge(base, overrides) {
  const out = {};
  for (const key of Object.keys(base)) out[key] = base[key];
  for (const key of Object.keys(overrides)) {
    const b = base[key];
    const o = overrides[key];
    out[key] = isPlainObject(b) && isPlainObject(o) ? merge(b, o) : o;
  }
  return out;
}

function deepFreeze(value) {
  if (isPlainObject(value) && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Deep-merge `overrides` onto Config and return a NEW frozen config object; Config itself is never
 * mutated. Plain objects merge recursively, arrays and primitives replace. Tests use it to shrink
 * timings, e.g. createConfig({ track: { speed: 1 }, timing: { fixedStep: 1 } }) makes one step()
 * equal one cell of travel.
 * @param {object} [overrides] partial config, any depth
 * @returns {typeof Config}
 */
export function createConfig(overrides = {}) {
  return deepFreeze(merge(Config, overrides));
}

export default Config;
