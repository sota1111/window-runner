// Window Runner — renderer + game loop + input.
// Pure logic lives in core.js; this file wires it to the canvas and pointer.
import {
  STAGES,
  STAGE_COUNT,
  getStage,
  generatePlatforms,
  isOnSolid,
  stepVelocity,
  resolveTap,
  maxJumps,
  isActionUnlocked,
  awardStageClear,
  levelForXp,
  unlockedActions,
  JUMP_VELOCITY,
} from './core.js';

const WIDTH = 480;
const HEIGHT = 270;
const GROUND_Y = 200;      // top surface of platforms, in screen space
const PLAYER_X = 120;      // player's fixed on-screen x
const PLAYER_SIZE = 20;
const STAGE_LENGTH = 4200;
const DASH_MULT = 1.6;

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
    bgOffset: 0,
    animT: 0,
    message: '',
    pointerDown: false,
    pointerDownT: 0,
  };

  function report(kind, extra) {
    if (typeof ui.onEvent === 'function') ui.onEvent(kind, { ...state, ...extra });
  }

  function startStage(index) {
    const stage = getStage(index);
    state.stageIndex = index;
    state.worldX = 0;
    state.playerY = GROUND_Y;
    state.vy = 0;
    state.onGround = true;
    state.jumpsUsed = 0;
    state.gliding = false;
    state.dashing = false;
    state.dead = false;
    state.cleared = false;
    state.segments = generatePlatforms(index, STAGE_LENGTH, 777 + index);
    state.bgOffset = 0;
    state.animT = 0;
    state.running = true;
    state.message = `${stage.name} ステージ`;
    report('stageStart', { stage });
  }

  function restartRun() {
    state.xp = 0;
    state.level = 1;
    startStage(0);
  }

  // --- input ---------------------------------------------------------------
  function onTapStart() {
    if (!state.running) return;
    state.pointerDown = true;
    state.pointerDownT = state.animT;
    if (state.dead || state.cleared) return;
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

    // Long-press → glide (once unlocked and airborne, descending).
    const held = state.pointerDown && state.animT - state.pointerDownT > 8;
    state.gliding = held && !state.onGround && state.vy > 0 && isActionUnlocked(state.level, 'glide');

    // Dash (level 4+) speeds forward scroll while a tap is held on the ground.
    state.dashing = isActionUnlocked(state.level, 'dash') && state.pointerDown && state.onGround;
    const speed = stage.scrollSpeed * (state.dashing ? DASH_MULT : 1);

    state.worldX += speed;
    state.bgOffset = (state.bgOffset + stage.bgSpeed) % 10000;

    // Vertical physics.
    state.vy = stepVelocity(state.vy, stage.gravity, state.gliding);
    state.playerY += state.vy;

    const footX = state.worldX + PLAYER_X;
    const overSolid = isOnSolid(state.segments, footX);

    if (state.playerY >= GROUND_Y) {
      if (overSolid) {
        // Land on platform.
        state.playerY = GROUND_Y;
        state.vy = 0;
        state.onGround = true;
        state.jumpsUsed = 0;
        state.gliding = false;
      } else {
        // Over a gap and at/below surface → keep falling (miss).
        state.onGround = false;
        if (state.playerY > HEIGHT + 60) {
          state.dead = true;
          state.running = false;
          state.message = 'ミス！ タップでリトライ';
          report('dead');
          return;
        }
      }
    } else {
      state.onGround = false;
    }

    // Reached the end of the stage → clear + level up.
    if (state.worldX >= STAGE_LENGTH - PLAYER_X - PLAYER_SIZE) {
      state.cleared = true;
      state.running = false;
      const prog = awardStageClear(state.xp);
      state.xp = prog.xp;
      state.level = prog.level;
      state.message = prog.leveledUp
        ? `クリア！ Lv.${state.level} — ${ACTION_LABELS[prog.unlocked] || '成長'} 解放！`
        : `クリア！ 経験値 +100`;
      report('clear', { prog });
    }
  }

  // --- rendering -----------------------------------------------------------
  function drawBackground(stage) {
    ctx.fillStyle = stage.sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // Parallax layers: far shapes scroll slower than near ones.
    const layers = [
      { speed: 0.3, y: 70, size: 46, color: shade(stage.accent, -0.15), gap: 150 },
      { speed: 0.6, y: 110, size: 34, color: stage.accent, gap: 110 },
    ];
    for (const l of layers) {
      const off = (state.bgOffset * l.speed) % l.gap;
      ctx.fillStyle = l.color;
      for (let x = -l.gap; x < WIDTH + l.gap; x += l.gap) {
        const px = x - off;
        if (stage.id === 'space') {
          ctx.fillRect(px + 10, l.y - 10, 3, 3);
          ctx.fillRect(px + 60, l.y + 20, 2, 2);
        } else if (stage.id === 'airplane') {
          cloud(px, l.y, l.size);
        } else if (stage.id === 'shinkansen') {
          ctx.fillRect(px, l.y + l.size / 2, l.gap * 0.7, 3); // speed lines
        } else {
          ctx.fillRect(px, l.y - l.size, l.size * 0.5, l.size); // buildings/poles
        }
      }
    }
  }

  function cloud(x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, s * 0.4, 0, Math.PI * 2);
    ctx.arc(x + s * 0.4, y + 4, s * 0.5, 0, Math.PI * 2);
    ctx.arc(x + s * 0.9, y, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTerrain(stage) {
    ctx.fillStyle = stage.ground;
    for (const seg of state.segments) {
      const sx = seg.start - state.worldX;
      const ex = seg.end - state.worldX;
      if (ex < 0 || sx > WIDTH) continue;
      ctx.fillRect(sx, GROUND_Y + PLAYER_SIZE, ex - sx, HEIGHT - GROUND_Y);
      ctx.fillStyle = shade(stage.ground, 0.15);
      ctx.fillRect(sx, GROUND_Y + PLAYER_SIZE, ex - sx, 4);
      ctx.fillStyle = stage.ground;
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
    drawTerrain(stage);
    drawPlayer();
    drawHud(stage);
    if (typeof ui.onFrame === 'function') {
      ui.onFrame({ level: state.level, stage, actions: unlockedActions(state.level) });
    }
  }

  // Advance one stage after a clear (loops through vehicles); retry after death.
  function advance() {
    if (state.cleared) {
      startStage((state.stageIndex + 1) % STAGE_COUNT);
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
      restartRun();
      if (!raf) frame();
    },
    step,      // exposed for tests/headless stepping
    render,
    advance,
    onTapStart,
    onTapEnd,
    startStage,
    attachInput,
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    },
  };
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
