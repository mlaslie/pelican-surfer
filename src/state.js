import {
  AERIAL_HALF_W,
  AERIAL_RADIUS_Y,
  BASE_SPEED,
  BEST_SCORE_KEY,
  BEST_SCORE_NOOGLER_KEY,
  CAM_DIST,
  FLAP_MAX_CHARGES,
  GANTRY_HALF_W,
  HIGH_GANTRY_TOP_Y,
  HURDLE_HALF_W,
  INITIAL_WAVE_Z,
  LANE_SWITCH_DURATION,
  LANE_W,
  LEGACY_BASE_SPEED,
  LOW_HURDLE_HEIGHT,
  MAX_Z,
  NOOGLER_SPEED,
  RAMP_LEN,
  ROOF_H,
  VEHICLE_HALF_W,
  Z_NEAR_CLIP,
} from './constants.js';
import { getCampus } from './campuses.js';

export function loadBestScore(mode = 'googler') {
  const key = mode === 'noogler' ? BEST_SCORE_NOOGLER_KEY : BEST_SCORE_KEY;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === '') return 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 0;
    const floored = Math.floor(n);
    return floored === 0 ? 0 : floored;
  } catch {
    return 0;
  }
}

export function saveBestScore(score, mode = 'googler') {
  const key = mode === 'noogler' ? BEST_SCORE_NOOGLER_KEY : BEST_SCORE_KEY;
  try {
    const clean = Number.isFinite(score) && score >= 0 ? Math.floor(score) : 0;
    localStorage.setItem(key, String(clean === 0 ? 0 : clean));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

function createInitialPlayer() {
  return {
    lane: 0,
    prevLane: 0,
    laneStartX: 0,
    laneTimer: LANE_SWITCH_DURATION,
    laneDuration: LANE_SWITCH_DURATION,
    laneQueue: [],
    x: 0,
    prevX: 0,
    y: 0,
    prevY: 0,
    vy: 0,
    tilt: 0,
    prevTilt: 0,
    duckHeld: false,
    duckTimer: 0,
    duckAmount: 0,
    prevDuckAmount: 0,
    fastFalling: false,
    grounded: true,
    onRamp: false,
    onRoof: false,
    supportY: 0,
    prevSupportY: 0,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    hasJumped: false,
    airTime: 0,
    flapsRemaining: FLAP_MAX_CHARGES,
    flapCooldown: 0,
    flapGlideTimer: 0,
    flapAnimTimer: 0,
    prevFlapAnimTimer: 0,
    flapsUsedThisFlight: 0,
    sparkleTimer: 0,
    hoverTimer: 0,
    respawnInvulnTimer: 0,
    medallions: 0,
    respawns: 0,
    comboMult: 1,
    comboTimer: 0,
    lastRoofVehicleId: 0,
    stumbleTimer: 0,
    introChaseTimer: 1.6,
    lastBumpedId: 0,
    lastBumpedTimer: 0,
    wheelAngle: 0,
    prevWheelAngle: 0,
    wingPhase: 0,
    prevWingPhase: 0,
    bellTimer: 0,
    airBlend: 0,
    prevAirBlend: 0,
    landingSquash: 0,
    prevLandingSquash: 0,
    wheeliePitch: 0,
    prevWheeliePitch: 0,
  };
}

export function createGameState() {
  return {
    state: 'start',
    frameCount: 0,
    tickCount: 0,
    lastDt: 0,
    maxDt: 0,
    accumulator: 0,
    lastTime: 0,
    renderingActive: true,
    rafId: null,

    worldTime: 0,
    prevWorldTime: 0,
    score: 0,
    speedMode: 'googler', // 'googler' (accelerating) | 'noogler' (steady chill)
    bestScore: loadBestScore('googler'),
    bestScoreGoogler: loadBestScore('googler'),
    bestScoreNoogler: loadBestScore('noogler'),
    coins: 0,
    distance: 0,
    roadScroll: 0,
    prevRoadScroll: 0,
    speed: BASE_SPEED,

    campusIdx: 0,
    prevCampusIdx: 0,
    campusTransition: 1,
    prevCampusTransition: 1,
    lockedCampus: false,
    endlessMode: false,
    creditsElapsed: 0,
    campusBannerTimer: 0,

    nextWaveZ: INITIAL_WAVE_Z,
    waveCount: 0,
    nextEntityId: 1,
    gameOverReason: '',

    viewport: {
      cssW: 960,
      cssH: 600,
      dpr: 1,
      canvasW: 960,
      canvasH: 600,
      focal: 600 * 0.84,
      horizonY: 600 * 0.36,
    },

    camera: {
      x: 0,
      prevX: 0,
      y: 4.0,
      prevY: 4.0,
      roll: 0,
      prevRoll: 0,
      pitch: 0,
      prevPitch: 0,
      pitchVel: 0,
      shakeX: 0,
      prevShakeX: 0,
      shakeY: 0,
      prevShakeY: 0,
      shakeTimer: 0,
      shakeAmp: 0,
      shakePhase: 0,
    },

    player: createInitialPlayer(),

    obstacles: [],
    collectibles: [],
    particles: [],
    roadProps: [],
    floatingTexts: [],
  };
}

export function resetRunState(gs) {
  gs.tickCount = 0;
  gs.maxDt = 0;
  gs.accumulator = 0;
  gs.worldTime = 0;
  gs.prevWorldTime = 0;
  gs.score = 0;
  gs.coins = 0;
  gs.distance = 0;
  gs.roadScroll = 0;
  gs.prevRoadScroll = 0;
  gs.speed = gs.speedMode === 'noogler' ? NOOGLER_SPEED : BASE_SPEED;
  gs.bestScore = gs.speedMode === 'noogler' ? gs.bestScoreNoogler : gs.bestScoreGoogler;
  gs.nextWaveZ = INITIAL_WAVE_Z;
  gs.waveCount = 0;
  gs.nextEntityId = 1;
  gs.gameOverReason = '';
  gs.campusBannerTimer = 0;
  gs.endlessMode = false;
  gs.creditsElapsed = 0;

  gs.lockedCampus = false;
  gs.campusIdx = 0;
  gs.prevCampusIdx = 0;
  gs.campusTransition = 1;
  gs.prevCampusTransition = 1;

  gs.camera.x = 0;
  gs.camera.prevX = 0;
  gs.camera.y = 4.0;
  gs.camera.prevY = 4.0;
  gs.camera.roll = 0;
  gs.camera.prevRoll = 0;
  gs.camera.pitch = 0;
  gs.camera.prevPitch = 0;
  gs.camera.pitchVel = 0;
  gs.camera.shakeX = 0;
  gs.camera.prevShakeX = 0;
  gs.camera.shakeY = 0;
  gs.camera.prevShakeY = 0;
  gs.camera.shakeTimer = 0;
  gs.camera.shakeAmp = 0;
  gs.camera.shakePhase = 0;

  Object.assign(gs.player, createInitialPlayer());

  gs.obstacles = [];
  gs.collectibles = [];
  gs.particles = [];
  gs.floatingTexts = [];
}

export function snapshotPrevState(gs) {
  gs.prevRoadScroll = gs.roadScroll;
  gs.prevWorldTime = gs.worldTime;
  gs.prevCampusTransition = gs.campusTransition;

  const cam = gs.camera;
  cam.prevX = cam.x;
  cam.prevY = cam.y;
  cam.prevRoll = cam.roll;
  cam.prevPitch = cam.pitch;
  cam.prevShakeX = cam.shakeX;
  cam.prevShakeY = cam.shakeY;

  const p = gs.player;
  p.prevX = p.x;
  p.prevY = p.y;
  p.prevTilt = p.tilt;
  p.prevDuckAmount = p.duckAmount;
  p.prevSupportY = p.supportY;
  p.prevWheelAngle = p.wheelAngle;
  p.prevWingPhase = p.wingPhase;
  p.prevFlapAnimTimer = p.flapAnimTimer;
  p.prevAirBlend = p.airBlend;
  p.prevLandingSquash = p.landingSquash;
  p.prevWheeliePitch = p.wheeliePitch;

  for (let i = 0; i < gs.obstacles.length; i++) {
    const o = gs.obstacles[i];
    o.prevZStart = o.zStart;
    o.prevZEnd = o.zEnd;
  }
  for (let i = 0; i < gs.collectibles.length; i++) {
    const c = gs.collectibles[i];
    c.prevX = c.x;
    c.prevY = c.y;
    c.prevZ = c.z;
  }
  for (let i = 0; i < gs.roadProps.length; i++) {
    gs.roadProps[i].prevZ = gs.roadProps[i].z;
  }
  for (let i = 0; i < gs.particles.length; i++) {
    const pt = gs.particles[i];
    pt.prevX = pt.x;
    pt.prevY = pt.y;
    pt.prevZ = pt.z;
  }
  for (let i = 0; i < gs.floatingTexts.length; i++) {
    gs.floatingTexts[i].prevWy = gs.floatingTexts[i].wy;
  }
}

export function triggerShake(gs, amp, dur = 0.22) {
  gs.camera.shakeAmp = Math.max(gs.camera.shakeAmp, amp);
  gs.camera.shakeTimer = Math.max(gs.camera.shakeTimer, dur);
}

export function addFloatingText(gs, text, wx, wy, wz, color = '#fbbc05') {
  gs.floatingTexts.push({
    text,
    wx,
    wy,
    prevWy: wy,
    wz,
    color,
    life: 0.9,
    maxLife: 0.9,
  });
}

export function spawnBurst(gs, wx, wy, wz, colors, count = 16) {
  for (let i = 0; i < count; i++) {
    const x = wx + (Math.random() - 0.5) * 1.2;
    const y = wy + Math.random() * 1.2;
    const z = wz + (Math.random() - 0.5) * 1.2;
    gs.particles.push({
      x,
      prevX: x,
      y,
      prevY: y,
      z,
      prevZ: z,
      vx: (Math.random() - 0.5) * 11,
      vy: 3 + Math.random() * 10,
      vz: (Math.random() - 0.5) * 10,
      size: 0.14 + Math.random() * 0.2,
      color: colors[i % colors.length],
      life: 0.45 + Math.random() * 0.35,
      maxLife: 0.8,
    });
  }
}

export function projectPoint(wx, wy, wz, camX, camY, viewport) {
  const dz = wz + CAM_DIST;
  if (dz <= Z_NEAR_CLIP) return null;
  const scale = viewport.focal / dz;
  const sx = viewport.cssW * 0.5 + (wx - camX) * scale;
  const sy = viewport.horizonY - (wy - camY) * scale;
  return { sx, sy, scale, dz };
}

export function transformScreenPoint(sx, sy, cam, vp) {
  const pitchPy = (cam.pitch || 0) * vp.cssH;
  const dx = sx - vp.cssW * 0.5;
  const dy = sy + pitchPy - vp.cssH * 0.5;
  const cosR = Math.cos(cam.roll || 0);
  const sinR = Math.sin(cam.roll || 0);
  return {
    sx: vp.cssW * 0.5 + dx * cosR - dy * sinR + (cam.shakeX || 0),
    sy: vp.cssH * 0.5 + dx * sinR + dy * cosR + (cam.shakeY || 0),
  };
}

function computeBoxScreenRect(xMin, xMax, yMin, yMax, zMin, zMax, gs) {
  const nearZ = -CAM_DIST + Z_NEAR_CLIP;
  const czMin = Math.max(zMin, nearZ);
  const czMax = Math.min(zMax, MAX_Z);
  if (zMax <= nearZ || zMin > MAX_Z || czMax < czMin) return null;

  const camX = gs.camera.x;
  const camY = gs.camera.y;
  const zVals = czMin === czMax ? [czMin] : [czMin, czMax];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;

  for (let xi = 0; xi < 2; xi++) {
    const wx = xi === 0 ? xMin : xMax;
    for (let yi = 0; yi < 2; yi++) {
      const wy = yi === 0 ? yMin : yMax;
      for (let zi = 0; zi < zVals.length; zi++) {
        const pt = projectPoint(wx, wy, zVals[zi], camX, camY, gs.viewport);
        if (!pt) continue;
        const tp = transformScreenPoint(pt.sx, pt.sy, gs.camera, gs.viewport);
        if (tp.sx < minX) minX = tp.sx;
        if (tp.sx > maxX) maxX = tp.sx;
        if (tp.sy < minY) minY = tp.sy;
        if (tp.sy > maxY) maxY = tp.sy;
        count += 1;
      }
    }
  }

  if (count < 2) return null;
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return null;
  return { x: minX, y: minY, w, h };
}

function computePlayerScreenRect(gs) {
  const p = gs.player;
  const topY = p.y + (1.82 - p.duckAmount * 0.54);
  const airPad = (p.airBlend || 0) * 0.14;
  return computeBoxScreenRect(
    p.x - (0.52 + airPad),
    p.x + (0.60 + airPad),
    p.y,
    topY,
    -0.38,
    0.42,
    gs
  );
}

function computeObstacleScreenRect(o, gs) {
  if (o.smashed) return null;
  const cx = o.lane * LANE_W;
  let hw = HURDLE_HALF_W;
  let yMin = 0;
  let yMax = LOW_HURDLE_HEIGHT;

  if (o.type === 'vehicle') {
    hw = VEHICLE_HALF_W;
    yMin = 0;
    yMax = ROOF_H;
  } else if (o.type === 'high') {
    hw = GANTRY_HALF_W;
    yMin = 0;
    yMax = HIGH_GANTRY_TOP_Y;
  } else if (o.type === 'aerial') {
    hw = AERIAL_HALF_W;
    yMin = Math.max(0, (o.y || 3.0) - AERIAL_RADIUS_Y);
    yMax = (o.y || 3.0) + AERIAL_RADIUS_Y;
  }

  return computeBoxScreenRect(cx - hw, cx + hw, yMin, yMax, o.zStart, o.zEnd, gs);
}

function computeCollectibleScreenRect(c, gs) {
  if (c.collected || c.z > MAX_Z) return null;
  const pt = projectPoint(c.x, c.y, c.z, gs.camera.x, gs.camera.y, gs.viewport);
  if (!pt) return null;
  const r = c.type === 'sparkle' ? 0.55 : 0.36;
  const pr = Math.max(3, pt.scale * r);
  const tp = transformScreenPoint(pt.sx, pt.sy, gs.camera, gs.viewport);
  return {
    x: tp.sx - pr,
    y: tp.sy - pr,
    w: pr * 2,
    h: pr * 2,
  };
}

export function createDebugSnapshot(gs) {
  const campus = getCampus(gs.campusIdx);
  const p = gs.player;
  const cam = gs.camera;
  const vp = gs.viewport;

  return {
    state: gs.state,
    frameCount: gs.frameCount,
    tickCount: gs.tickCount,
    lastDt: gs.lastDt,
    maxDt: gs.maxDt,
    worldTime: gs.worldTime,
    score: gs.score,
    speedMode: gs.speedMode,
    bestScore: gs.bestScore,
    bestScoreGoogler: gs.bestScoreGoogler,
    bestScoreNoogler: gs.bestScoreNoogler,
    coins: gs.coins,
    distance: gs.distance,
    speed: gs.speed,
    baseSpeed: BASE_SPEED,
    legacyBaseSpeed: LEGACY_BASE_SPEED,
    roadScroll: gs.roadScroll,
    campusIdx: gs.campusIdx,
    campusId: campus.id,
    campusName: campus.name,
    campusTransition: gs.campusTransition,
    lockedCampus: gs.lockedCampus,
    viewport: {
      cssW: vp.cssW,
      cssH: vp.cssH,
      dpr: vp.dpr,
      canvasW: vp.canvasW,
      canvasH: vp.canvasH,
      focal: vp.focal,
      horizonY: vp.horizonY,
    },
    camera: {
      x: cam.x,
      y: cam.y,
      shakeX: cam.shakeX,
      shakeY: cam.shakeY,
      roll: cam.roll,
      pitch: cam.pitch,
    },
    player: {
      lane: p.lane,
      targetX: p.lane * LANE_W,
      x: p.x,
      y: p.y,
      vy: p.vy,
      tilt: p.tilt,
      duckAmount: p.duckAmount,
      duckTimer: p.duckTimer,
      onRoof: p.onRoof,
      grounded: p.grounded,
      coyoteTimer: p.coyoteTimer,
      jumpBufferTimer: p.jumpBufferTimer,
      hasJumped: p.hasJumped,
      flapsRemaining: p.flapsRemaining,
      flapGlideTimer: p.flapGlideTimer,
      sparkleTimer: p.sparkleTimer,
      hoverTimer: p.hoverTimer,
      respawnInvulnTimer: p.respawnInvulnTimer,
      medallions: p.medallions,
      respawns: p.respawns,
      comboMult: p.comboMult,
      comboTimer: p.comboTimer,
      stumbleTimer: p.stumbleTimer,
      screenRect: computePlayerScreenRect(gs),
    },
    obstacles: gs.obstacles.map((o) => ({
      id: o.id,
      type: o.type,
      lane: o.lane,
      x: o.lane * LANE_W,
      zStart: o.zStart,
      zEnd: o.zEnd,
      height: o.height,
      minY: o.minY,
      hasRamp: Boolean(o.hasRamp),
      rampLen: o.hasRamp ? RAMP_LEN : 0,
      oncoming: Boolean(o.oncoming),
      smashed: Boolean(o.smashed),
      screenRect: computeObstacleScreenRect(o, gs),
    })),
    collectibles: gs.collectibles.map((c) => ({
      id: c.id,
      type: c.type,
      lane: c.lane,
      x: c.x,
      y: c.y,
      z: c.z,
      collected: Boolean(c.collected),
      screenRect: computeCollectibleScreenRect(c, gs),
    })),
  };
}

export function installDebugHook(gs) {
  const api = Object.freeze({
    getState: () => createDebugSnapshot(gs),
  });
  Object.defineProperty(window, '__PELICAN_DEBUG__', {
    value: api,
    writable: false,
    enumerable: true,
    configurable: true,
  });
  return api;
}
