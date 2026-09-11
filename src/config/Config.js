/**
 * Central, frozen game configuration.
 *
 * Sections read by the pure logic layer (src/core): grid, track, units, inventory, rules, timing.
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
    /** Minimum distance (cells) between consecutive launches. 0 = disabled (pure pass-through). */
    launchSpacing: 0,
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
    /** When a reserve unit leaves, shift the remaining units toward the front. */
    compactReserve: false,
  }),

  rules: Object.freeze({
    /** Blocks a unit may eat from ONE lane during ONE pass. Infinity = chain inward until blocked. */
    blocksPerLanePass: 1,
    /** If true, a cleared grid only counts as a win once every runner has died or returned. */
    winWaitsForRunners: false,
    /** Allow activating a unit whose colour has no remaining blocks (a guaranteed slot block). */
    allowNoTargetActivation: true,
    /** Declare a loss as soon as no reserve unit could eat anything (Simulator heuristic). */
    detectDeadEndsEarly: false,
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
      /**
       * Lateral offset per active-slot index: concurrent runners ride parallel sub-lanes. Keep it >= the runner
       * footprint (~1.73 x unitSize x unit.coneRadiusFactor for the 3-sided cone) and >= label.worldSize so
       * runners never overlap visually.
       */
      laneOffsetPerSlot: 0.64,
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
  }),

  /** DOM overlay copy and colours (read by src/ui only). */
  ui: Object.freeze({
    text: Object.freeze({ blocksLeft: 'Blocks left', slots: 'Slots', won: 'Level cleared!', lost: 'Level lost', restart: 'Restart' }),
    loseReasons: Object.freeze({
      'all-slots-blocked': 'All active slots are blocked.',
      'reserve-empty': 'The reserve is empty.',
      'no-valid-moves': 'No unit can reach a block.',
    }),
    colors: Object.freeze({
      text: '#ffffff',
      panel: 'rgba(0, 0, 0, 0.75)',
      backdrop: 'rgba(0, 0, 0, 0.35)',
      won: '#7cff8a',
      lost: '#ff7c7c',
      button: '#ffffff',
      buttonText: '#000000',
    }),
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
