// Window Runner — renderer + game loop + input.
// Pure logic lives in core.js; this file wires it to the canvas and pointer.
import {
  STAGES,
  STAGE_COUNT,
  getStage,
  isStageUnlocked,
  selectableStages as coreSelectableStages,
  nextHighestCleared,
  INTRO_FRAMES,
  INTRO_EXTERIOR_FRAMES,
  isIntroActive,
  introPhase,
  boardingProgress,
  generatePlatforms,
  segmentIndexAt,
  stepVelocity,
  resolveTap,
  maxJumps,
  isActionUnlocked,
  levelForXp,
  unlockedActions,
  JUMP_VELOCITY,
  XP_PER_STAGE,
} from './core.js';

const WIDTH = 480;
const HEIGHT = 270;
const GROUND_Y = 200;      // top surface of platforms, in screen space
const PLAYER_X = 120;      // player's fixed on-screen x
const PLAYER_SIZE = 20;
const STAGE_LENGTH = 4200;
const DASH_MULT = 1.6;
const PROGRESS_KEY = 'window-runner:progress';

const ACTION_LABELS = {
  jump: 'ジャンプ',
  doubleJump: '二段ジャンプ',
  glide: 'パラシュート滑空',
  dash: '高速ダッシュ',
  wallKick: '壁キック',
};

export function createGame(canvas, ui = {}) {
  const ctx = canvas.getContext('2d');
  const state = {
    xp: 0,
    level: 1,
    stageIndex: 0,
    highestCleared: loadProgress(),
    mode: 'home',
    running: false,
    // per-run
    worldX: 0,
    playerY: GROUND_Y,
    vy: 0,
    onGround: true,
    jumpsUsed: 0,
    gliding: false,
    dashing: false,
    dead: false,
    cleared: false,
    segments: [],
    lastSegId: 0,  // platform the player was last over (for cliff-face collision)
    lastRise: 0,   // elevation of that platform
    bgOffset: 0,
    animT: 0,
    introT: 0,
    message: '',
    pointerDown: false,
    pointerDownT: 0,
  };

  function report(kind, extra) {
    if (typeof ui.onEvent === 'function') ui.onEvent(kind, { ...state, ...extra });
  }

  function levelForProgress(highestCleared) {
    return levelForXp((highestCleared + 1) * XP_PER_STAGE);
  }

  function progressXp(highestCleared) {
    return Math.max(0, highestCleared + 1) * XP_PER_STAGE;
  }

  function stageList() {
    return STAGES.map((stage, index) => ({
      ...stage,
      index,
      unlocked: isStageUnlocked(index, state.highestCleared),
      cleared: index <= state.highestCleared,
    }));
  }

  function notifyHome() {
    if (typeof ui.onHome === 'function') {
      ui.onHome({
        stages: stageList(),
        selectable: coreSelectableStages(state.highestCleared),
        highestCleared: state.highestCleared,
      });
    }
  }

  function enterHome() {
    state.mode = 'home';
    state.running = false;
    state.pointerDown = false;
    state.gliding = false;
    state.dashing = false;
    state.level = levelForProgress(state.highestCleared);
    state.xp = progressXp(state.highestCleared);
    state.message = '';
    notifyHome();
    report('home');
  }

  function persistProgress() {
    try {
      globalThis.localStorage?.setItem(PROGRESS_KEY, String(state.highestCleared));
    } catch {
      // localStorage can be unavailable in private or headless environments.
    }
  }

  function startStage(index) {
    const stage = getStage(index);
    state.mode = 'playing';
    state.stageIndex = index;
    state.xp = progressXp(state.highestCleared);
    state.level = levelForProgress(state.highestCleared);
    state.worldX = 0;
    state.playerY = GROUND_Y;
    state.vy = 0;
    state.onGround = true;
    state.jumpsUsed = 0;
    state.gliding = false;
    state.dashing = false;
    state.dead = false;
    state.cleared = false;
    state.segments = generatePlatforms(index, STAGE_LENGTH, 777 + index, state.level);
    state.lastSegId = 0;
    state.lastRise = 0;
    state.bgOffset = 0;
    state.animT = 0;
    state.introT = INTRO_FRAMES;
    state.running = true;
    state.message = `${stage.name} ステージ - 発車！`;
    report('stageStart', { stage });
  }

  function selectStage(index) {
    if (!isStageUnlocked(index, state.highestCleared)) return false;
    startStage(index);
    return true;
  }

  // --- input ---------------------------------------------------------------
  function onTapStart() {
    if (!state.running) return;
    state.pointerDown = true;
    state.pointerDownT = state.animT;
    if (state.dead || state.cleared) return;
    if (isIntroActive(state.introT)) {
      state.introT = 0;
      state.message = '';
      state.pointerDown = false;
      return;
    }
    const action = resolveTap(state.level, { onGround: state.onGround, jumpsUsed: state.jumpsUsed });
    if (action === 'jump') {
      state.vy = JUMP_VELOCITY;
      state.onGround = false;
      state.jumpsUsed = 1;
      report('jump');
    } else if (action === 'doubleJump') {
      state.vy = JUMP_VELOCITY * 0.92;
      state.jumpsUsed += 1;
      report('doubleJump');
    }
  }

  function onTapEnd() {
    state.pointerDown = false;
    state.gliding = false;
  }

  // --- simulation ----------------------------------------------------------
  function step() {
    if (!state.running) return;
    state.animT += 1;
    const stage = getStage(state.stageIndex);

    if (state.dead || state.cleared) return;

    if (isIntroActive(state.introT)) {
      state.bgOffset = (state.bgOffset + stage.bgSpeed) % 10000;
      state.introT -= 1;
      if (!isIntroActive(state.introT)) state.message = '';
      return;
    }

    // Long-press → glide (once unlocked and airborne, descending).
    const held = state.pointerDown && state.animT - state.pointerDownT > 8;
    state.gliding = held && !state.onGround && state.vy > 0 && isActionUnlocked(state.level, 'glide');

    // Dash (level 4+) speeds forward scroll while a tap is held on the ground.
    state.dashing = isActionUnlocked(state.level, 'dash') && state.pointerDown && state.onGround;
    const speed = stage.scrollSpeed * (state.dashing ? DASH_MULT : 1);

    state.worldX += speed;
    state.bgOffset = (state.bgOffset + stage.bgSpeed) % 10000;

    // Vertical physics. `prevY` is the foot height BEFORE this frame's gravity —
    // used to tell "descended onto a cliff top" from "smacked into its face".
    const prevY = state.playerY;
    state.vy = stepVelocity(state.vy, stage.gravity, state.gliding);
    state.playerY += state.vy;

    const footX = state.worldX + PLAYER_X;
    const segId = segmentIndexAt(state.segments, footX);
    const overSolid = segId >= 0;
    const surfaceY = overSolid ? GROUND_Y - (state.segments[segId].rise || 0) : GROUND_Y;

    if (overSolid) {
      // Cliff-face collision: entering a NEW, higher platform whose ledge the
      // player's feet passed below → they hit the wall instead of landing on
      // top. We interpolate the foot height at exactly the ledge x (the corner)
      // so a jump that just clears it isn't wrongly killed a frame early.
      if (segId !== state.lastSegId) {
        const rise = state.segments[segId].rise || 0;
        if (rise > state.lastRise) {
          const segStart = state.segments[segId].start;
          const frac = speed > 0 ? Math.max(0, Math.min(1, (segStart - (footX - speed)) / speed)) : 1;
          const yAtCorner = prevY + frac * (state.playerY - prevY);
          if (yAtCorner > surfaceY + 1) {
            state.dead = true;
            state.running = false;
            state.message = 'ミス！ タップでリトライ';
            report('dead');
            return;
          }
        }
        state.lastSegId = segId;
        state.lastRise = rise;
      }
      if (state.playerY >= surfaceY) {
        // Land on the platform surface (which may be elevated).
        state.playerY = surfaceY;
        state.vy = 0;
        state.onGround = true;
        state.jumpsUsed = 0;
        state.gliding = false;
      } else {
        // Airborne above the platform.
        state.onGround = false;
      }
    } else {
      // Over a gap → keep falling (miss once well below the screen).
      state.onGround = false;
      if (state.playerY > HEIGHT + 60) {
        state.dead = true;
        state.running = false;
        state.message = 'ミス！ タップでリトライ';
        report('dead');
        return;
      }
    }

    // Reached the end of the stage → clear + level up.
    if (state.worldX >= STAGE_LENGTH - PLAYER_X - PLAYER_SIZE) {
      state.cleared = true;
      state.running = false;
      const previousHighestCleared = state.highestCleared;
      const beforeLevel = state.level;
      state.highestCleared = nextHighestCleared(state.highestCleared, state.stageIndex);
      persistProgress();
      state.xp = progressXp(state.highestCleared);
      state.level = levelForProgress(state.highestCleared);
      const newlyUnlocked = unlockedActions(state.level).find((action) => !unlockedActions(beforeLevel).includes(action));
      const prog = {
        xp: state.xp,
        level: state.level,
        leveledUp: state.level > beforeLevel,
        unlocked: newlyUnlocked || null,
      };
      const firstClear = state.highestCleared > previousHighestCleared;
      state.message = prog.leveledUp
        ? `クリア！ Lv.${state.level} — ${ACTION_LABELS[newlyUnlocked] || '成長'} 解放！`
        : firstClear ? `クリア！ ステージ解放` : `クリア！`;
      report('clear', { prog, highestCleared: state.highestCleared });
    }
  }

  // --- rendering -----------------------------------------------------------
  function drawBackground(stage) {
    ctx.fillStyle = stage.sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (stage.id === 'space') {
      drawStars();
      drawOrbitingPlanets(stage);
      drawSpeedLines('#7ad7ff', 0.35, 120, 2);
      return;
    }

    if (stage.id === 'airplane') {
      drawSun(410, 45, 18, '#fff3a6');
      drawCloudLayer(0.18, 60, 60, 'rgba(255,255,255,0.82)');
      drawCloudLayer(0.42, 116, 46, 'rgba(255,255,255,0.68)');
      drawCloudLayer(0.86, 176, 34, 'rgba(255,255,255,0.45)');
      drawSpeedLines('#d8f3ff', 0.28, 150, 1.4);
      return;
    }

    drawSun(398, 42, 15, 'rgba(255,245,172,0.85)');
    if (stage.id === 'walk') {
      drawCloudLayer(0.2, 44, 38, 'rgba(255,255,255,0.7)');
      drawBuildingLayer(0.28, 132, 56, 74, '#9fc47b');
      drawTreeLayer(0.58, 158, '#417543');
      drawPassingSigns(stage, 1.0);
    } else if (stage.id === 'car') {
      drawBuildingLayer(0.22, 116, 46, 90, '#8eb5c8');
      drawBuildingLayer(0.48, 150, 34, 70, '#6f8f9e');
      drawRoadTraffic(stage);
      drawUtilityPoles(0.95, '#4f5960');
    } else if (stage.id === 'train') {
      drawBuildingLayer(0.22, 108, 42, 88, '#89b7c7');
      drawUtilityPoles(0.72, '#44515a');
      drawOpposingTrain(stage, 0.95);
    } else if (stage.id === 'shinkansen') {
      drawMountainLayer(0.16, 125, '#8db7d7');
      drawBuildingLayer(0.38, 142, 24, 52, '#7fa8c7');
      drawSpeedLines('#e7f6ff', 0.72, 84, 2.5);
      drawOpposingTrain(stage, 1.25);
    }
  }

  function cloud(x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, s * 0.4, 0, Math.PI * 2);
    ctx.arc(x + s * 0.4, y + 4, s * 0.5, 0, Math.PI * 2);
    ctx.arc(x + s * 0.9, y, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSun(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCloudLayer(speed, y, size, color) {
    const gap = size * 3.4;
    const off = (state.bgOffset * speed) % gap;
    ctx.fillStyle = color;
    for (let x = -gap; x < WIDTH + gap; x += gap) {
      cloud(x - off, y + Math.sin((state.animT + x) * 0.012) * 2, size);
    }
  }

  function drawBuildingLayer(speed, baseY, minW, maxH, color) {
    const gap = minW * 1.55;
    const off = (state.bgOffset * speed) % gap;
    for (let x = -gap; x < WIDTH + gap; x += gap) {
      const px = x - off;
      const h = 34 + ((Math.floor(x / gap) * 29) % maxH);
      const w = minW + ((Math.floor(x / gap) * 13) % 28);
      ctx.fillStyle = color;
      ctx.fillRect(px, baseY - h, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      for (let wx = px + 6; wx < px + w - 4; wx += 14) {
        ctx.fillRect(wx, baseY - h + 10, 5, 6);
        ctx.fillRect(wx, baseY - h + 24, 5, 6);
      }
    }
  }

  function drawTreeLayer(speed, baseY, color) {
    const gap = 58;
    const off = (state.bgOffset * speed) % gap;
    for (let x = -gap; x < WIDTH + gap; x += gap) {
      const px = x - off;
      ctx.fillStyle = '#6d4a31';
      ctx.fillRect(px + 14, baseY - 24, 5, 24);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px + 16, baseY - 30, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawUtilityPoles(speed, color) {
    const gap = 86;
    const off = (state.bgOffset * speed) % gap;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let x = -gap; x < WIDTH + gap; x += gap) {
      const px = x - off;
      ctx.beginPath();
      ctx.moveTo(px, 72);
      ctx.lineTo(px, GROUND_Y + PLAYER_SIZE);
      ctx.moveTo(px - 13, 92);
      ctx.lineTo(px + 13, 92);
      ctx.moveTo(px - 18, 104);
      ctx.lineTo(px + 18, 98);
      ctx.stroke();
    }
  }

  function drawRoadTraffic(stage) {
    const gap = 190;
    const off = (state.bgOffset * 1.35 + state.animT * 1.1) % gap;
    for (let x = -gap; x < WIDTH + gap; x += gap) {
      const px = WIDTH - (x + off);
      ctx.fillStyle = shade(stage.accent, -0.12);
      ctx.fillRect(px, 156, 50, 14);
      ctx.fillStyle = '#dceeff';
      ctx.fillRect(px + 8, 150, 22, 8);
      wheel(px + 10, 171, 5);
      wheel(px + 39, 171, 5);
    }
  }

  function drawOpposingTrain(stage, speed) {
    const gap = 300;
    const off = (state.bgOffset * speed + state.animT * 0.9) % gap;
    const y = 145;
    for (let x = -gap; x < WIDTH + gap; x += gap) {
      const px = WIDTH - (x + off);
      ctx.fillStyle = stage.id === 'train' ? '#f2e9d5' : '#f7fbff';
      roundedRectPath(px, y, 138, 24, 9);
      ctx.fill();
      ctx.fillStyle = stage.accent;
      ctx.fillRect(px + 7, y + 16, 122, 3);
      ctx.fillStyle = '#6ca8c8';
      for (let wx = px + 16; wx < px + 112; wx += 24) ctx.fillRect(wx, y + 6, 14, 7);
    }
  }

  function drawMountainLayer(speed, baseY, color) {
    const gap = 160;
    const off = (state.bgOffset * speed) % gap;
    ctx.fillStyle = color;
    for (let x = -gap; x < WIDTH + gap; x += gap) {
      const px = x - off;
      ctx.beginPath();
      ctx.moveTo(px, baseY);
      ctx.lineTo(px + 70, baseY - 54);
      ctx.lineTo(px + 150, baseY);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawSpeedLines(color, speed, gap, width) {
    const off = (state.bgOffset * speed + state.animT * speed) % gap;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (let x = -gap; x < WIDTH + gap; x += gap) {
      const px = x - off;
      ctx.beginPath();
      ctx.moveTo(px, 58 + ((x / gap) % 5) * 22);
      ctx.lineTo(px + 56, 58 + ((x / gap) % 5) * 22);
      ctx.stroke();
    }
  }

  function drawStars() {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 48; i += 1) {
      const x = (i * 73 - state.bgOffset * (0.18 + (i % 3) * 0.08)) % (WIDTH + 24);
      const y = 24 + ((i * 41) % 150);
      const s = 1 + (i % 3);
      ctx.fillRect((x + WIDTH + 24) % (WIDTH + 24) - 12, y, s, s);
    }
  }

  function drawOrbitingPlanets(stage) {
    const wobble = Math.sin(state.animT * 0.025);
    ctx.fillStyle = shade(stage.accent, -0.08);
    ctx.beginPath();
    ctx.arc(365, 76 + wobble * 5, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(365, 76 + wobble * 5, 34, 8, -0.25, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawPassingSigns(stage, speed) {
    const gap = 135;
    const off = (state.bgOffset * speed) % gap;
    for (let x = -gap; x < WIDTH + gap; x += gap) {
      const px = x - off;
      ctx.fillStyle = shade(stage.accent, -0.15);
      ctx.fillRect(px, 144, 26, 18);
      ctx.fillStyle = '#f4f7ec';
      ctx.fillRect(px + 3, 148, 20, 3);
      ctx.fillRect(px + 3, 154, 14, 3);
    }
  }

  function drawTerrain(stage) {
    for (const seg of state.segments) {
      const sx = seg.start - state.worldX;
      const ex = seg.end - state.worldX;
      if (ex < 0 || sx > WIDTH) continue;
      const width = ex - sx;
      const rise = seg.rise || 0;
      const top = GROUND_Y - rise + PLAYER_SIZE; // surface of this (maybe raised) platform
      // Platform body (extends to the bottom so a raised platform reads as a cliff).
      ctx.fillStyle = stage.ground;
      ctx.fillRect(sx, top, width, HEIGHT - top);
      // Cliff-face shading down the front edge of a raised platform.
      if (rise > 0) {
        ctx.fillStyle = shade(stage.ground, -0.22);
        ctx.fillRect(sx, top, Math.min(6, width), HEIGHT - top);
      }
      // Surface highlight line.
      ctx.fillStyle = shade(stage.ground, 0.15);
      ctx.fillRect(sx, top, width, 4);
      drawStageStructure(stage, sx, width, top);
      ctx.fillStyle = stage.ground;
    }
  }

  function drawStageStructure(stage, sx, width, topY = GROUND_Y + PLAYER_SIZE) {
    const top = topY;
    if (stage.structure === 'promenade') {
      ctx.fillStyle = shade(stage.ground, 0.28);
      for (let x = sx + 10; x < sx + width; x += 34) {
        ctx.fillRect(x, top + 4, 20, 3);
        ctx.fillRect(x + 2, top + 11, 14, 2);
      }
      return;
    }

    if (stage.structure === 'guardrail') {
      ctx.strokeStyle = '#d8e1e6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, top + 6);
      ctx.lineTo(sx + width, top + 6);
      ctx.moveTo(sx, top + 15);
      ctx.lineTo(sx + width, top + 15);
      ctx.stroke();
      ctx.fillStyle = '#b4c0c8';
      for (let x = sx + 8; x < sx + width; x += 30) ctx.fillRect(x, top + 4, 4, 18);
      return;
    }

    if (stage.structure === 'rail') {
      ctx.strokeStyle = '#cfd6db';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, top + 7);
      ctx.lineTo(sx + width, top + 7);
      ctx.moveTo(sx, top + 22);
      ctx.lineTo(sx + width, top + 22);
      ctx.stroke();
      ctx.fillStyle = '#8a6a4a';
      for (let x = sx + 4; x < sx + width; x += 22) ctx.fillRect(x, top + 5, 5, 22);
      return;
    }

    if (stage.structure === 'soundwall') {
      ctx.fillStyle = 'rgba(210,228,238,0.8)';
      for (let x = sx; x < sx + width; x += 28) {
        ctx.fillRect(x, top - 22, 22, 22);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(x + 3, top - 18, 16, 3);
        ctx.fillStyle = 'rgba(210,228,238,0.8)';
      }
      return;
    }

    if (stage.structure === 'runway') {
      ctx.fillStyle = '#ffffff';
      for (let x = sx + 14; x < sx + width; x += 58) ctx.fillRect(x, top + 10, 28, 4);
      ctx.fillStyle = '#f6d55c';
      ctx.fillRect(sx, top + 2, width, 2);
      return;
    }

    if (stage.structure === 'catwalk') {
      ctx.strokeStyle = '#9fd9ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, top + 6);
      ctx.lineTo(sx + width, top + 6);
      ctx.moveTo(sx, top + 24);
      ctx.lineTo(sx + width, top + 24);
      for (let x = sx; x < sx + width; x += 24) {
        ctx.moveTo(x, top + 5);
        ctx.lineTo(x + 18, top + 25);
      }
      ctx.stroke();
    }
  }

  function drawPlayer() {
    const y = state.playerY;
    const t = state.animT;
    ctx.save();
    ctx.translate(PLAYER_X, y);
    ctx.fillStyle = '#ff5a8a';
    // body
    ctx.fillRect(-PLAYER_SIZE / 2, -PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
    // eye
    ctx.fillStyle = '#fff';
    ctx.fillRect(2, -PLAYER_SIZE + 4, 5, 5);
    ctx.fillStyle = '#222';
    ctx.fillRect(4, -PLAYER_SIZE + 6, 2, 2);
    // legs: running cycle when grounded, tucked when airborne
    ctx.fillStyle = '#c23a63';
    if (state.onGround && !state.dead) {
      const swing = Math.sin(t * 0.6) * 5;
      ctx.fillRect(-6, -2, 4, 6 + swing);
      ctx.fillRect(3, -2, 4, 6 - swing);
    } else if (state.gliding) {
      // parachute
      ctx.strokeStyle = '#3a7bd5';
      ctx.beginPath();
      ctx.arc(0, -PLAYER_SIZE - 14, 16, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-14, -PLAYER_SIZE - 14);
      ctx.lineTo(-6, -PLAYER_SIZE);
      ctx.moveTo(14, -PLAYER_SIZE - 14);
      ctx.lineTo(6, -PLAYER_SIZE);
      ctx.stroke();
    } else {
      ctx.fillRect(-6, -2, 4, 8);
      ctx.fillRect(3, -2, 4, 8);
    }
    if (state.dashing) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(-PLAYER_SIZE, -PLAYER_SIZE + 4, 8, 4);
      ctx.fillRect(-PLAYER_SIZE - 8, -PLAYER_SIZE + 12, 10, 4);
    }
    ctx.restore();
  }

  function roundedRectPath(x, y, w, h, r, begin = true) {
    const radius = Math.min(r, w / 2, h / 2);
    if (begin) ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    ctx.lineTo(x + radius, y + h);
    ctx.arcTo(x, y + h, x, y + h - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }

  function drawWindowFrame(stage, options = {}) {
    const frame = 17;
    const radius = 18;
    const innerX = frame;
    const innerY = frame + 1;
    const innerW = WIDTH - frame * 2;
    const innerH = HEIGHT - frame * 2 - 2;
    const frameColor = shade(stage.ground, -0.58);
    const frameEdge = shade(stage.ground, -0.78);
    const sillColor = shade(stage.ground, 0.25);
    const progress = options.progress ?? 1;
    const scale = options.scale ?? 1;
    const alpha = options.alpha ?? 1;

    ctx.save();
    ctx.globalAlpha *= alpha;
    if (scale !== 1) {
      ctx.translate(WIDTH / 2, HEIGHT / 2);
      ctx.scale(scale, scale);
      ctx.translate(-WIDTH / 2, -HEIGHT / 2);
    }
    ctx.beginPath();
    ctx.rect(0, 0, WIDTH, HEIGHT);
    roundedRectPath(innerX, innerY, innerW, innerH, radius, false);
    ctx.fillStyle = frameColor;
    ctx.fill('evenodd');

    ctx.lineWidth = 3;
    ctx.strokeStyle = frameEdge;
    roundedRectPath(innerX + 1.5, innerY + 1.5, innerW - 3, innerH - 3, radius - 2);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = sillColor;
    roundedRectPath(innerX + 5, innerY + 5, innerW - 10, innerH - 10, radius - 5);
    ctx.stroke();

    roundedRectPath(innerX + 3, innerY + 3, innerW - 6, innerH - 6, radius - 4);
    ctx.clip();

    const glass = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    glass.addColorStop(0, 'rgba(255,255,255,0.22)');
    glass.addColorStop(0.18, 'rgba(255,255,255,0.05)');
    glass.addColorStop(0.42, 'rgba(255,255,255,0)');
    ctx.fillStyle = glass;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = `rgba(255,255,255,${0.08 + progress * 0.08})`;
    ctx.beginPath();
    ctx.moveTo(58, 20);
    ctx.lineTo(148, 20);
    ctx.lineTo(326, HEIGHT - 20);
    ctx.lineTo(254, HEIGHT - 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawIntro(stage) {
    const phase = introPhase(state.introT);
    if (phase === 'play') return false;

    if (phase === 'exterior') {
      const progress = Math.max(0, Math.min(1, (INTRO_FRAMES - state.introT) / INTRO_EXTERIOR_FRAMES));
      drawExteriorGround(stage);
      drawVehicleExterior(stage, progress);
      drawIntroCaption(`${stage.name}ステージへ移動中`);
      return true;
    }

    const progress = boardingProgress(state.introT);
    drawTerrain(stage);
    drawPlayer();
    ctx.fillStyle = `rgba(0,0,0,${0.18 * (1 - progress)})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawWindowFrame(stage, {
      progress,
      scale: 0.62 + progress * 0.38,
      alpha: 0.38 + progress * 0.62,
    });
    drawIntroCaption('車内の窓へ');
    return true;
  }

  function drawExteriorGround(stage) {
    const y = GROUND_Y + PLAYER_SIZE + 4;
    ctx.fillStyle = shade(stage.ground, -0.08);
    ctx.fillRect(0, y, WIDTH, HEIGHT - y);
    drawStageStructure(stage, -20, WIDTH + 40);
  }

  function drawVehicleExterior(stage, progress) {
    const x = WIDTH + 70 - progress * (WIDTH + 190);
    const y = stage.id === 'airplane' ? 96 : stage.id === 'space' ? 104 : 132;
    ctx.save();
    ctx.translate(x, y);

    if (stage.id === 'walk') {
      drawBus(stage);
    } else if (stage.id === 'car') {
      drawCar(stage);
    } else if (stage.id === 'train') {
      drawTrain(stage, 148);
    } else if (stage.id === 'shinkansen') {
      drawShinkansen(stage);
    } else if (stage.id === 'airplane') {
      drawAirplane(stage);
    } else if (stage.id === 'space') {
      drawShuttle(stage);
    }
    ctx.restore();
  }

  function drawBus(stage) {
    ctx.fillStyle = shade(stage.accent, -0.08);
    roundedRectPath(0, 0, 126, 45, 8);
    ctx.fill();
    drawVehicleWindows(14, 9, 74, 13, 4);
    ctx.fillStyle = '#f6f2d8';
    ctx.fillRect(93, 11, 21, 26);
    wheel(25, 48, 8);
    wheel(101, 48, 8);
  }

  function drawCar(stage) {
    ctx.fillStyle = stage.accent;
    roundedRectPath(0, 16, 105, 30, 10);
    ctx.fill();
    ctx.fillStyle = shade(stage.accent, 0.28);
    roundedRectPath(24, 2, 48, 24, 8);
    ctx.fill();
    drawVehicleWindows(30, 7, 34, 10, 2);
    wheel(23, 47, 8);
    wheel(82, 47, 8);
  }

  function drawTrain(stage, length) {
    ctx.fillStyle = '#f4eee2';
    roundedRectPath(0, 2, length, 42, 12);
    ctx.fill();
    ctx.fillStyle = stage.accent;
    ctx.fillRect(7, 31, length - 14, 5);
    drawVehicleWindows(17, 11, length - 48, 13, 5);
    wheel(28, 47, 5);
    wheel(length - 30, 47, 5);
  }

  function drawShinkansen(stage) {
    ctx.fillStyle = '#f8fbff';
    ctx.beginPath();
    ctx.moveTo(0, 41);
    ctx.quadraticCurveTo(40, 0, 148, 4);
    ctx.quadraticCurveTo(171, 9, 180, 28);
    ctx.lineTo(170, 43);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = stage.accent;
    ctx.fillRect(34, 29, 118, 4);
    drawVehicleWindows(46, 13, 72, 10, 5);
  }

  function drawAirplane(stage) {
    ctx.fillStyle = '#f7fbff';
    ctx.beginPath();
    ctx.ellipse(86, 26, 86, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(stage.accent, -0.12);
    ctx.beginPath();
    ctx.moveTo(64, 34);
    ctx.lineTo(18, 68);
    ctx.lineTo(105, 43);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(135, 6, 22, 27);
    drawVehicleWindows(45, 20, 68, 5, 8);
  }

  function drawShuttle(stage) {
    ctx.fillStyle = '#edf7ff';
    ctx.beginPath();
    ctx.moveTo(0, 29);
    ctx.quadraticCurveTo(34, -10, 118, 8);
    ctx.quadraticCurveTo(150, 16, 164, 34);
    ctx.lineTo(72, 48);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = stage.accent;
    ctx.fillRect(38, 24, 74, 5);
    ctx.fillStyle = '#74d7ff';
    ctx.fillRect(52, 12, 28, 10);
    ctx.fillStyle = 'rgba(255,180,80,0.8)';
    ctx.beginPath();
    ctx.moveTo(-10, 30);
    ctx.lineTo(-36, 20 + Math.sin(state.animT * 0.3) * 6);
    ctx.lineTo(-10, 42);
    ctx.fill();
  }

  function drawVehicleWindows(x, y, width, height, count) {
    const gap = width / count;
    ctx.fillStyle = '#78b9d8';
    for (let i = 0; i < count; i += 1) {
      roundedRectPath(x + i * gap, y, gap - 5, height, 3);
      ctx.fill();
    }
  }

  function wheel(x, y, r) {
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b8c3ca';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawIntroCaption(text) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    ctx.fillRect(0, HEIGHT - 42, WIDTH, 27);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, WIDTH / 2, HEIGHT - 24);
    ctx.textAlign = 'left';
  }

  function drawHud(stage) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, WIDTH, 22);
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Lv.${state.level}  ${stage.name}  Stage ${state.stageIndex + 1}/${STAGE_COUNT}`, 8, 15);
    ctx.textAlign = 'right';
    const pct = Math.min(100, Math.round((state.worldX / STAGE_LENGTH) * 100));
    ctx.fillText(`${pct}%`, WIDTH - 8, 15);
    ctx.textAlign = 'left';
    if (state.message) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, HEIGHT / 2 - 16, WIDTH, 30);
      ctx.fillStyle = '#fff';
      ctx.fillText(state.message, WIDTH / 2, HEIGHT / 2 + 5);
      ctx.textAlign = 'left';
    }
  }

  function render() {
    const stage = getStage(state.stageIndex);
    drawBackground(stage);
    if (!drawIntro(stage)) {
      drawTerrain(stage);
      drawPlayer();
      drawWindowFrame(stage);
    }
    drawHud(stage);
    if (typeof ui.onFrame === 'function') {
      ui.onFrame({ level: state.level, stage, actions: unlockedActions(state.level) });
    }
  }

  // After a clear, return to stage select; after a miss, retry the same stage.
  function advance() {
    if (state.cleared) {
      enterHome();
    } else if (state.dead) {
      startStage(state.stageIndex);
    }
  }

  let raf = null;
  function frame() {
    step();
    render();
    raf = requestAnimationFrame(frame);
  }

  function attachInput(target) {
    const down = (e) => {
      e.preventDefault();
      if (state.dead || state.cleared) {
        advance();
      } else {
        onTapStart();
      }
    };
    const up = (e) => {
      e.preventDefault();
      onTapEnd();
    };
    target.addEventListener('pointerdown', down);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    target.addEventListener('pointerleave', up);
  }

  return {
    state,
    start() {
      enterHome();
      if (!raf) frame();
    },
    step,      // exposed for tests/headless stepping
    render,
    advance,
    onTapStart,
    onTapEnd,
    startStage,
    selectStage,
    enterHome,
    selectableStages() {
      return coreSelectableStages(state.highestCleared);
    },
    stageList,
    attachInput,
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    },
  };
}

function loadProgress() {
  try {
    const value = globalThis.localStorage?.getItem(PROGRESS_KEY);
    if (value == null) return -1;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return -1;
    return Math.max(-1, Math.min(STAGE_COUNT - 1, parsed));
  } catch {
    return -1;
  }
}

// Lighten (t>0) or darken (t<0) a hex color.
function shade(hex, t) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (t > 0 ? (255 - c) * t : c * t))));
  r = f(r); g = f(g); b = f(b);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export { STAGES, ACTION_LABELS };
