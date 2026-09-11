/**
 * Central, frozen game configuration.
 *
 * Sections read by the pure logic layer (src/core): grid, track, units, inventory, rules, timing, progression.
 * Sections read by the presentation layer only (src/render, src/ui, src/audio): render (render.audio for sound), ui, debug.
 * Core code must never read `render`.
 *
 * Units of measure: distances are CELL UNITS (one grid cell = 1); durations are SECONDS, except keys ending in Ms
 * (milliseconds); speeds are cells per second. Easing keys hold a curve name from src/core/easing.js. Pixels/world units only appear in `render`.
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
    /** Cruise speed of a unit on the track, cells per second (see units.launchSpeed / units.accelMs for the ramp). */
    speed: 6.4,
    /** Shared entry corner for every activated unit; a lap runs from here back to here. */
    entry: Object.freeze({ corner: 'SW' }),
    /**
     * Minimum distance (cells) between runners, along the track only: a launching unit waits at the entry until the
     * last runner is this far ahead, and a runner never closes in on the unit ahead beyond it (it waits while that unit eats). Kept at
     * least render.unitSize (a unit's length in cells before the fixed layout). Units are now drawn at the constant
     * render.layout.unitSize, so on boards with small cells neighbours can overlap on the path. 0 = pass-through.
     */
    launchSpacing: 1,
  }),

  units: Object.freeze({
    /** Used when a level's unit definition omits capacity. */
    defaultCapacity: 5,
    /** Levels with a smaller capacity are rejected (such a unit could only block a slot). */
    minCapacity: 1,
    /** Speed (cells/s) a unit has when it enters the track; it ramps up to track.speed over accelMs. */
    launchSpeed: 2,
    /** Time (ms) from entering the track to cruise speed. 0 = cruise at once. */
    accelMs: 400,
    /** Curve of that speed ramp (easeOut: quick pick-up, settles into cruise without a jolt). */
    accelEasing: 'easeOutQuad',
  }),

  inventory: Object.freeze({
    /** Reserve grid width; rows are derived from the level's unit count. */
    reserveCols: 4,
    /**
     * Strict limit of the playing zone: a launch needs (units moving + units parked) < activeSlots. Moving units hold no
     * slot; a unit that finishes a lap with capacity left parks in the leftmost free slot (the limit guarantees one).
     */
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
    /** Final rush: once the reserve is empty, every unit on the track (and any relaunched later) speeds up by this factor. */
    finalRushSpeedMultiplier: 1.8,
    /** Time (ms) the final rush takes to ramp from 1x to the multiplier. 0 = instant. */
    finalRushRampMs: 700,
    /** Curve of that ramp (easeInOut: no jump at the start, no jolt at the end). */
    finalRushEasing: 'easeInOutCubic',
  }),

  timing: Object.freeze({
    /** Logic step length; update(dt) accumulates real time and runs whole steps. */
    fixedStep: 1 / 60,
    /** Clamp for a single frame's dt (hidden-tab catch-up guard). */
    maxFrameDt: 0.1,
    /** Flight time (ms) from the reserve cell (or the parking slot, for a relaunch) to the track entry. */
    launchToEntryMs: 260,
    /** Pause on the track per consumed block (scaled with track.speed: about 64% of the time a cell takes). 0 = instant. */
    eatDuration: 0.1,
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
    /**
     * Fixed portrait layout in DESIGN units (= world units on the x/z plane; x right, y down on screen), identical on
     * every level. The camera shows the whole design, scaled uniformly to the viewport below the HUD, with any extra
     * space as margin. Only the board (grid + track ring) scales: cellSize = min(boardRegion.w / boardCols,
     * boardRegion.h / boardRows, maxCellSize), centred in boardRegion (src/render/layout/computeLayout.js).
     * Rects are { x, y, w, h } from the top-left corner.
     */
    layout: Object.freeze({
      designWidth: 10,
      designHeight: 20,
      /** Grid + track. Its 0.4 margins leave room for units on the ring, which are larger than small cells. */
      boardRegion: Object.freeze({ x: 0.4, y: 0.4, w: 9.2, h: 12 }),
      /** The 5 parking slots, centred in this band. */
      slotsRegion: Object.freeze({ x: 0.4, y: 12.9, w: 9.2, h: 1 }),
      /** The reserve: reserveCols columns of reserveCellSize cells, as many rows as fit (7: Carrot needs 7). */
      reserveRegion: Object.freeze({ x: 0.4, y: 14.35, w: 9.2, h: 5.25 }),
      /** Slot pitch; the slot tile is slotSize x render.inventory.tileScale. */
      slotSize: 1,
      /** Reserve pitch; the reserve tile is reserveCellSize x render.inventory.tileScale. */
      reserveCellSize: 0.75,
      /** Unit (cone) length, the same in the reserve, in a slot and on the track. */
      unitSize: 0.6,
      /** Capacity label height. */
      labelSize: 0.45,
      /** "N/5" counter centre and text height (width follows render.slotCounter's canvas aspect). */
      counter: Object.freeze({ x: 8.3, y: 13.4, height: 0.55 }),
      /** Largest board cell, so small levels do not blow up (0.75: a unit is 0.8 of a cell, as before). */
      maxCellSize: 0.75,
    }),
    /** Block gap and height as fractions of a board cell (blocks scale with the level's cellSize). */
    gap: 0.08,
    blockHeight: 0.6,
    /**
     * A unit's length in board cells before the fixed layout. Not used for drawing any more (see layout.unitSize); kept
     * because tests/core/followDistance.test.js checks track.launchSpacing >= render.unitSize.
     */
    unitSize: 0.8,
    /** World height of a unit's centre above the ground (constant). */
    unitHeight: 0.9,
    background: 0x000000,
    /** Logical colour id -> hex. */
    palette: Object.freeze({ 1: 0xff5c5c, 2: 0x4cb5ff }),
    slotColors: Object.freeze({ free: 0x333333, blocked: 0xaa2222 }),
    track: Object.freeze({
      showGuide: true,
      guideColor: 0x1c1c26,
      /** Tint of the shared entry corner tile. */
      entryColor: 0x3a3a58,
      /** Guide tile edge as a fraction of a board cell. */
      tileScale: 0.9,
    }),
    camera: Object.freeze({ height: 20, near: 0.1, far: 100 }),
    inventory: Object.freeze({
      tileColor: 0x16161e,
      /** Slot / reserve tile edge as a fraction of layout.slotSize / layout.reserveCellSize. */
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
      /** World height above the ground (top-down, so it only keeps the label above the meshes). */
      yOffset: 1.5,
    }),
    /** Background tint applied on LEVEL_WON / LEVEL_LOST (event garnish). */
    endTint: Object.freeze({ won: 0x0b2410, lost: 0x2a0b0b }),
    pixelRatioMax: 2,
    /** Available-slot counter "N/5": plain text right of the slot row; position and height in layout.counter. */
    slotCounter: Object.freeze({
      canvasWidth: 128,
      canvasHeight: 64,
      font: 'bold 44px system-ui, sans-serif',
      color: '#ffffff',
      outline: '#000000',
      outlineWidth: 6,
    }),
    /** Reserve shift: each unit glides one cell toward the front over reserveShiftMs (motionEasing), front to back,
     *  starting reserveShiftStaggerMs after the unit ahead (the departing unit first) and never closer than one cell. */
    reserveShiftMs: 160,
    reserveShiftStaggerMs: 60,
    /** One curve for every eased move: launch and relaunch flight, return to a slot, reserve shift. */
    motionEasing: 'easeOutCubic',
    /** Launch flight shape: world units the flight first lifts off its start (clear of the reserve row it leaves)... */
    launchLift: 0.7,
    /** ...and how early it lines up with the track before the entry, as a fraction of the start's depth (0 = late). */
    launchCurve: 0.5,
    /** World units a flying or returning unit rises at mid-move, so it draws over the units it passes (top-down). */
    hopHeight: 0.8,
    /** Time (ms) a unit takes to glide from the entry corner to its parking slot (logic parks it at once). */
    returnToSlotMs: 280,
    /** How fast a unit turns to face its direction of travel, per second (exponential; higher = snappier). */
    rotationDamping: 18,
    /** Flight time (ms) of a projectile from the unit's tip to the block it ate; the block reacts when it lands. */
    projectileTravelMs: 110,
    /** Curve of that flight (easeIn: it speeds up into the hit). Presentation easing names: src/render/anim/easing.js. */
    projectileEasing: 'easeInQuad',
    /** Particles in one block's burst (x vfx.reducedScale in reduced mode). Low: big levels destroy hundreds of blocks. */
    blockBurstCount: 6,
    /**
     * Juice (presentation only; src/render/vfx). Sizes are world units, times ms. One InstancedMesh per effect type,
     * preallocated to these caps; at a cap the oldest instance is recycled. Particles and trails scale with cellSize.
     */
    vfx: Object.freeze({
      maxProjectiles: 48,
      maxParticles: 600,
      maxConfetti: 160,
      /**
       * Effects level: 'full' | 'reduced'. There is no in-game option; main.js switches to 'reduced' when the system
       * asks for reduced motion (prefers-reduced-motion).
       */
      effects: 'full',
      /** Reduced effects: particle and confetti counts x this, no shakes. */
      reducedScale: 0.4,
      /** Projectile ball and its trail of fading sparks (one spark every trailEveryMs while it flies). */
      projectile: Object.freeze({ size: 0.16, height: 1.2, trailEveryMs: 16, trailLifeMs: 140, trailSize: 0.45 }),
      /** Muzzle pop: the firing triangle's scale punches by +punch over ms. */
      muzzle: Object.freeze({ punch: 0.35, ms: 130 }),
      /** Block hit: white flash, then squash (flat and wide), then shrink to nothing. */
      impact: Object.freeze({ flashMs: 55, squashMs: 70, shrinkMs: 120, squashY: 0.35, stretchXZ: 1.3 }),
      /** Burst sparks: size and speed in board cells (x cellSize); gravity pulls them down the screen. */
      burst: Object.freeze({ lifeMs: 420, size: 0.28, speed: 5, gravity: 16, height: 1 }),
      /** Capacity label: the old number fades and shrinks, the new one pops in with a punch and a colour flash. */
      label: Object.freeze({ outMs: 170, outScale: 0.5, inMs: 260, inFrom: 0.45, flashMs: 200, flashColor: 0xffd24a }),
      /** Death pop at capacity 0: squash, then shrink to nothing, with a burst of sparks. */
      death: Object.freeze({ ms: 260, squashAt: 0.3, squash: 0.6, stretch: 1.35, burstCount: 10 }),
      /** "N/5" counter: punch when N changes, flash when it hits 0. */
      counter: Object.freeze({ punch: 0.4, punchMs: 240, flashColor: 0xff5252, flashMs: 600 }),
      /** Win confetti, in CSS pixels on an overlay above the win card. */
      confetti: Object.freeze({
        count: 140, durationMs: 2800, width: 12, height: 7, speed: 1150, speedJitter: 0.35, spread: 0.45,
        gravity: 1500, drag: 0.9, spin: 14, sway: 40, fadeMs: 500, stopFadeMs: 180,
      }),
    }),
    /**
     * Sound effects (src/audio; presentation only). Gains are 0..1, pitches Hz, times ms. src/audio/SfxBank.js builds
     * each sound from its numbers below, with no audio files: `tone` is an oscillator sliding freq -> freqEnd, `noise`
     * (also `click`, `puff`) is white noise through a filter sweeping freq -> freqEnd with resonance q, and `notes`
     * plays the pitches in hz stepMs apart (noteMs each, lastNoteMs for the last). Every layer rises over attackMs and
     * then decays until ms. To play a file instead, give a sound `file: 'name.ogg'` and a `volume`. Per sound,
     * minIntervalMs skips a retrigger that comes sooner, `combo` sounds rise in pitch while they keep coming, and
     * pitchJitter varies the pitch by up to +/- that fraction.
     */
    audio: Object.freeze({
      /** Master gain (the Sound toggle mutes it) and the sfx bus under it. */
      masterVolume: 1,
      sfxVolume: 0.8,
      /** Initial state of the settings Sound toggle (false = on). */
      muted: false,
      /** Mute / unmute ramp, so the toggle never clicks. */
      muteFadeMs: 60,
      /** A sound starts this long after its trigger, so it is never scheduled in the audio thread's past (no click). */
      lookaheadMs: 10,
      /** Sounds playing at once; one more is skipped, never queued. */
      maxVoices: 12,
      /** Combo sounds (block break, coin): each one within comboWindowMs of the last is comboSemitones higher... */
      comboWindowMs: 450,
      comboSemitones: 0.5,
      /** ...up to this many steps; a longer gap resets the pitch. */
      comboMaxSteps: 8,
      /** Envelopes decay to this gain (-80 dB) before a voice stops: an exponential ramp cannot reach 0. */
      envelopeFloor: 0.0001,
      /** Length of the one white-noise buffer that every noise layer loops over. */
      noiseBufferMs: 1000,
      /** Folder of file-based sounds, relative to the page (public/assets/sfx/ in the repo). */
      assetsPath: 'assets/sfx/',
      sounds: deepFreeze({
        /** UI button press (not Play). */
        tap: { minIntervalMs: 40, tone: { freq: 720, freqEnd: 480, attackMs: 2, ms: 55, volume: 0.22 } },
        /** Overlay enters / leaves. */
        whooshIn: { minIntervalMs: 120, noise: { freq: 350, freqEnd: 1600, q: 0.9, attackMs: 90, ms: 260, volume: 0.3 } },
        whooshOut: { minIntervalMs: 120, noise: { freq: 1400, freqEnd: 320, q: 0.9, attackMs: 30, ms: 200, volume: 0.26 } },
        /** Start screen Play. */
        confirm: { minIntervalMs: 250, notes: { hz: Object.freeze([523.25, 783.99]), stepMs: 80, noteMs: 150, lastNoteMs: 360, attackMs: 4, volume: 0.24 } },
        /** A unit leaves the reserve or its slot. */
        launch: { minIntervalMs: 60, noise: { freq: 420, freqEnd: 1800, q: 1.2, attackMs: 50, ms: 190, volume: 0.34 } },
        /** A unit fires (BLOCK_CONSUMED). */
        pew: { minIntervalMs: 45, pitchJitter: 0.07, tone: { freq: 1300, freqEnd: 480, attackMs: 2, ms: 85, volume: 0.07 } },
        /** A block breaks, on the visual impact; rises with the combo. */
        pop: {
          minIntervalMs: 40, combo: true,
          tone: { freq: 900, freqEnd: 220, attackMs: 1, ms: 70, volume: 0.2 },
          click: { freq: 3500, q: 0.7, attackMs: 1, ms: 14, volume: 0.08 },
        },
        /** A capacity number drops (to 1 or more). */
        tick: { minIntervalMs: 55, tone: { freq: 2200, freqEnd: 2000, attackMs: 1, ms: 28, volume: 0.05 } },
        /** A unit pops at capacity 0. */
        unitPop: {
          minIntervalMs: 60,
          tone: { freq: 620, freqEnd: 110, attackMs: 2, ms: 190, volume: 0.26 },
          puff: { freq: 2000, freqEnd: 400, q: 0.7, attackMs: 2, ms: 110, volume: 0.12 },
        },
        /** A unit lands in its slot. */
        park: {
          minIntervalMs: 60,
          tone: { freq: 170, freqEnd: 70, attackMs: 3, ms: 130, volume: 0.28 },
          puff: { freq: 600, freqEnd: 200, q: 0.7, attackMs: 2, ms: 45, volume: 0.06 },
        },
        /** The "N/5" counter reaches 0. */
        warn: { minIntervalMs: 800, notes: { hz: Object.freeze([466.16, 466.16]), stepMs: 150, noteMs: 100, attackMs: 6, volume: 0.1 } },
        /** The final rush starts. */
        rush: {
          minIntervalMs: 1000,
          noise: { freq: 260, freqEnd: 3200, q: 1.1, attackMs: 450, ms: 700, volume: 0.3 },
          tone: { freq: 220, freqEnd: 880, attackMs: 450, ms: 700, volume: 0.05 },
        },
        /** The win card appears, with the confetti. */
        fanfare: { minIntervalMs: 1000, notes: { hz: Object.freeze([523.25, 659.25, 783.99, 1046.5]), stepMs: 95, noteMs: 170, lastNoteMs: 600, attackMs: 4, volume: 0.2 } },
        /** Money counting up (one per shown number, throttled); rises with the combo. */
        coin: { minIntervalMs: 70, combo: true, tone: { freq: 1320, freqEnd: 1760, attackMs: 1, ms: 60, volume: 0.08 } },
        /** The lose card appears. */
        lose: { minIntervalMs: 1000, notes: { hz: Object.freeze([392, 329.63, 261.63]), stepMs: 200, noteMs: 220, lastNoteMs: 560, attackMs: 8, volume: 0.16 } },
      }),
    }),
    /**
     * Styled 3D models (Fish of Fortune, step 1: the fish units and the track). GLBs in public/assets/models, exported
     * from the artist's .blend files by npm run export:models (tools/blender/export_glb.py, tools/blender/models.json)
     * and drawn by src/render/StyledFactory.js. A model that fails to load falls back to its primitive.
     */
    models: Object.freeze({
      fish: Object.freeze({
        url: 'assets/models/fish.glb',
        /** Size factor on the bounding-box normalisation: a fish is render.layout.unitSize x scale long, nose to tail... */
        scale: 1,
        /** ...unless that is too wide for the one-cell canal: its width is then held at canalFit x cellSize. */
        canalFit: 0.8,
        /** Yaw (degrees) that turns the model to face +X, every unit's heading axis (the model faces -X). */
        rotationOffset: 180,
        /** World units added to the unit's height (render.unitHeight). */
        yOffset: 0,
        /** Materials that take the unit's palette colour, through one shared material per colour. */
        tintMaterialNames: Object.freeze(['M_Fish_Clean']),
        /**
         * Tone-map the tinted fish with render.lighting.toneMapping (true) or not (false). Off: a fish's body shows its
         * palette colour as the blocks do (AgX dulls saturated colours: a #f50f3c fish rendered #b03e3f). The track,
         * whose colours come from the .blend, stays tone-mapped like Blender's AgX view.
         */
        toneMapped: false,
        /**
         * Midtone tint (src/render/styled/fishTint.js); luminances are linear. The texture body (bodyLuminance) takes
         * exactly the palette colour, darker details stay darker, and the tint fades out between highlightStart and
         * highlightEnd so eye whites and fins stay light. minLuminance lifts black a little; the rim (strength, power)
         * darkens light fish and lights dark ones at their outline, switching at rimSwitch (palette luminance).
         */
        tint: Object.freeze({
          strength: 1, bodyLuminance: 0.22, highlightStart: 0.35, highlightEnd: 0.75, minLuminance: 0.02,
          rim: 0.35, rimPower: 2.5, rimSwitch: 0.35, rimLight: 0xffffff, rimDark: 0x0b2233,
        }),
        /** glTF clip names: Swim while a unit moves, Idle in the reserve and slots, cross-faded over fadeMs. */
        animations: Object.freeze({ swim: 'Fish_Swim', idle: 'Fish_Idle', fadeMs: 200, swimSpeed: 1, idleSpeed: 1 }),
      }),
      track: Object.freeze({
        straightUrl: 'assets/models/track_straight.glb',
        cornerUrl: 'assets/models/track_corner.glb',
        chevronUrl: 'assets/models/track_chevron.glb',
        /**
         * Blender's transmission (water 0.45, outer rim 0.25) as plain transparency: opacity = 1 - transmission x
         * transmissionWeight. 0.65 matches the Blender reference render (tools/blender/render_reference.py): water
         * #8eb5c4 vs #94b5bd, rim #88adbb vs #8badb8. At 1 the canal bed shows through too much and both read darker.
         */
        transmissionAsOpacity: true,
        transmissionWeight: 0.65,
        /**
         * The entry corner's instance colour (it multiplies that corner's materials; 0xffffff = no tint): a cool,
         * slightly darker corner like v3's entry tile, about 25 levels darker than the other corners.
         */
        entryTint: 0xb4c8dc,
        /**
         * Flow chevrons, as in Fish_Rail.blend: one every `spacing` cells along the canal's centre line, moving one
         * spacing per periodMs in the travel direction (0.6 m every 48 frames at 24 fps); corners rounded to
         * cornerRadius cells, like the rail's path.
         */
        chevrons: Object.freeze({ spacing: 0.481, periodMs: 2000, cornerRadius: 0.382 }),
      }),
    }),
    /**
     * Lights for the GLB models only. The Renderer draws the models (on `layer`) in a first pass under these lights and
     * this tone mapping, then everything else in a second pass under render.lights with no tone mapping, so blocks,
     * tiles, slots and labels look exactly as in v3. Taken from Fish_Rail.blend: its Sun (4.2 W/m², warm, from the
     * south and above; +Z is the board's south), and its AquaWorld ambient (0.07, 0.1, 0.14) plus its blue fill light
     * folded into the hemisphere's sky. toneMapping 'agx' matches the AgX view transform both .blend files use; 'none'
     * turns it off.
     */
    lighting: Object.freeze({
      layer: 1,
      toneMapping: 'agx',
      exposure: 1,
      hemisphere: Object.freeze({ sky: 0xa1bfd9, ground: 0x8198b1, intensity: 1 }),
      directional: Object.freeze({ color: 0xfffdf6, intensity: 4.2, position: Object.freeze([-0.161, 0.641, 0.751]) }),
    }),
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
      /** Mid-tone background so both black and white blocks read; darker tiles keep black (~5.2:1) and white (~4:1)
       *  units readable on empty ring and reserve cells. */
      panda: Object.freeze({
        background: 0x9cc3d5,
        palette: Object.freeze({ 1: 0x0a0a0a, 2: 0xffffff, 3: 0x2c6b1a }),
        track: Object.freeze({ guideColor: 0x4d86a3, entryColor: 0x3a6e88 }),
        inventory: Object.freeze({ tileColor: 0x4d86a3 }),
      }),
      carrot: Object.freeze({
        background: 0x9cc3d5,
        palette: Object.freeze({ 1: 0x0a0a0a, 2: 0x8ec7a2, 3: 0xf48d72, 4: 0xea7352, 5: 0xffffff, 6: 0xf4c6df }),
        track: Object.freeze({ guideColor: 0x4d86a3, entryColor: 0x3a6e88 }),
        inventory: Object.freeze({ tileColor: 0x4d86a3 }),
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
      /** Start screen: the game title and its button. */
      title: 'BlockChompers',
      play: 'Play',
      /** Settings toggle for sound (render.audio). */
      soundOn: 'Sound: on',
      soundOff: 'Sound: off',
      won: 'Congratulations!',
      continue: 'Continue',
      /** Replaces Continue on the last level of the cycle (the next level is Level 1 again). */
      playAgain: 'Play again',
      lost: 'Out of space',
      retry: 'Retry',
    }),
    colors: Object.freeze({
      text: '#ffffff',
      panel: '#1d1d27',
      /** Solid top bar, so the HUD text stays readable on light level backgrounds. */
      bar: '#15151d',
      backdrop: 'rgba(0, 0, 0, 0.6)',
      /** Start screen: a darker backdrop (the first level shows faintly behind it) and the game title. */
      titleBackdrop: 'rgba(12, 12, 18, 0.86)',
      title: '#ffd24a',
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
      /** Start screen: wider card, big title, big Play button. */
      startCardWidth: 320,
      startTitleFont: 34,
      playFont: 22,
      playPadY: 16,
    }),
    /** Seconds. The win/lose cards wait this long after LEVEL_WON / LEVEL_LOST so the last move stays visible. */
    timing: Object.freeze({ winOverlayDelay: 0.6, loseOverlayDelay: 0.6 }),
    /**
     * DOM animations (Web Animations API, transform and opacity only). Times ms, distances px, easings CSS strings:
     * overshoot pops past its target and settles; soft glides in; exit accelerates out.
     */
    anim: Object.freeze({
      overshoot: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      soft: 'cubic-bezier(0.22, 1, 0.36, 1)',
      exit: 'cubic-bezier(0.55, 0, 1, 0.45)',
      hudInMs: 380,
      labelOutMs: 140,
      labelInMs: 280,
      labelShift: 12,
      backdropInMs: 220,
      backdropOutMs: 180,
      cardInMs: 420,
      cardOutMs: 200,
      cardFromScale: 0.6,
      loseCardFromScale: 0.88,
      itemInMs: 280,
      itemStaggerMs: 80,
      itemShift: 16,
      shakeMs: 450,
      shakePx: 7,
      buttonDownScale: 0.9,
      buttonDownMs: 70,
      buttonUpMs: 280,
      flyMs: 620,
      countUpMs: 520,
      moneyPunchScale: 1.35,
      moneyPunchMs: 340,
      settingsInMs: 260,
      settingsOutMs: 180,
      settingsShift: 28,
    }),
    /** Opacity of the settings button while it cannot be used (level over). */
    disabledOpacity: 0.35,
    /**
     * Styled start screen (Fish of Fortune): the key art with the painted title, and a Play button made from an image
     * (both from tools/ui, npm run process:ui). main.js loads them and the label font before the UI mounts; if any of
     * the three fails, the console names the file and the flat v3 start screen above (text.title, sizes.start*) is used.
     * text.title stays the document title and the screen's aria-label; it is not drawn over the art.
     */
    startScreen: Object.freeze({
      background: 'assets/ui/start_bg.webp',
      button: 'assets/ui/button_green.png',
      /** Self-hosted (OFL, public/assets/fonts/TitanOne-OFL.txt); fallback only matters if the font fails mid-session. */
      font: Object.freeze({ family: 'Titan One', url: 'assets/fonts/TitanOne-Regular-latin.woff2', fallback: 'system-ui, sans-serif' }),
      /**
       * The art is contained in the viewport (all of it visible, never cropped or stretched). The space around it shows
       * the same image cover-fitted, blurred (px) and darkened; scale hides the blur's soft edge. color shows first.
       */
      backdrop: Object.freeze({ blurPx: 18, brightness: 0.55, saturate: 1.1, scale: 1.1, color: '#0b2a3d' }),
      playButton: Object.freeze({
        /** Anchored to the displayed art: centre and width are fractions of the image rect (over the sand). */
        centerX: 0.5,
        centerY: 0.875,
        widthPct: 0.46,
        /** Label font size as a fraction of the button height; offsetY (em) centres the capitals on the pill. */
        labelSize: 0.47,
        labelOffsetY: -0.1,
        labelColor: '#ffffff',
        /** Outline stroke width in em (half of it shows outside the letters) and the soft drop shadow. */
        outlineColor: '#1f5843',
        outlineWidth: 0.17,
        shadow: '0 0.09em 0.1em rgba(0, 0, 0, 0.45)',
        /**
         * The pill's own shadow on the art (CSS drop-shadow), replacing the baked one the processing removed. Lengths
         * in em of the label size, so it scales with the button.
         */
        dropShadow: Object.freeze({ offsetY: 0.14, blur: 0.16, color: 'rgba(40, 26, 6, 0.5)' }),
        hoverBrightness: 1.08,
        /** Idle breathing: scale up to pulseScale and back once per pulsePeriodMs (off with reduced effects). */
        pulseScale: 1.04,
        pulsePeriodMs: 1600,
        /** Keyboard focus ring (px). */
        focusColor: '#ffffff',
        focusWidth: 3,
        focusOffset: 2,
      }),
    }),
  }),

  debug: Object.freeze({
    logEvents: false,
    /** Debug level select: ?level=<id> loads any level from levelLibrary on its own, outside the progression. '' = off. */
    levelParam: 'level',
    /**
     * Debug mode: outline the render.layout regions, and show cellSize, FPS, draw calls, active particles and
     * renderer.info.memory in a small panel.
     */
    enabled: false,
    /** Scales the time fed to the simulation and the effects (1 = real time; 0.25 = slow motion). The DOM UI is unaffected. */
    timeScale: 1,
    /** Outline colours (drawn on top of everything). */
    layoutColors: Object.freeze({ design: 0xffffff, boardRegion: 0x00e676, board: 0xffc400, slotsRegion: 0x00b0ff, reserveRegion: 0xff4081 }),
    /** Debug panel: a small text box in the bottom-right corner of #ui-root, clear of the centred reserve (pixels). */
    panel: Object.freeze({ right: 8, bottom: 8, padding: 6, font: '11px ui-monospace, monospace', color: '#ffffff', background: 'rgba(0, 0, 0, 0.65)' }),
  }),
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
