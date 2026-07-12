// Window Runner — pure game logic (no DOM, no canvas).
// Everything here is deterministic and unit-testable. The renderer/loop in
// src/game.js consumes these helpers.

// --- Stages (vehicles) -----------------------------------------------------
// One stage per "vehicle looked at through the window". Background scroll speed
// and gravity vary so the feel changes as you progress. At least 3 required by
// the Definition of Done; all 6 from the spec are provided.
export const STAGES = [
  { id: 'walk',       name: '徒歩',     bgSpeed: 1.0, scrollSpeed: 3.2, gravity: 0.62, gapChance: 0.16, sky: '#8fd3ff', ground: '#6b8f3a', accent: '#c98a3a', structure: 'promenade' },
  { id: 'car',        name: '車',       bgSpeed: 1.8, scrollSpeed: 4.0, gravity: 0.62, gapChance: 0.22, sky: '#7ec8f2', ground: '#7b7b82', accent: '#d64b4b', structure: 'guardrail' },
  { id: 'train',      name: '電車',     bgSpeed: 2.8, scrollSpeed: 4.8, gravity: 0.62, gapChance: 0.26, sky: '#6bb7e6', ground: '#5a5a63', accent: '#e0a020', structure: 'rail' },
  { id: 'shinkansen', name: '新幹線',   bgSpeed: 4.2, scrollSpeed: 5.8, gravity: 0.62, gapChance: 0.30, sky: '#5aa6dd', ground: '#4a4a52', accent: '#2b7fff', structure: 'soundwall' },
  { id: 'airplane',   name: '飛行機',   bgSpeed: 3.5, scrollSpeed: 5.2, gravity: 0.50, gapChance: 0.28, sky: '#bfe4ff', ground: '#eef4fb', accent: '#9fc6e8', structure: 'runway' },
  { id: 'space',      name: '宇宙',     bgSpeed: 2.0, scrollSpeed: 4.6, gravity: 0.34, gapChance: 0.34, sky: '#0b0b2a', ground: '#3a3a5a', accent: '#f5d76e', structure: 'catwalk' },
];

export const STAGE_COUNT = STAGES.length;
export const INTRO_FRAMES = 84;
export const INTRO_EXTERIOR_FRAMES = 48;
export const INTRO_BOARDING_FRAMES = INTRO_FRAMES - INTRO_EXTERIOR_FRAMES;

export function getStage(index) {
  return STAGES[((index % STAGE_COUNT) + STAGE_COUNT) % STAGE_COUNT];
}

export function isIntroActive(introT) {
  return introT > 0;
}

export function introPhase(introT) {
  if (introT <= 0) return 'play';
  if (introT > INTRO_BOARDING_FRAMES) return 'exterior';
  return 'boarding';
}

export function boardingProgress(introT) {
  if (introT <= 0) return 1;
  if (introPhase(introT) === 'exterior') return 0;
  return Math.max(0, Math.min(1, (INTRO_BOARDING_FRAMES - introT) / INTRO_BOARDING_FRAMES));
}

// --- Cabin interior overlay (乗り物の中から外を覗く画面) ---------------------
// The play scene is framed as the view THROUGH a vehicle's window from inside
// the cabin. Each stage has its own interior: an asymmetric window opening
// (thicker wall at the bottom = dashboard/seat/console) plus a corner radius
// (airplane/space get rounder "porthole" windows). Pure geometry only — the
// renderer in game.js maps these to canvas draws and stage-derived colors.
//
// The framing is deliberately asymmetric so the whole GAMEPLAY column stays
// inside the glass: the player sits at screen-x ≈ 120 and the ground line at
// y ≈ 200, so the opening always spans well past those. Only decorative cabin
// walls live outside the opening — they never occlude the play field.
export const CABIN_STYLES = {
  walk:       { top: 20, side: 22, bottom: 44, radius: 20, console: 'seats' },
  car:        { top: 20, side: 24, bottom: 48, radius: 18, console: 'dashboard' },
  train:      { top: 20, side: 24, bottom: 44, radius: 14, console: 'seats' },
  shinkansen: { top: 20, side: 26, bottom: 46, radius: 16, console: 'seats' },
  airplane:   { top: 22, side: 30, bottom: 42, radius: 40, console: 'seats' },
  space:      { top: 24, side: 32, bottom: 46, radius: 60, console: 'console' },
};

export function cabinStyle(stageId) {
  return CABIN_STYLES[stageId] || CABIN_STYLES.walk;
}

// Window opening rectangle (the glass the outside world is seen through) for a
// stage, given the canvas size. The corner radius is clamped so it never
// exceeds half the smaller side (a degenerate rounded rect).
export function cabinOpening(stageId, width, height) {
  const s = cabinStyle(stageId);
  const x = s.side;
  const y = s.top;
  const w = width - s.side * 2;
  const h = height - s.top - s.bottom;
  const radius = Math.max(0, Math.min(s.radius, w / 2, h / 2));
  return { x, y, w, h, radius };
}

// True when the point (px, py) lies inside a stage's window opening — used to
// assert the gameplay column (player x / ground line y) is never hidden by the
// cabin walls. Ignores corner rounding (a conservative rectangular test).
export function cabinOpeningContains(stageId, px, py, width, height) {
  const o = cabinOpening(stageId, width, height);
  return px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h;
}

export function isStageUnlocked(stageIndex, highestCleared) {
  const cleared = Math.max(-1, highestCleared);
  return Number.isInteger(stageIndex) && stageIndex >= 0 && stageIndex < STAGE_COUNT && stageIndex <= cleared + 1;
}

export function selectableStages(highestCleared) {
  const cleared = Math.max(-1, highestCleared);
  const maxIndex = Math.min(STAGE_COUNT - 1, cleared + 1);
  return Array.from({ length: maxIndex + 1 }, (_, i) => i);
}

export function nextHighestCleared(highestCleared, clearedIndex) {
  return Math.max(highestCleared, clearedIndex);
}

// --- Level & action unlocks ------------------------------------------------
// Actions unlock as the player levels up. Ordering matches the spec §3.2.
export const ACTION_ORDER = ['jump', 'doubleJump', 'glide', 'dash', 'wallKick'];

export const ACTION_UNLOCK_LEVEL = {
  jump: 1,
  doubleJump: 2,
  glide: 3,
  dash: 4,
  wallKick: 5,
};

export const MAX_LEVEL = 5;
export const XP_PER_STAGE = 100;

// XP thresholds: level N reached at (N-1)*XP_PER_STAGE. Capped at MAX_LEVEL.
export function levelForXp(xp) {
  if (xp < 0) xp = 0;
  const lvl = Math.floor(xp / XP_PER_STAGE) + 1;
  return Math.min(lvl, MAX_LEVEL);
}

export function unlockedActions(level) {
  return ACTION_ORDER.filter((a) => ACTION_UNLOCK_LEVEL[a] <= level);
}

export function isActionUnlocked(level, action) {
  const req = ACTION_UNLOCK_LEVEL[action];
  return req !== undefined && level >= req;
}

// Max number of consecutive air jumps available (ground jump + air jumps).
export function maxJumps(level) {
  return isActionUnlocked(level, 'doubleJump') ? 2 : 1;
}

// Award XP for clearing a stage and return the resulting progression.
// Returns { xp, level, leveledUp, unlocked } where `unlocked` is any action
// newly opened by this level-up (or null).
export function awardStageClear(xp, gained = XP_PER_STAGE) {
  const beforeLevel = levelForXp(xp);
  const nextXp = xp + gained;
  const afterLevel = levelForXp(nextXp);
  const leveledUp = afterLevel > beforeLevel;
  let unlocked = null;
  if (leveledUp) {
    unlocked = ACTION_ORDER.find(
      (a) => ACTION_UNLOCK_LEVEL[a] > beforeLevel && ACTION_UNLOCK_LEVEL[a] <= afterLevel,
    ) || null;
  }
  return { xp: nextXp, level: afterLevel, leveledUp, unlocked };
}

// --- Terrain (gaps to jump across) -----------------------------------------
// A stage is a sequence of solid platform segments separated by gaps. The
// player must jump the gaps; falling into one is a miss. Terrain is generated
// deterministically from a seed so runs are reproducible and testable.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Horizontal distance a single jump carries the player before landing, in
// world units. Derived from jump velocity, gravity and forward scroll speed:
// air time = 2*|v0|/g, reach = scrollSpeed * airTime. Used to size gaps so
// every gap is crossable (a gap must be narrower than the jump reach).
export function jumpReach(stageIndex) {
  const stage = getStage(stageIndex);
  const airTime = (2 * Math.abs(JUMP_VELOCITY)) / stage.gravity;
  return stage.scrollSpeed * airTime;
}

// Peak height (world px) a single jump rises above its launch point:
// apex = v0^2 / (2g). Used to size cliffs so every step-up stays within what a
// jump can climb (a double jump climbs ~1.85x this).
export function jumpApex(stageIndex) {
  const stage = getStage(stageIndex);
  return (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * stage.gravity);
}

// --- Difficulty scaling by level -------------------------------------------
// As the player levels up, the LATTER HALF of a stage gets harder: gaps widen
// beyond what the previous level's actions could cross, so clearing them
// requires the traversal action unlocked at the new level. Widths stay within
// what the CURRENT level can cross, so every stage remains beatable.
//
// GAP_CROSS_FACTOR[level] is the widest gap — as a multiple of jumpReach — that
// the actions available at `level` can carry the player across. It is monotonic
// in level and deliberately conservative so generated terrain is always
// traversable with the matching action:
//   1 jump only  · 2 + double jump  · 3 + glide  · 4 + dash  · 5 + wall kick.
export const GAP_CROSS_FACTOR = {
  0: 0, // no actions -> cannot cross any gap
  1: 0.62, // single jump (matches the original safe gap ceiling)
  2: 1.15, // + double jump
  3: 1.95, // + glide (parachute) greatly extends air time
  4: 2.25, // + dash margin
  5: 2.55, // + wall kick margin
};

export function gapCrossFactor(level) {
  const l = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)));
  return GAP_CROSS_FACTOR[l];
}

// Widest gap (world units) the actions unlocked at `level` can clear on a stage.
export function maxCrossableGap(stageIndex, level) {
  return jumpReach(stageIndex) * gapCrossFactor(level);
}

// The action unlocked exactly at `level` — the one the latter half forces —
// or null if no new action opens at that level.
export function requiredActionForLevel(level) {
  return ACTION_ORDER.find((a) => ACTION_UNLOCK_LEVEL[a] === level) || null;
}

// --- Elevation / cliffs (高低差) --------------------------------------------
// As the player levels up, the LATTER HALF also gains vertical challenge: some
// landing platforms are raised into cliffs. The cliff gets taller with level
// (harder timing / air control) but is always kept both:
//   (a) within a double jump's climb (so it stays beatable — the double jump
//       unlocks at Lv.2, exactly when cliffs start appearing), and
//   (b) below MAX_RISE, so the player never leaves the top of the screen.
// Cliffs complement the widening gaps (which force each level's traversal
// action); missing a cliff — not reaching its top — is a miss.
export const MAX_RISE = 104; // tallest cliff (screen px); keeps the player on-screen

// CLIFF_RAMP[level] scales the cliff height as a fraction of a single jump's
// apex. Monotonic in level so higher levels get taller cliffs. Values stay
// <= ~1.05 apex — comfortably inside a double jump's ~1.85 apex reach — so a
// cliff is always mountable once the double jump is unlocked (Lv.2+).
export const CLIFF_RAMP = {
  0: 0,
  1: 0, // single jump only: keep the first stage flat & fair
  2: 0.72,
  3: 0.84,
  4: 0.95,
  5: 1.05,
};

export function cliffRamp(level) {
  const l = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)));
  return CLIFF_RAMP[l];
}

// Height (world/screen px) of a latter-half cliff on a stage at a given level.
// 0 before the double jump unlocks; otherwise apex-scaled, capped by both the
// double-jump climb budget and MAX_RISE so it is always beatable and on-screen.
export function cliffRise(stageIndex, level) {
  const lvl = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)));
  if (lvl < 2) return 0;
  const apex = jumpApex(stageIndex);
  const raw = apex * cliffRamp(lvl);
  return Math.min(raw, apex * 1.05, MAX_RISE);
}

// Build platform segments in world-space for a stage.
// Returns an array of { start, end } (end exclusive), covering [0, length).
// The first and last segments are always solid landing zones. The FIRST half is
// fair single-jump terrain; the LATTER half scales with `level` — its gaps are
// wider than the previous level's actions can cross (so the newly unlocked
// action is required) yet still within the current level's reach (so it stays
// beatable). Terrain is deterministic in (stageIndex, length, seed, level).
export function generatePlatforms(stageIndex, length = 4000, seed = 12345, level = 1) {
  const stage = getStage(stageIndex);
  const rng = mulberry32(seed + stageIndex * 1013);
  const reach = jumpReach(stageIndex);
  // First-half gaps: fair single-jump terrain (as in the original design).
  const easyMinGap = reach * 0.28;
  const easyMaxGap = reach * (0.42 + stage.gapChance * 0.5); // never exceeds ~0.6 reach
  // Latter-half gaps: above the previous level's reach (forces the new action),
  // but within the current level's reach (still crossable).
  const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  const hardMinGap = maxCrossableGap(stageIndex, lvl - 1) * 1.03;
  const hardMaxGap = maxCrossableGap(stageIndex, lvl) * 0.95;
  // Cliff (高低差) height for the latter half at this level (0 before Lv.2).
  const cliffH = cliffRise(stageIndex, lvl);
  const midpoint = length * 0.5;
  const minPlat = 190; // guaranteed landing width after each gap
  const segments = [];
  const startLen = 420; // guaranteed safe start
  segments.push({ start: 0, end: startLen, rise: 0 });
  let x = startLen;
  let rise = 0; // current platform elevation
  let sawLatter = false; // have we started the latter half yet?
  const endSafe = length - 360; // guaranteed safe finish
  while (x < endSafe) {
    const latter = x >= midpoint;
    const firstLatter = latter && !sawLatter;
    if (latter) sawLatter = true;
    // A latter-half transition is either a CLIFF (small gap + step the platform
    // up/down = 高低差) or a WIDE GAP (flat, forces the level's action). The two
    // challenges are never stacked, so each stays within one jump's budget. The
    // first latter transition is always a cliff so every stage shows 高低差.
    const cliffTransition = latter && cliffH > 0 && (firstLatter || rng() < 0.5);
    let lo;
    let hi;
    let nextRise = rise;
    if (cliffTransition) {
      lo = easyMinGap;
      hi = easyMaxGap;
      nextRise = rise > 0 ? 0 : cliffH; // alternate: climb up, then drop back down
    } else if (latter) {
      lo = hardMinGap;
      hi = hardMaxGap;
      nextRise = rise; // horizontal-only challenge -> keep the same height
    } else {
      lo = easyMinGap;
      hi = easyMaxGap;
      nextRise = 0; // first half stays flat & fair
    }
    if (hi < lo) hi = lo; // degenerate guard (e.g. level 1 latter half)
    const gap = lo + rng() * (hi - lo);
    const plat = minPlat + Math.floor(rng() * 200);
    // Stop before a full gap + landing platform no longer fits: never place a
    // runt or oversized gap right before the goal.
    if (x + gap + minPlat > endSafe) break;
    const platStart = x + gap;
    const platEnd = platStart + plat;
    segments.push({ start: platStart, end: platEnd, rise: nextRise });
    rise = nextRise;
    x = platEnd;
    // (x_prev .. platStart is intentionally left uncovered = the gap)
  }
  // Guarantee a flat, ground-level safe finish. If the last platform is a
  // cliff, append a lower finish platform (a trivial step-down over an easy gap)
  // rather than flattening the cliff in place — flattening would leave an
  // easy-gap transition masquerading as a wide-gap one.
  const last = segments[segments.length - 1];
  if ((last.rise || 0) !== 0) {
    const finishStart = Math.min(last.end + easyMinGap, length - 1);
    segments.push({ start: finishStart, end: length, rise: 0 });
  } else {
    last.end = length;
  }
  return segments;
}

// Index of the platform segment covering world-x, or -1 if x is over a gap.
export function segmentIndexAt(segments, x) {
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (x >= s.start && x < s.end) return i;
  }
  return -1;
}

// Elevation (rise, px) of the platform under world-x, or null if over a gap.
export function surfaceRiseAt(segments, x) {
  const i = segmentIndexAt(segments, x);
  return i < 0 ? null : segments[i].rise || 0;
}

// Is world-x over solid ground (true) or over a gap (false)?
export function isOnSolid(segments, x) {
  return segmentIndexAt(segments, x) >= 0;
}

// --- Jump / glide physics --------------------------------------------------
export const JUMP_VELOCITY = -11.5;
export const GLIDE_MAX_FALL = 1.8; // capped downward speed while gliding

// Apply gravity to vertical velocity (optionally gliding to cap fall speed).
export function stepVelocity(vy, gravity, gliding = false) {
  let next = vy + gravity;
  if (gliding && next > GLIDE_MAX_FALL) next = GLIDE_MAX_FALL;
  return next;
}

// Decide what a tap does given the current motion state.
// Returns 'jump' | 'doubleJump' | null.
export function resolveTap(level, { onGround, jumpsUsed }) {
  if (onGround) return 'jump';
  if (isActionUnlocked(level, 'doubleJump') && jumpsUsed < maxJumps(level)) {
    return 'doubleJump';
  }
  return null;
}
