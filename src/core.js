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

// Build platform segments in world-space for a stage.
// Returns an array of { start, end } (end exclusive), covering [0, length).
// The first and last segments are always solid landing zones. Gaps are sized
// as a fraction of the stage's jump reach so they are always crossable, and
// they get wider (harder) at higher vehicle speeds via `gapChance`.
export function generatePlatforms(stageIndex, length = 4000, seed = 12345) {
  const stage = getStage(stageIndex);
  const rng = mulberry32(seed + stageIndex * 1013);
  const reach = jumpReach(stageIndex);
  const minGap = reach * 0.28;
  const maxGap = reach * (0.42 + stage.gapChance * 0.5); // never exceeds ~0.6 reach
  const segments = [];
  const startLen = 420; // guaranteed safe start
  segments.push({ start: 0, end: startLen });
  let x = startLen;
  const endSafe = length - 360; // guaranteed safe finish
  while (x < endSafe) {
    const gap = minGap + rng() * (maxGap - minGap);
    const plat = 190 + Math.floor(rng() * 200);
    const platStart = Math.min(x + gap, endSafe);
    const platEnd = Math.min(platStart + plat, endSafe);
    segments.push({ start: platStart, end: platEnd });
    x = platEnd;
    // (x_prev .. platStart is intentionally left uncovered = the gap)
  }
  segments.push({ start: endSafe, end: length });
  return segments;
}

// Is world-x over solid ground (true) or over a gap (false)?
export function isOnSolid(segments, x) {
  for (const s of segments) {
    if (x >= s.start && x < s.end) return true;
  }
  return false;
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
