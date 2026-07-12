import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game.js';
import { segmentIndexAt, getStage } from '../src/core.js';

// game.js only touches the 2D context while rendering; the simulation (`step`)
// never does. A no-op context proxy lets us drive the real game headlessly.
function stubCanvas() {
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'canvas') return { width: 480, height: 270 };
        return () => {};
      },
    },
  );
  return { getContext: () => ctx, width: 480, height: 270 };
}

// On-screen constants mirrored from game.js (stable internal layout).
const PLAYER_X = 120;
const GROUND_Y = 200;

// A tap-only auto-player: jump at the last moment before a platform edge, and
// (when the level allows) double-jump at the jump's apex to gain height/reach.
function drivePlayer(game, { maxFrames = 6000, lead = 8 } = {}) {
  const s = game.state;
  game.onTapStart(); // skip the intro
  game.onTapEnd();
  for (let f = 0; f < maxFrames; f++) {
    game.step();
    if (s.dead || s.cleared) break;
    const footX = s.worldX + PLAYER_X;
    const idx = segmentIndexAt(s.segments, footX);
    if (s.onGround && idx >= 0) {
      const cur = s.segments[idx];
      const next = s.segments[idx + 1];
      // Climbing a higher platform needs an earlier take-off so the double
      // jump's apex lines up with the ledge; flat gaps want a late take-off for
      // maximum horizontal reach.
      const climbing = next && (next.rise || 0) > (cur.rise || 0);
      const takeoffLead = climbing ? 34 : lead;
      if (cur.end - footX < takeoffLead) {
        game.onTapStart();
        game.onTapEnd();
      }
    } else if (!s.onGround && s.vy >= -0.4 && s.jumpsUsed >= 1) {
      // near/just past apex -> spend the air jump (no-op if not unlocked)
      game.onTapStart();
      game.onTapEnd();
    }
  }
  return s;
}

// Put the game into a crafted course at a chosen level, past the intro.
function setCourse(game, { stageIndex, level, segments }) {
  game.startStage(stageIndex);
  const s = game.state;
  s.level = level;
  s.segments = segments;
  s.worldX = 0;
  s.playerY = GROUND_Y;
  s.vy = 0;
  s.onGround = true;
  s.jumpsUsed = 0;
  s.gliding = false;
  s.dead = false;
  s.cleared = false;
  s.running = true;
  s.introT = 0;
  s.lastSegId = 0;
  s.lastRise = 0;
}

test('a cliff taller than a single jump blocks a single-jumper (cliff-face collision fires)', () => {
  const game = createGame(stubCanvas());
  // Cliff of 140px is taller than a single jump's apex (~106px on this stage)
  // but within a double jump — so only Lv.1 (single jump) should fail it.
  const segments = [
    { start: 0, end: 600, rise: 0 },
    { start: 660, end: 4300, rise: 140 },
  ];
  setCourse(game, { stageIndex: 1, level: 1, segments });
  const s = drivePlayer(game);
  assert.equal(s.dead, true, 'a single jump cannot mount a 140px cliff -> hits the wall');
});

test('the same cliff is cleared once the double jump is unlocked (Lv.2)', () => {
  const game = createGame(stubCanvas());
  const segments = [
    { start: 0, end: 600, rise: 0 },
    { start: 660, end: 4300, rise: 140 },
  ];
  setCourse(game, { stageIndex: 1, level: 2, segments });
  const s = drivePlayer(game);
  assert.equal(s.dead, false, 'double jump should mount the cliff');
  // Landed on top of the elevated platform.
  assert.ok(s.onGround, 'player ends grounded on the cliff');
  assert.ok(Math.abs(s.playerY - (GROUND_Y - 140)) < 2, 'player stands on the raised surface');
});

test('an unreachably tall cliff blocks even a double jump (no pass-through)', () => {
  const game = createGame(stubCanvas());
  // 250px exceeds even a double jump's reach (~197px) on this stage.
  const segments = [
    { start: 0, end: 600, rise: 0 },
    { start: 660, end: 4300, rise: 250 },
  ];
  setCourse(game, { stageIndex: 1, level: 2, segments });
  const s = drivePlayer(game);
  assert.equal(s.dead, true, 'the wall must block, not let the player phase through');
});

test('stepping DOWN a cliff is free (no false collision)', () => {
  const game = createGame(stubCanvas());
  const segments = [
    { start: 0, end: 600, rise: 120 },
    { start: 660, end: 4300, rise: 0 },
  ];
  // Start standing on the elevated first platform.
  setCourse(game, { stageIndex: 1, level: 2, segments });
  game.state.playerY = GROUND_Y - 120;
  game.state.lastRise = 120;
  const s = drivePlayer(game);
  assert.equal(s.dead, false, 'dropping to a lower platform must not be a collision');
});

test('a generated latter-half-cliff stage is beatable at its level (headless clear)', () => {
  // Stage index 1 played at level 2 (double jump) — generated terrain includes
  // the new latter-half cliffs. A tap-only auto-player should reach the goal.
  const game = createGame(stubCanvas());
  game.state.highestCleared = 0; // -> level 2
  game.startStage(1);
  assert.equal(game.state.level, 2);
  const s = drivePlayer(game, { maxFrames: 8000 });
  assert.equal(s.dead, false, `must not die (worldX=${Math.round(s.worldX)})`);
  assert.equal(s.cleared, true, 'auto-player should clear the generated stage');
});

test('flat terrain still plays: a simple gap course is cleared', () => {
  const game = createGame(stubCanvas());
  const segments = [
    { start: 0, end: 900, rise: 0 },
    { start: 980, end: 1800, rise: 0 },
    { start: 1880, end: 4300, rise: 0 },
  ];
  setCourse(game, { stageIndex: 0, level: 1, segments });
  const s = drivePlayer(game);
  assert.equal(s.dead, false, 'single jumps clear flat gaps as before');
});
