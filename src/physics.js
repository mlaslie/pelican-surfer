import {
  AERIAL_HALF_W,
  AERIAL_RADIUS_Y,
  BASE_SPEED,
  CAMPUS_DIST_STEP,
  COMBO_DECAY_TIME,
  COMBO_MAX_MULT,
  COYOTE_TIME,
  DIST_SCALE,
  DUCK_BLEND_IN,
  DUCK_BLEND_OUT,
  DUCK_DURATION,
  FAST_FALL_LAND_DUCK,
  FAST_FALL_VEL,
  FLAP_ANIM_DURATION,
  FLAP_COOLDOWN,
  FLAP_GLIDE_GRAVITY,
  FLAP_GLIDE_MAX_FALL,
  FLAP_GLIDE_TIME,
  FLAP_MAX_ALTITUDE,
  FLAP_MAX_CHARGES,
  FLAP_MIN_AIR_TIME,
  FLAP_VEL,
  GRAVITY,
  HIGH_GANTRY_TOP_Y,
  HOVER_COST_COINS,
  HOVER_DURATION,
  JUMP_BUFFER_TIME,
  JUMP_VEL,
  LANE_QUEUE_MAX,
  LANE_SWITCH_DURATION,
  LANE_W,
  LOW_HURDLE_CLEAR_Y,
  MAX_SPEED,
  MAX_Z,
  NOOGLER_SPEED,
  OBSTACLE_HIT_HALF_W,
  PLAYER_HALF_Z,
  RAMP_LAUNCH_MAX_VY,
  RAMP_LAUNCH_MIN_VY,
  RAMP_LEN,
  RAMP_SLOPE,
  RESPAWN_INVULN_DURATION,
  RESPAWN_MEDALLIONS_NEEDED,
  ROOF_H,
  SIDE_BUMP_BOUNCE_DURATION,
  SPARKLE_DURATION,
  SPEED_RAMP_PER_M,
  VEHICLE_SUPPORT_HALF_W,
  clamp,
} from './constants.js';
import { CAMPUSES, getCampus } from './campuses.js';
import { SFX, setMusicSpeed } from './audio.js';
import { initProps, spawnWave } from './spawner.js';
import {
  addFloatingText,
  resetRunState,
  saveBestScore,
  snapshotPrevState,
  spawnBurst,
  triggerShake,
} from './state.js';

export function resetGame(gs) {
  resetRunState(gs);
  initProps(gs);
  while (gs.nextWaveZ < MAX_Z + 40) {
    gs.nextWaveZ = spawnWave(gs, gs.nextWaveZ);
  }
  snapshotPrevState(gs);
}

function startLaneTransition(gs, dir, duration = LANE_SWITCH_DURATION) {
  const p = gs.player;
  const target = clamp(p.lane + dir, -1, 1);
  if (target === p.lane) return false;
  p.prevLane = p.lane;
  p.lane = target;
  p.laneStartX = p.x;
  p.laneTimer = 0;
  p.laneDuration = duration;
  p.tilt = dir * 0.42;
  SFX.lane();
  return true;
}

export function queueLaneMove(gs, dir) {
  if (gs.state !== 'playing') return;
  const p = gs.player;
  if (p.laneTimer >= p.laneDuration) {
    startLaneTransition(gs, dir, LANE_SWITCH_DURATION);
    return;
  }
  let proj = p.lane;
  for (let i = 0; i < p.laneQueue.length; i++) {
    proj = clamp(proj + p.laneQueue[i], -1, 1);
  }
  const nextProj = clamp(proj + dir, -1, 1);
  if (nextProj !== proj && p.laneQueue.length < LANE_QUEUE_MAX) {
    p.laneQueue.push(dir);
  }
}

export function requestJump(gs) {
  if (gs.state !== 'playing') return;
  const p = gs.player;
  // Right before touchdown on a fast descent, let Jump buffer a full-power landing bounce;
  // otherwise while airborne after jumping, tapping Jump flaps the pelican's wings to fly!
  const nearTouchdown = p.vy < -2 && p.y - p.supportY < 1.05;
  if (
    !p.grounded &&
    p.coyoteTimer <= 0 &&
    p.hasJumped &&
    !nearTouchdown &&
    p.flapsRemaining > 0 &&
    p.flapCooldown <= 0 &&
    p.airTime >= FLAP_MIN_AIR_TIME
  ) {
    executeFlap(gs);
    return;
  }
  p.jumpBufferTimer = JUMP_BUFFER_TIME;
}

function executeJump(gs, currentSpeed) {
  const p = gs.player;
  const rampBoost = p.onRamp ? Math.min(3.5, currentSpeed * RAMP_SLOPE * 0.4) : 0;
  p.vy = JUMP_VEL + rampBoost;
  p.grounded = false;
  p.onRamp = false;
  p.rampVehicle = null;
  p.onRoof = false;
  p.hasJumped = true;
  p.airTime = 0;
  p.flapsRemaining = FLAP_MAX_CHARGES;
  p.flapsUsedThisFlight = 0;
  p.flapCooldown = FLAP_COOLDOWN;
  p.flapGlideTimer = 0;
  p.coyoteTimer = 0;
  p.jumpBufferTimer = 0;
  p.duckTimer = 0;
  p.fastFalling = false;
  gs.camera.pitchVel -= 0.045;
  SFX.jump();
}

function executeFlap(gs) {
  const p = gs.player;
  const usedIdx = p.flapsUsedThisFlight;
  p.flapsRemaining = Math.max(0, p.flapsRemaining - 1);
  p.flapsUsedThisFlight += 1;
  p.flapCooldown = FLAP_COOLDOWN;
  p.flapGlideTimer = FLAP_GLIDE_TIME;
  p.flapAnimTimer = FLAP_ANIM_DURATION;
  p.jumpBufferTimer = 0;
  p.fastFalling = false;
  p.duckTimer = 0;

  // Softly taper lift near ceiling so the pelican glides smoothly instead of clipping off-screen
  const ceilingRoom = clamp((FLAP_MAX_ALTITUDE - p.y) / 2.2, 0.18, 1);
  const flapBoost = FLAP_VEL * ceilingRoom;
  p.vy = Math.max(p.vy * 0.35 + flapBoost, flapBoost);

  gs.camera.pitchVel -= 0.022;
  SFX.flap(usedIdx);
  spawnBurst(gs, p.x, p.y + 0.9, 0, ['#ffffff', '#e0f2fe', '#bae6fd'], 7);
  if (p.flapsUsedThisFlight === 3) {
    awardTrick(gs, 'SKY GLIDE! 🪶', 60, '#7dd3fc');
  }
}

export function activateHover(gs) {
  if (gs.state !== 'playing') return false;
  const p = gs.player;
  if (p.hoverTimer > 0) return false;
  if (gs.coins < HOVER_COST_COINS) {
    addFloatingText(gs, `NEED ${HOVER_COST_COINS} G COINS`, p.x, p.y + 1.8, 0, '#94a3b8');
    return false;
  }
  gs.coins -= HOVER_COST_COINS;
  p.hoverTimer = HOVER_DURATION;
  SFX.hoverOn();
  triggerShake(gs, 6, 0.14);
  spawnBurst(gs, p.x, p.y + 0.5, 0, ['#4285f4', '#ea4335', '#fbbc05', '#34a853'], 18);
  addFloatingText(gs, '⚡ HOVER-GBIKE!', p.x, p.y + 2.0, 0, '#38bdf8');
  return true;
}

export function awardTrick(gs, label, basePoints = 50, color = '#38bdf8') {
  const p = gs.player;
  p.comboMult = p.comboTimer > 0 ? Math.min(COMBO_MAX_MULT, p.comboMult + 1) : 2;
  p.comboTimer = COMBO_DECAY_TIME;
  const pts = basePoints * p.comboMult;
  gs.score += pts;
  SFX.combo(p.comboMult);
  addFloatingText(gs, `${label} ×${p.comboMult}`, p.x, p.y + 1.85, 0, color);
}

export function requestDuckDown(gs, isKeyboardHold = false) {
  if (gs.state !== 'playing') return;
  const p = gs.player;
  if (isKeyboardHold) p.duckHeld = true;

  if (!p.grounded && p.y > p.supportY + 0.18) {
    p.vy = Math.min(p.vy, FAST_FALL_VEL);
    p.fastFalling = true;
    p.flapGlideTimer = 0;
    p.duckTimer = Math.max(p.duckTimer, FAST_FALL_LAND_DUCK);
    SFX.duck();
  } else {
    p.duckTimer = DUCK_DURATION;
    SFX.duck();
  }
}

export function requestDuckUp(gs) {
  gs.player.duckHeld = false;
}

export function clearHeldInputs(gs) {
  gs.player.duckHeld = false;
  gs.player.jumpBufferTimer = 0;
  gs.player.laneQueue.length = 0;
}

export function getSupportInfo(gs, px, py, prevX, prevY, allowRamp = true) {
  let supportY = 0;
  let onRamp = false;
  let rampVehicle = null;
  let roofVehicle = null;
  let overRoofZ = false;
  let lateralRampBump = null;

  for (let i = 0; i < gs.obstacles.length; i++) {
    const o = gs.obstacles[i];
    if (o.type !== 'vehicle' || o.smashed) continue;
    if (
      gs.player &&
      gs.player.lastBumpedId === o.id &&
      gs.player.lastBumpedTimer > 0 &&
      gs.player.lane !== o.lane
    ) {
      continue;
    }
    const ox = o.lane * LANE_W;
    const inSupportX = Math.abs(px - ox) <= VEHICLE_SUPPORT_HALF_W;
    if (!inSupportX) continue;

    // On front ramp leading up to roof
    if (allowRamp && o.hasRamp && 0 >= o.zStart - RAMP_LEN && 0 <= o.zStart) {
      const t = clamp((0 - (o.zStart - RAMP_LEN)) / RAMP_LEN, 0, 1);
      const ry = t * ROOF_H;
      const wasInRampX = Math.abs(prevX - ox) <= VEHICLE_SUPPORT_HALF_W;

      if (!wasInRampX && ry > 0.45 && prevY < ry - 0.35) {
        lateralRampBump = o;
      } else if (
        (wasInRampX && (prevY >= ry - 0.55 || ry <= 0.55)) ||
        (!wasInRampX && (ry <= 0.45 || prevY >= ry - 0.35))
      ) {
        if (ry >= supportY) {
          supportY = ry;
          onRamp = true;
          rampVehicle = o;
        }
      }
    }

    const climbingThisRamp =
      o.hasRamp &&
      o.zStart > 0 &&
      ((onRamp && rampVehicle === o) ||
        (gs.player && gs.player.onRamp && gs.player.rampVehicle === o && !gs.player.onRoof));

    // On flat vehicle roof
    if (!climbingThisRamp && 0 >= o.zStart - 0.25 && 0 <= o.zEnd + 0.25) {
      overRoofZ = true;
      if (prevY >= ROOF_H - 0.45 && ROOF_H >= supportY) {
        supportY = ROOF_H;
        onRamp = false;
        rampVehicle = null;
        roofVehicle = o;
      }
    }
  }

  return { y: supportY, onRamp, rampVehicle, roofVehicle, overRoofZ, lateralRampBump };
}

function updateCameraShake(gs, dt) {
  const cam = gs.camera;
  if (cam.shakeTimer > 0) {
    cam.shakeTimer = Math.max(0, cam.shakeTimer - dt);
    cam.shakePhase += dt * 58;
    const scale = gs.viewport.cssW / 960;
    const decay = Math.min(1, cam.shakeTimer / 0.15);
    const amp = cam.shakeAmp * decay * scale;
    cam.shakeX = Math.sin(cam.shakePhase * 1.13) * amp;
    cam.shakeY = Math.cos(cam.shakePhase * 1.47) * amp * 0.72;
    if (cam.shakeTimer <= 0) {
      cam.shakeAmp = 0;
      cam.shakeX = 0;
      cam.shakeY = 0;
    }
  } else {
    cam.shakeX = 0;
    cam.shakeY = 0;
  }
}

function tryAbsorbOrRespawn(gs, obstacle) {
  const p = gs.player;
  if (p.respawnInvulnTimer > 0) return true;

  if (p.hoverTimer > 0) {
    if (obstacle) obstacle.smashed = true;
    p.hoverTimer = 0;
    p.respawnInvulnTimer = 1.4;
    p.stumbleTimer = 0;
    SFX.hoverSave();
    triggerShake(gs, 10, 0.2);
    spawnBurst(gs, p.x, p.y + 0.9, 0, ['#4285f4', '#ea4335', '#fbbc05', '#34a853', '#ffffff'], 24);
    addFloatingText(gs, '⚡ HOVER SAVED!', p.x, p.y + 2.1, 0, '#38bdf8');
    return true;
  }

  if (p.respawns > 0) {
    p.respawns -= 1;
    p.respawnInvulnTimer = RESPAWN_INVULN_DURATION;
    p.stumbleTimer = 0;
    for (let i = 0; i < gs.obstacles.length; i++) {
      const o = gs.obstacles[i];
      if (!o.smashed && o.zStart <= 18 && o.zEnd >= -4) {
        o.smashed = true;
      }
    }
    SFX.respawnRevive();
    triggerShake(gs, 12, 0.25);
    spawnBurst(gs, p.x, p.y + 1.0, 0, ['#4285f4', '#ea4335', '#fbbc05', '#34a853', '#ffffff'], 28);
    addFloatingText(gs, '🛡 RESPAWN!', p.x, p.y + 2.2, 0, '#4ade80');
    return true;
  }

  return false;
}

function triggerGameOver(gs, reasonText) {
  if (tryAbsorbOrRespawn(gs, null)) return;
  gs.state = 'gameover';
  gs.gameOverReason =
    reasonText || 'You clipped campus traffic! Hop back on the GBike and beat your score.';
  clearHeldInputs(gs);
  SFX.crash();
  triggerShake(gs, 18, 0.35);
  spawnBurst(
    gs,
    gs.player.x,
    gs.player.y + 0.8,
    0,
    ['#4285f4', '#ea4335', '#fbbc05', '#34a853', '#ffffff'],
    28
  );

  const finalScore = Math.floor(gs.score);
  if (finalScore > gs.bestScore) {
    gs.bestScore = finalScore;
    if (gs.speedMode === 'noogler') gs.bestScoreNoogler = finalScore;
    else gs.bestScoreGoogler = finalScore;
    saveBestScore(gs.bestScore, gs.speedMode);
  }
}

function smashVehicle(gs, o, ox) {
  o.smashed = true;
  gs.score += 150;
  SFX.smash();
  triggerShake(gs, 12, 0.2);
  spawnBurst(
    gs,
    ox,
    1.4,
    Math.max(0, o.zStart),
    ['#4285f4', '#a855f7', '#fbbc05', '#ffffff'],
    22
  );
  addFloatingText(gs, 'SMASH! +150', ox, 2.6, 1, '#e879f9');
}

function handleSideBump(gs, o, ox) {
  const p = gs.player;
  p.laneQueue.length = 0;
  let safeBack = p.prevLane;
  if (safeBack === o.lane) {
    if (o.lane === -1 || o.lane === 1) safeBack = 0;
    else safeBack = p.x < ox ? -1 : 1;
  }
  const targetX = safeBack * LANE_W;
  const awaySign = Math.sign(targetX - ox) || (p.x <= ox ? -1 : 1);
  const safeX = ox + awaySign * (VEHICLE_SUPPORT_HALF_W + 0.05);

  p.x = awaySign < 0 ? Math.min(p.x, safeX) : Math.max(p.x, safeX);
  p.lane = safeBack;
  p.laneStartX = p.x;
  p.laneTimer = 0;
  p.laneDuration = SIDE_BUMP_BOUNCE_DURATION;
  p.tilt = awaySign * 0.5;
  p.lastBumpedId = o.id;
  p.lastBumpedTimer = 0.25;

  if (p.stumbleTimer > 0.25) {
    triggerGameOver(gs, 'Bumped twice — the Noogler caught up to reclaim their GBike!');
    return true;
  }

  p.stumbleTimer = 3.2;
  SFX.bump();
  triggerShake(gs, 9, 0.18);
  spawnBurst(gs, ox, 1.0, 0, ['#fbbc05', '#ef4444'], 12);
  addFloatingText(gs, 'STUMBLE!', p.x, p.y + 1.8, 0, '#f87171');
  return false;
}

export function stepIdleAnimation(gs, dt) {
  if (gs.state === 'paused') return;
  gs.worldTime += dt;
  if (gs.state === 'credits') {
    gs.creditsElapsed += dt;
    gs.player.wingPhase += dt * 3.5;
    return;
  }
  updateCameraShake(gs, dt);
  const cam = gs.camera;
  cam.pitchVel += (-140 * cam.pitch - 16 * cam.pitchVel) * dt;
  cam.pitch = clamp(cam.pitch + cam.pitchVel * dt, -0.045, 0.045);
  gs.player.bellTimer = Math.max(0, gs.player.bellTimer - dt);
  gs.player.landingSquash *= Math.pow(0.002, dt);
  if (gs.campusBannerTimer > 0) {
    gs.campusBannerTimer = Math.max(0, gs.campusBannerTimer - dt);
  }
  if (gs.campusTransition < 1) {
    gs.campusTransition = Math.min(1, gs.campusTransition + dt * 0.5);
  }
  for (let i = gs.floatingTexts.length - 1; i >= 0; i--) {
    const ft = gs.floatingTexts[i];
    ft.life -= dt;
    ft.wy += dt * 1.6;
    if (ft.life <= 0) gs.floatingTexts.splice(i, 1);
  }
  if (gs.state === 'start') {
    gs.player.wheelAngle += dt * 4;
    gs.player.wingPhase += dt * 3;
  }
}

export function stepPhysics(gs, dt) {
  gs.worldTime += dt;
  updateCameraShake(gs, dt);
  if (gs.campusBannerTimer > 0) {
    gs.campusBannerTimer = Math.max(0, gs.campusBannerTimer - dt);
  }
  if (gs.campusTransition < 1) {
    gs.campusTransition = Math.min(1, gs.campusTransition + dt * 0.5);
  }

  if (gs.state !== 'playing') return;

  const p = gs.player;

  // 1. Progressive monotonic speed curve (Googler) or chill steady cruise (Noogler)
  const speed =
    gs.speedMode === 'noogler'
      ? NOOGLER_SPEED
      : Math.min(MAX_SPEED, BASE_SPEED + gs.distance * SPEED_RAMP_PER_M);
  gs.speed = speed;
  setMusicSpeed(speed);
  const dz = speed * dt;
  gs.roadScroll += dz;
  gs.distance += dz * DIST_SCALE;
  const comboBoost = p.comboTimer > 0 ? p.comboMult : 1;
  gs.score += dz * (p.onRoof ? 1.5 : 1.0) * (1 + (comboBoost - 1) * 0.25);

  // 2. Auto-advance across all 12 levels (6 Campuses + 6 Alphabet Moonshots) -> Rolling Credits Finale!
  if (!gs.lockedCampus) {
    const tourTotalDist = CAMPUSES.length * CAMPUS_DIST_STEP;
    if (!gs.endlessMode && gs.distance >= tourTotalDist) {
      gs.state = 'credits';
      gs.creditsElapsed = 0;
      const finalScore = Math.floor(gs.score);
      if (finalScore > gs.bestScore) {
        gs.bestScore = finalScore;
        if (gs.speedMode === 'noogler') gs.bestScoreNoogler = finalScore;
        else gs.bestScoreGoogler = finalScore;
        saveBestScore(gs.bestScore, gs.speedMode);
      }
      return;
    }
    const tourIdx = Math.floor(gs.distance / CAMPUS_DIST_STEP) % CAMPUSES.length;
    if (tourIdx !== gs.campusIdx) {
      gs.prevCampusIdx = gs.campusIdx;
      gs.campusIdx = tourIdx;
      gs.campusTransition = 0;
      gs.prevCampusTransition = 0;
      gs.campusBannerTimer = 2.6;
      SFX.sparkle();
      addFloatingText(
        gs,
        `WELCOME TO ${getCampus(tourIdx).name.toUpperCase()}!`,
        0,
        3.2,
        6,
        '#38bdf8'
      );
    }
  }

  // 3. Smooth cubic-eased lateral lane transitions + buffered queue
  const prevX = p.x;
  p.laneTimer = Math.min(p.laneDuration, p.laneTimer + dt);
  const u = p.laneDuration > 0 ? p.laneTimer / p.laneDuration : 1;
  const eased = u * u * (3 - 2 * u);
  p.x = p.laneStartX + (p.lane * LANE_W - p.laneStartX) * eased;

  if (p.laneTimer >= p.laneDuration) {
    p.x = p.lane * LANE_W;
    if (p.laneQueue.length > 0) {
      const nextDir = p.laneQueue.shift();
      startLaneTransition(gs, nextDir, LANE_SWITCH_DURATION);
    }
  }

  p.tilt *= Math.pow(0.02, dt);
  p.wheelAngle += dt * speed * 0.55;
  p.wingPhase += dt * (p.y > 0.2 ? 16 : 7);
  p.bellTimer = Math.max(0, p.bellTimer - dt);
  p.landingSquash *= Math.pow(0.002, dt);

  // 4. Timers & smooth ducking blend (freeze duckTimer while fast-falling!)
  if (!p.fastFalling && p.duckTimer > 0) {
    p.duckTimer = Math.max(0, p.duckTimer - dt);
  }
  if (p.stumbleTimer > 0) {
    p.stumbleTimer = Math.max(0, p.stumbleTimer - dt);
  }
  if (p.lastBumpedTimer > 0) {
    p.lastBumpedTimer = Math.max(0, p.lastBumpedTimer - dt);
    if (p.lastBumpedTimer <= 0) p.lastBumpedId = 0;
  }
  if (p.introChaseTimer > 0) {
    p.introChaseTimer = Math.max(0, p.introChaseTimer - dt);
  }
  if (p.sparkleTimer > 0) {
    p.sparkleTimer = Math.max(0, p.sparkleTimer - dt);
  }
  if (p.hoverTimer > 0) {
    p.hoverTimer = Math.max(0, p.hoverTimer - dt);
  }
  if (p.respawnInvulnTimer > 0) {
    p.respawnInvulnTimer = Math.max(0, p.respawnInvulnTimer - dt);
  }
  if (p.comboTimer > 0) {
    p.comboTimer = Math.max(0, p.comboTimer - dt);
    if (p.comboTimer <= 0) p.comboMult = 1;
  }
  if (p.jumpBufferTimer > 0) {
    p.jumpBufferTimer = Math.max(0, p.jumpBufferTimer - dt);
  }
  if (p.flapCooldown > 0) {
    p.flapCooldown = Math.max(0, p.flapCooldown - dt);
  }
  if (p.flapGlideTimer > 0) {
    p.flapGlideTimer = Math.max(0, p.flapGlideTimer - dt);
  }
  if (p.flapAnimTimer > 0) {
    p.flapAnimTimer = Math.max(0, p.flapAnimTimer - dt);
  }
  if (!p.grounded) {
    p.airTime += dt;
  } else {
    p.airTime = 0;
  }

  const wantsDuck = p.duckHeld || p.duckTimer > 0 || p.fastFalling;
  p.duckAmount = wantsDuck
    ? Math.min(1, p.duckAmount + dt * DUCK_BLEND_IN)
    : Math.max(0, p.duckAmount - dt * DUCK_BLEND_OUT);

  // 5. Pre-integration jump check (grounded + coyote time)
  if (p.jumpBufferTimer > 0 && (p.grounded || p.coyoteTimer > 0)) {
    executeJump(gs, speed);
  }

  // 6. Advance obstacles before support/swept-Z checks
  for (let i = gs.obstacles.length - 1; i >= 0; i--) {
    const o = gs.obstacles[i];
    const moveZ = (speed + (o.speedExtra || 0)) * dt;
    o.zStart -= moveZ;
    o.zEnd -= moveZ;
    if (o.zEnd < -10) {
      gs.obstacles.splice(i, 1);
    }
  }

  // 7. Vertical integration + ramp launch + roof support
  const prevY = p.y;
  const wasGrounded = p.grounded;
  const wasOnRamp = p.onRamp;
  const wasOnRoof = p.onRoof;
  const wasRampVehicle = p.rampVehicle || null;
  const wasRampVy = p.vy;

  const activeGravity = !p.fastFalling && p.flapGlideTimer > 0 ? FLAP_GLIDE_GRAVITY : GRAVITY;
  p.vy -= activeGravity * dt;
  if (!p.fastFalling && p.flapGlideTimer > 0 && p.vy < FLAP_GLIDE_MAX_FALL) {
    p.vy = FLAP_GLIDE_MAX_FALL;
  }
  p.y += p.vy * dt;
  if (p.y > FLAP_MAX_ALTITUDE + 0.5) {
    p.y = FLAP_MAX_ALTITUDE + 0.5;
    if (p.vy > 0) p.vy = 0;
  }

  let bumpedThisTick = false;

  const applyCrestLaunch = () => {
    const launchVy = clamp(wasRampVy * 0.65, RAMP_LAUNCH_MIN_VY, RAMP_LAUNCH_MAX_VY);
    p.y = Math.max(p.y, ROOF_H);
    p.vy = launchVy;
    p.onRamp = false;
    p.rampVehicle = null;
    p.grounded = false;
    p.onRoof = true;
    p.hasJumped = true;
    p.airTime = 0;
    p.flapsRemaining = FLAP_MAX_CHARGES;
    p.flapsUsedThisFlight = 0;
    p.supportY = ROOF_H;
    p.coyoteTimer = 0;
    SFX.ramp();
    addFloatingText(gs, 'ROOF SURF! ×1.5', p.x, ROOF_H + 1.4, 0, '#38bdf8');
  };

  if (
    wasOnRamp &&
    wasRampVehicle &&
    !wasRampVehicle.smashed &&
    !p.fastFalling &&
    wasRampVehicle.zStart <= 0 &&
    wasRampVehicle.zEnd >= 0 &&
    Math.abs(p.x - wasRampVehicle.lane * LANE_W) <= VEHICLE_SUPPORT_HALF_W
  ) {
    applyCrestLaunch();
  } else {
    let support = getSupportInfo(gs, p.x, p.y, prevX, prevY, true);
    if (support.lateralRampBump) {
      const bumpVeh = support.lateralRampBump;
      if (p.sparkleTimer > 0) {
        smashVehicle(gs, bumpVeh, bumpVeh.lane * LANE_W);
        support = getSupportInfo(gs, p.x, p.y, prevX, prevY, true);
      } else {
        bumpedThisTick = true;
        if (handleSideBump(gs, bumpVeh, bumpVeh.lane * LANE_W)) {
          return;
        }
      }
    }

    if (
      !bumpedThisTick &&
      wasOnRamp &&
      wasRampVehicle &&
      !wasRampVehicle.smashed &&
      !p.fastFalling &&
      support.roofVehicle === wasRampVehicle
    ) {
      applyCrestLaunch();
    } else {
      p.supportY = support.y;
      const rampVy = support.rampVehicle
        ? (speed + (support.rampVehicle.speedExtra || 0)) * RAMP_SLOPE
        : 0;

      if (p.y <= support.y) {
        const preLandVy = p.vy;
        if (!wasGrounded && preLandVy < -6) {
          gs.camera.pitchVel += clamp(-preLandVy * 0.0035, 0.015, 0.075);
        }
        if (!wasGrounded && preLandVy < -2) {
          p.landingSquash = Math.max(p.landingSquash, clamp(-preLandVy / 28, 0.08, 0.30));
        }
        if (p.vy < -18) {
          triggerShake(gs, 5, 0.1);
          spawnBurst(gs, p.x, support.y, 0, ['#e2e8f0', '#fbbc05'], 6);
        }
        if (!wasOnRoof && !support.onRamp && support.y >= ROOF_H - 0.15) {
          if (p.fastFalling) {
            awardTrick(gs, 'AIR SLAM!', 80, '#fbbc05');
          } else if (support.roofVehicle && p.lastRoofVehicleId && support.roofVehicle.id !== p.lastRoofVehicleId) {
            awardTrick(gs, 'ROOF HOP!', 75, '#38bdf8');
          } else {
            SFX.ramp();
            addFloatingText(gs, 'ROOF SURF! ×1.5', p.x, ROOF_H + 1.4, 0, '#38bdf8');
          }
        }
        if (support.roofVehicle) {
          p.lastRoofVehicleId = support.roofVehicle.id;
        } else if (support.y < 0.1) {
          p.lastRoofVehicleId = 0;
        }
        p.y = support.y;
        if (support.onRamp) {
          p.vy = Math.max(0, rampVy);
          p.onRamp = true;
          p.rampVehicle = support.rampVehicle;
        } else {
          if (p.vy < 0) p.vy = 0;
          p.onRamp = false;
          p.rampVehicle = null;
        }
        p.grounded = true;
        p.hasJumped = false;
        p.airTime = 0;
        p.flapsRemaining = FLAP_MAX_CHARGES;
        p.flapsUsedThisFlight = 0;
        p.flapGlideTimer = 0;
        p.coyoteTimer = COYOTE_TIME;
        if (p.fastFalling) {
          p.duckTimer = Math.max(p.duckTimer, FAST_FALL_LAND_DUCK);
          p.fastFalling = false;
        }
      } else {
        p.grounded = false;
        p.onRamp = false;
        p.rampVehicle = null;
        p.coyoteTimer = Math.max(0, p.coyoteTimer - dt);
      }

      p.onRoof =
        Boolean(support.roofVehicle) ||
        (wasOnRoof && support.overRoofZ && p.y >= ROOF_H - 0.25);
    }
  }

  // 8. Post-landing jump buffer check & smooth visual blend state
  if (p.jumpBufferTimer > 0 && p.grounded) {
    executeJump(gs, speed);
  }
  const targetAir = p.y > p.supportY + 0.14 ? 1 : 0;
  p.airBlend += (targetAir - p.airBlend) * Math.min(1, dt * 12);
  const targetWheelie = p.onRamp
    ? 0.26
    : (!p.grounded && p.vy > 1.5 ? clamp(p.vy * 0.018, 0, 0.24) : (p.fastFalling ? -0.18 : 0));
  p.wheeliePitch += (targetWheelie - p.wheeliePitch) * Math.min(1, dt * 12);

  // 9. Swept Z collision bounds aligned 1:1 with visual geometry
  const campus = getCampus(gs.campusIdx);
  for (let i = 0; i < gs.obstacles.length; i++) {
    const o = gs.obstacles[i];
    if (o.smashed) continue;

    const ox = o.lane * LANE_W;
    const hitHalfW = o.type === 'aerial' ? AERIAL_HALF_W : OBSTACLE_HIT_HALF_W;
    const inLane = Math.abs(p.x - ox) < hitHalfW;
    const hitsZ = o.zStart <= PLAYER_HALF_Z && o.prevZEnd >= -PLAYER_HALF_Z;

    // Close Call trick bonus when an oncoming vehicle zooms right past in an adjacent lane!
    if (
      o.type === 'vehicle' &&
      o.oncoming &&
      !o.nearMissAwarded &&
      o.zStart < -0.2 &&
      o.zEnd > 0.2 &&
      Math.abs(p.lane - o.lane) === 1 &&
      p.y < ROOF_H
    ) {
      o.nearMissAwarded = true;
      awardTrick(gs, 'CLOSE CALL!', 50, '#fbbf24');
    }

    if (!inLane || !hitsZ) continue;

    if (o.type === 'aerial') {
      const playerMidY = p.y + (p.duckAmount > 0.35 ? 0.5 : 0.9);
      if (Math.abs(playerMidY - o.y) < AERIAL_RADIUS_Y + 0.55) {
        if (p.sparkleTimer > 0) {
          o.smashed = true;
          gs.score += 100;
          SFX.smash();
          triggerShake(gs, 6, 0.12);
          spawnBurst(gs, ox, o.y, 0, ['#ffffff', '#38bdf8', '#fbbc05'], 14);
          addFloatingText(gs, 'SMASH! +100', ox, o.y + 0.7, 0, '#e879f9');
        } else if (tryAbsorbOrRespawn(gs, o)) {
          continue;
        } else {
          const aerialNames = {
            seagull: 'Sydney seagull',
            pigeon: 'city pigeon',
            lidarDrone: 'Waymo LiDAR calibration drone',
            qubit: 'entangled Qubit orb',
            packet: 'fiber-optic data packet',
            balloon: 'Loon weather balloon',
            wingDrone: 'Wing coffee delivery drone',
            protein: 'AlphaFold protein helix',
          };
          const aerialName = aerialNames[o.aerialKind] || 'campus delivery drone';
          triggerGameOver(gs, `Clipped a ${aerialName} mid-flight! Dodge or dive (↓ / S) beneath aerials.`);
          return;
        }
      }
      continue;
    }

    if (o.type === 'vehicle') {
      if (p.lastBumpedId === o.id && p.lastBumpedTimer > 0 && p.lane !== o.lane) {
        continue;
      }
      if (p.y >= ROOF_H - 0.22) continue;
      if (o.hasRamp && p.onRamp && p.y >= ROOF_H - 0.35 && o.zStart >= -0.2) continue;

      if (p.sparkleTimer > 0) {
        smashVehicle(gs, o, ox);
        continue;
      }

      if (!bumpedThisTick && Math.abs(prevX - ox) >= OBSTACLE_HIT_HALF_W && o.zStart < -0.35) {
        bumpedThisTick = true;
        if (handleSideBump(gs, o, ox)) return;
        continue;
      }

      if (tryAbsorbOrRespawn(gs, o)) continue;

      triggerGameOver(
        gs,
        `Head-on with a ${campus.name} ${campus.vehicleSingular || campus.vehicleName.slice(0, -1)}!`
      );
      return;
    }

    if (o.type === 'low') {
      if (p.y < LOW_HURDLE_CLEAR_Y) {
        if (p.sparkleTimer > 0) {
          o.smashed = true;
          gs.score += 75;
          SFX.smash();
          triggerShake(gs, 7, 0.14);
          spawnBurst(gs, ox, 0.7, 0, ['#fbbc05', '#ea4335', '#ffffff'], 14);
          addFloatingText(gs, 'SMASH! +75', ox, 1.8, 0, '#e879f9');
        } else if (tryAbsorbOrRespawn(gs, o)) {
          continue;
        } else {
          triggerGameOver(
            gs,
            'Clipped a campus bike barrier! Jump (↑ / Space) over low hurdles.'
          );
          return;
        }
      }
    } else if (o.type === 'high') {
      const isDucking = p.duckAmount > 0.35 && p.y < 0.45;
      const clearedOver = p.y >= HIGH_GANTRY_TOP_Y;
      if (!isDucking && !clearedOver) {
        if (p.sparkleTimer > 0) {
          o.smashed = true;
          gs.score += 75;
          SFX.smash();
          triggerShake(gs, 8, 0.14);
          spawnBurst(gs, ox, 1.8, 0, ['#4285f4', '#a855f7', '#ffffff'], 14);
          addFloatingText(gs, 'SMASH! +75', ox, 2.4, 0, '#e879f9');
        } else if (tryAbsorbOrRespawn(gs, o)) {
          continue;
        } else {
          triggerGameOver(
            gs,
            'Bonked an overhead campus gantry! Press ↓ / S to duck under.'
          );
          return;
        }
      }
    }
  }

  // 10. Smooth camera tracking (stays rock-steady on road jumps, rises smoothly during high wing-flap flight!)
  const targetCamX = p.x * 0.48;
  const targetCamY =
    3.9 + Math.min(ROOF_H, p.y) * 0.68 + Math.max(0, p.y - 3.35) * 0.45;
  const targetRoll = clamp(-p.tilt * 0.043, -0.018, 0.018);
  gs.camera.x += (targetCamX - gs.camera.x) * Math.min(1, dt * 8);
  gs.camera.y += (targetCamY - gs.camera.y) * Math.min(1, dt * 7);
  gs.camera.roll += (targetRoll - gs.camera.roll) * Math.min(1, dt * 10);
  const cam = gs.camera;
  cam.pitchVel += (-140 * cam.pitch - 16 * cam.pitchVel) * dt;
  cam.pitch = clamp(cam.pitch + cam.pitchVel * dt, -0.045, 0.045);

  // 11. Move road props (reset prevZ on wrap so props never interpolate backward)
  for (let i = 0; i < gs.roadProps.length; i++) {
    const rp = gs.roadProps[i];
    rp.z -= dz;
    if (rp.z < -4) {
      rp.z += MAX_Z;
      rp.prevZ = rp.z;
    }
  }

  // 12. Spawn new waves ahead
  gs.nextWaveZ -= dz;
  while (gs.nextWaveZ < MAX_Z + 25) {
    gs.nextWaveZ = spawnWave(gs, gs.nextWaveZ);
  }

  // 13. Move & collect coins / sparkles
  const pickupCenterY = p.y + (p.duckAmount > 0.35 ? 0.55 : 0.85);
  for (let i = gs.collectibles.length - 1; i >= 0; i--) {
    const c = gs.collectibles[i];
    c.z -= dz;
    if (c.z < -4 || c.collected) {
      gs.collectibles.splice(i, 1);
      continue;
    }

    if (p.sparkleTimer > 0 && c.type === 'coin' && c.z < 14 && c.z > -1) {
      c.x += (p.x - c.x) * Math.min(1, dt * 14);
      c.y += (p.y + 0.9 - c.y) * Math.min(1, dt * 14);
    }

    const dx = Math.abs(c.x - p.x);
    const dy = Math.abs(c.y - pickupCenterY);
    const hitZ = Math.abs(c.z) < 1.35;

    if (hitZ && dx < 1.25 && dy < 1.3) {
      c.collected = true;
      if (c.type === 'coin') {
        gs.coins += 1;
        gs.score += 25 * (p.comboTimer > 0 ? p.comboMult : 1);
        SFX.coin();
        spawnBurst(gs, c.x, c.y, 0, ['#fbbc05', '#4285f4', '#34a853', '#ea4335'], 6);
      } else if (c.type === 'medallion') {
        p.medallions += 1;
        gs.score += 100;
        spawnBurst(gs, c.x, c.y, 0, ['#4285f4', '#ea4335', '#fbbc05', '#34a853'], 18);
        if (p.medallions >= RESPAWN_MEDALLIONS_NEEDED) {
          p.medallions = 0;
          p.respawns += 1;
          SFX.respawnBank();
          triggerShake(gs, 7, 0.16);
          addFloatingText(gs, `🛡 RESPAWN BANKED! (×${p.respawns})`, p.x, p.y + 2.2, 0, '#4ade80');
        } else {
          SFX.medallion();
          addFloatingText(gs, `G MEDALLION ${p.medallions}/${RESPAWN_MEDALLIONS_NEEDED}`, p.x, p.y + 2.0, 0, '#fbbc05');
        }
      } else {
        p.sparkleTimer = SPARKLE_DURATION;
        gs.score += 100;
        SFX.sparkle();
        triggerShake(gs, 8, 0.18);
        spawnBurst(gs, c.x, c.y, 0, ['#a855f7', '#4285f4', '#fbbc05', '#ffffff'], 20);
        addFloatingText(gs, '✦ GEMINI OVERDRIVE!', p.x, p.y + 2.2, 0, '#e879f9');
      }
    }
  }

  // 14. Update particles
  for (let i = gs.particles.length - 1; i >= 0; i--) {
    const pt = gs.particles[i];
    pt.life -= dt;
    if (pt.life <= 0) {
      gs.particles.splice(i, 1);
      continue;
    }
    pt.vy -= 22 * dt;
    pt.x += pt.vx * dt;
    pt.y = Math.max(0, pt.y + pt.vy * dt);
    pt.z += pt.vz * dt;
  }

  // 15. Update floating texts
  for (let i = gs.floatingTexts.length - 1; i >= 0; i--) {
    const ft = gs.floatingTexts[i];
    ft.life -= dt;
    ft.wy += dt * 1.6;
    if (ft.life <= 0) gs.floatingTexts.splice(i, 1);
  }
}
