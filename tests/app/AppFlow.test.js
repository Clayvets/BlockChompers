import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { AppFlow, AppState, FlowReason } from '../../src/app/AppFlow.js';
import { CueBus, Cues } from '../../src/app/Cues.js';
import { Events } from '../../src/core/Events.js';
import { UnitState } from '../../src/core/Unit.js';
import { createTestGame } from '../helpers/createTestGame.js';
import { SINGLE_LANE_LEVEL } from '../fixtures/levels.js';

// update(dt) clamps dt to timing.maxFrameDt; lift it so one update(3) runs three 1 s steps.
const makeGame = () => createTestGame({ level: SINGLE_LANE_LEVEL, config: { timing: { maxFrameDt: 10 } } });
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('AppFlow', () => {
  it('starts in MENU, where the simulation never steps', () => {
    const { game } = makeGame();
    const flow = new AppFlow({ game });
    expect(flow.state).toBe(AppState.MENU);
    expect(flow.playing).toBe(false);
    expect(game.activateUnit('u0').ok).toBe(true); // even a launched unit stays put: nothing steps
    for (let i = 0; i < 5; i += 1) expect(flow.update(3)).toBe(false);
    const snapshot = game.getSnapshot();
    expect(snapshot.stepCount).toBe(0);
    expect(snapshot.grid.remaining).toBe(3);
  });

  it('Play moves to PLAYING, loads the level from scratch and lets the simulation step', () => {
    const { game, eventBus } = makeGame();
    const loaded = [];
    eventBus.on(Events.LEVEL_LOADED, ({ snapshot }) => loaded.push([snapshot.levelId, snapshot.units[0].state]));
    const flow = new AppFlow({ game });
    game.activateUnit('u0');
    expect(flow.play()).toEqual({ ok: true });
    expect(flow.state).toBe(AppState.PLAYING);
    expect(loaded).toEqual([[SINGLE_LANE_LEVEL.id, UnitState.RESERVE]]);
    expect(flow.update(3)).toBe(true);
    expect(game.getSnapshot().stepCount).toBe(3);
  });

  it('leaves MENU only once: there is no way back to the start screen', () => {
    const { game } = makeGame();
    const flow = new AppFlow({ game });
    flow.play();
    flow.update(2);
    expect(flow.play()).toEqual({ ok: false, reason: FlowReason.NOT_IN_MENU });
    expect(flow.state).toBe(AppState.PLAYING);
    expect(game.getSnapshot().stepCount).toBe(2); // the refused Play did not reload the level
  });

  it('is pure: no three.js, DOM, clock or randomness in src/app', () => {
    for (const file of ['AppFlow.js', 'Cues.js']) {
      const source = stripComments(fs.readFileSync(new URL(`../../src/app/${file}`, import.meta.url), 'utf8'));
      expect(source, file).not.toMatch(/from\s+['"]three['"]|\bdocument\b|\bwindow\b|performance\.now|Date\.now|Math\.random/);
    }
  });
});

describe('CueBus', () => {
  it('calls listeners in order, lets one unsubscribe during an emit, and ignores cues nobody hears', () => {
    const bus = new CueBus();
    const calls = [];
    const offFirst = bus.on(Cues.TAP, () => {
      calls.push('first');
      offFirst();
    });
    bus.on(Cues.TAP, (payload) => calls.push(`second ${payload}`));
    bus.emit(Cues.TAP, 1);
    bus.emit(Cues.TAP, 2);
    bus.emit(Cues.COIN);
    expect(calls).toEqual(['first', 'second 1', 'second 2']);
  });
});
