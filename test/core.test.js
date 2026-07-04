import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGES,
  STAGE_COUNT,
  getStage,
  levelForXp,
  unlockedActions,
  isActionUnlocked,
  maxJumps,
  awardStageClear,
  generatePlatforms,
  isOnSolid,
  stepVelocity,
  resolveTap,
  MAX_LEVEL,
  XP_PER_STAGE,
  GLIDE_MAX_FALL,
} from '../src/core.js';

test('at least 3 stages exist (DoD: 最低3ステージ)', () => {
  assert.ok(STAGE_COUNT >= 3);
  assert.equal(STAGES.length, STAGE_COUNT);
});

test('getStage wraps around and stays in range', () => {
  assert.equal(getStage(0).id, STAGES[0].id);
  assert.equal(getStage(STAGE_COUNT).id, STAGES[0].id);
  assert.equal(getStage(-1).id, STAGES[STAGE_COUNT - 1].id);
});

test('levelForXp progresses one level per stage and caps at MAX_LEVEL', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(XP_PER_STAGE - 1), 1);
  assert.equal(levelForXp(XP_PER_STAGE), 2);
  assert.equal(levelForXp(XP_PER_STAGE * 3), 4);
  assert.equal(levelForXp(XP_PER_STAGE * 99), MAX_LEVEL);
  assert.equal(levelForXp(-50), 1);
});

test('actions unlock in the spec order as level rises', () => {
  assert.deepEqual(unlockedActions(1), ['jump']);
  assert.deepEqual(unlockedActions(2), ['jump', 'doubleJump']);
  assert.deepEqual(unlockedActions(3), ['jump', 'doubleJump', 'glide']);
  assert.deepEqual(unlockedActions(5), ['jump', 'doubleJump', 'glide', 'dash', 'wallKick']);
  assert.equal(isActionUnlocked(1, 'doubleJump'), false);
  assert.equal(isActionUnlocked(2, 'doubleJump'), true);
});

test('maxJumps is 1 until double jump unlocks, then 2', () => {
  assert.equal(maxJumps(1), 1);
  assert.equal(maxJumps(2), 2);
  assert.equal(maxJumps(5), 2);
});

test('awardStageClear reports level-up and the newly unlocked action', () => {
  const a = awardStageClear(0); // level 1 -> 2
  assert.equal(a.xp, XP_PER_STAGE);
  assert.equal(a.level, 2);
  assert.equal(a.leveledUp, true);
  assert.equal(a.unlocked, 'doubleJump');

  const b = awardStageClear(XP_PER_STAGE); // level 2 -> 3
  assert.equal(b.unlocked, 'glide');

  const c = awardStageClear(XP_PER_STAGE * 98); // already max
  assert.equal(c.level, MAX_LEVEL);
  assert.equal(c.leveledUp, false);
  assert.equal(c.unlocked, null);
});

test('generatePlatforms is deterministic and has safe start/finish', () => {
  const length = 4200;
  const p1 = generatePlatforms(0, length, 777);
  const p2 = generatePlatforms(0, length, 777);
  assert.deepEqual(p1, p2, 'same seed -> identical terrain');

  // Safe landing at the very start and just before the finish.
  assert.equal(isOnSolid(p1, 0), true);
  assert.equal(isOnSolid(p1, 10), true);
  assert.equal(isOnSolid(p1, length - 1), true);

  // Different stage index -> different terrain (has gaps to jump).
  const hasGap = p1.some((seg, i) => i > 0 && seg.start > p1[i - 1].end);
  assert.ok(hasGap, 'terrain must contain at least one gap to cross');
});

test('isOnSolid detects gaps between segments', () => {
  const segs = [
    { start: 0, end: 100 },
    { start: 200, end: 300 },
  ];
  assert.equal(isOnSolid(segs, 50), true);
  assert.equal(isOnSolid(segs, 100), false); // end is exclusive -> gap
  assert.equal(isOnSolid(segs, 150), false);
  assert.equal(isOnSolid(segs, 250), true);
  assert.equal(isOnSolid(segs, 999), false);
});

test('stepVelocity applies gravity and glide caps fall speed', () => {
  assert.equal(stepVelocity(0, 0.6), 0.6);
  assert.equal(stepVelocity(-11.5, 0.6), -10.9);
  // Without glide, fall speed keeps growing.
  assert.equal(stepVelocity(5, 0.6, false), 5.6);
  // With glide, downward speed is capped.
  assert.equal(stepVelocity(5, 0.6, true), GLIDE_MAX_FALL);
  // Glide does not slow upward motion.
  assert.equal(stepVelocity(-11.5, 0.6, true), -10.9);
});

test('resolveTap: jump on ground, double jump only when unlocked and available', () => {
  assert.equal(resolveTap(1, { onGround: true, jumpsUsed: 0 }), 'jump');
  // Level 1 has no double jump -> airborne tap does nothing.
  assert.equal(resolveTap(1, { onGround: false, jumpsUsed: 1 }), null);
  // Level 2 -> second jump available.
  assert.equal(resolveTap(2, { onGround: false, jumpsUsed: 1 }), 'doubleJump');
  // No third jump.
  assert.equal(resolveTap(2, { onGround: false, jumpsUsed: 2 }), null);
});
