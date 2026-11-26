import {
  AERIAL_DEPTH,
  AERIAL_RADIUS_Y,
  BASE_SPEED,
  DIST_SCALE,
  HIGH_GANTRY_DEPTH,
  HIGH_GANTRY_MIN_Y,
  HIGH_GANTRY_TOP_Y,
  LANE_W,
  LOW_HURDLE_DEPTH,
  LOW_HURDLE_HEIGHT,
  MAX_SPEED,
  MAX_Z,
  PLAYER_HALF_Z,
  RAMP_LEN,
  ROOF_H,
  SPEED_RAMP_PER_M,
} from './constants.js';

function pushObstacle(gs, obs) {
  gs.obstacles.push({
    id: gs.nextEntityId++,
    type: obs.type,
    lane: obs.lane,
    x: obs.lane * LANE_W,
    zStart: obs.zStart,
    prevZStart: obs.zStart,
    zEnd: obs.zEnd,
    prevZEnd: obs.zEnd,
    height: obs.height,
    minY: obs.minY,
    hasRamp: Boolean(obs.hasRamp),
    rampLen: obs.hasRamp ? RAMP_LEN : 0,
    speedExtra: obs.speedExtra || 0,
    oncoming: Boolean(obs.speedExtra > 0),
    y: obs.y ?? 0,
    aerialKind: obs.aerialKind || null,
    nearMissAwarded: false,
    variant: obs.variant || 'main',
    campusIdx: gs.campusIdx,
    smashed: false,
  });
}

function pushVehicle(gs, { lane, zStart, length, hasRamp = false, speedExtra = 0, variant = 'main' }) {
  pushObstacle(gs, {
    type: 'vehicle',
    lane,
    zStart,
    zEnd: zStart + length,
    height: ROOF_H,
    minY: 0,
    hasRamp,
    speedExtra,
    variant,
  });
}

function pushLowHurdle(gs, lane, zStart) {
  pushObstacle(gs, {
    type: 'low',
    lane,
    zStart,
    zEnd: zStart + LOW_HURDLE_DEPTH,
    height: LOW_HURDLE_HEIGHT,
    minY: 0,
    hasRamp: false,
    speedExtra: 0,
    variant: 'main',
  });
}

function pushHighGantry(gs, lane, zStart) {
  pushObstacle(gs, {
    type: 'high',
    lane,
    zStart,
    zEnd: zStart + HIGH_GANTRY_DEPTH,
    height: HIGH_GANTRY_TOP_Y,
    minY: HIGH_GANTRY_MIN_Y,
    hasRamp: false,
    speedExtra: 0,
    variant: 'main',
  });
}

function getCampusAerialKind(campusIdx) {
  // 0=MV(drone), 1=London(pigeon), 2=Zurich(drone), 3=Tokyo(drone), 4=NYC(pigeon), 5=Sydney(seagull)
  // 6=Waymo(lidarDrone), 7=Quantum(qubit), 8=TPU(packet), 9=Loon(balloon), 10=Wing(wingDrone), 11=DeepMind(protein)
  if (campusIdx === 5) return 'seagull';
  if (campusIdx === 1 || campusIdx === 4) return 'pigeon';
  if (campusIdx === 6) return 'lidarDrone';
  if (campusIdx === 7) return 'qubit';
  if (campusIdx === 8) return 'packet';
  if (campusIdx === 9) return 'balloon';
  if (campusIdx === 10) return 'wingDrone';
  if (campusIdx === 11) return 'protein';
  return 'drone';
}

function pushAerialHazard(gs, lane, zStart, y = 3.45) {
  pushObstacle(gs, {
    type: 'aerial',
    lane,
    zStart,
    zEnd: zStart + AERIAL_DEPTH,
    height: y + AERIAL_RADIUS_Y,
    minY: Math.max(0, y - AERIAL_RADIUS_Y),
    y,
    hasRamp: false,
    speedExtra: 0,
    aerialKind: getCampusAerialKind(gs.campusIdx),
    variant: 'main',
  });
}

export function spawnMedallion(gs, lane, z, y = 1.1) {
  const x = lane * LANE_W;
  gs.collectibles.push({
    id: gs.nextEntityId++,
    type: 'medallion',
    lane,
    x,
    prevX: x,
    y,
    prevY: y,
    z,
    prevZ: z,
    collected: false,
  });
}

export function spawnCoinLine(gs, lane, zStart, count, stepZ, baseY = 0.75, arc = false) {
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0.5;
    const y = arc ? baseY + Math.sin(t * Math.PI) * 1.85 : baseY;
    const x = lane * LANE_W;
    const z = zStart + i * stepZ;
    gs.collectibles.push({
      id: gs.nextEntityId++,
      type: 'coin',
      lane,
      x,
      prevX: x,
      y,
      prevY: y,
      z,
      prevZ: z,
      collected: false,
    });
  }
}

export function spawnSparkle(gs, lane, z, y = 1.0) {
  const x = lane * LANE_W;
  gs.collectibles.push({
    id: gs.nextEntityId++,
    type: 'sparkle',
    lane,
    x,
    prevX: x,
    y,
    prevY: y,
    z,
    prevZ: z,
    collected: false,
  });
}

function getObstacleTimeWindow(zStart, zEnd, speedExtra, vNow) {
  const base = Math.max(BASE_SPEED, vNow);
  const vLo = base + speedExtra;
  const maxDv = Math.max(0, zEnd) * DIST_SCALE * SPEED_RAMP_PER_M;
  const vHi = Math.min(MAX_SPEED, base + maxDv) + speedExtra;
  return [
    Math.max(0, (zStart - PLAYER_HALF_Z) / vHi),
    Math.max(0, (zEnd + PLAYER_HALF_Z) / vLo),
  ];
}

function findSafeOncomingZ(gs, lane, zMin, zMax, vLen, speedExtra) {
  const vNow = Math.max(BASE_SPEED, gs.speed);
  const laneObstacleWindows = { [-1]: [], 0: [], 1: [] };
  const laneVehicleWindows = { [-1]: [], 0: [], 1: [] };

  for (let i = 0; i < gs.obstacles.length; i++) {
    const o = gs.obstacles[i];
    if (o.smashed || o.zEnd <= -2) continue;
    const w = getObstacleTimeWindow(o.zStart, o.zEnd, o.speedExtra || 0, vNow);
    laneObstacleWindows[o.lane].push(w);
    if (o.type === 'vehicle') {
      laneVehicleWindows[o.lane].push(w);
    }
  }

  const forbidden = [];
  for (const [t0, t1] of laneObstacleWindows[lane]) {
    forbidden.push([t0 - 0.35, t1 + 0.35]);
  }

  const otherLanes = [-1, 0, 1].filter((l) => l !== lane);
  for (const [a0, a1] of laneVehicleWindows[otherLanes[0]]) {
    for (const [b0, b1] of laneVehicleWindows[otherLanes[1]]) {
      const ov0 = Math.max(a0, b0);
      const ov1 = Math.min(a1, b1);
      if (ov0 <= ov1) {
        forbidden.push([ov0 - 0.45, ov1 + 0.45]);
      }
    }
  }

  if (lane !== 0) {
    for (const [m0, m1] of laneVehicleWindows[0]) {
      forbidden.push([m0 - 0.45, m1 + 0.45]);
    }
  }

  for (let z = zMin; z <= zMax; z += 1) {
    const [on0, on1] = getObstacleTimeWindow(z, z + vLen, speedExtra, vNow);
    let conflict = false;
    for (let i = 0; i < forbidden.length; i++) {
      const [f0, f1] = forbidden[i];
      if (on0 <= f1 && on1 >= f0) {
        conflict = true;
        break;
      }
    }
    if (!conflict) return z;
  }

  return null;
}

export function spawnWave(gs, zBase) {
  gs.waveCount += 1;
  const lanes = [-1, 0, 1];
  const diff = Math.min(1, gs.distance / 1800);
  const waveGap = 18 + diff * 10;

  // Friendly intro waves aligned to BASE_SPEED = 11.5
  if (gs.waveCount === 1) {
    spawnCoinLine(gs, 0, zBase - 12, 5, 2.5, 0.75, false);
    pushVehicle(gs, {
      lane: 1,
      zStart: zBase + RAMP_LEN,
      length: 16,
      hasRamp: true,
      speedExtra: 0,
      variant: 'main',
    });
    spawnCoinLine(gs, 1, zBase + RAMP_LEN + 2, 5, 2.8, ROOF_H + 0.75, false);
    return zBase + RAMP_LEN + 26;
  }

  if (gs.waveCount === 2) {
    pushLowHurdle(gs, 0, zBase + 6);
    spawnCoinLine(gs, 0, zBase + 2.5, 4, 2.4, 0.8, true);
    pushVehicle(gs, {
      lane: -1,
      zStart: zBase + RAMP_LEN + 6,
      length: 16,
      hasRamp: true,
      speedExtra: 0,
      variant: 'alt',
    });
    spawnCoinLine(gs, -1, zBase + RAMP_LEN + 8, 5, 2.7, ROOF_H + 0.75, false);
    return zBase + RAMP_LEN + 22 + waveGap;
  }

  // Deterministic Pattern 3 on Wave 3 so all 3 obstacle types appear early
  const forcePattern3 = gs.waveCount === 3;
  const roll = Math.random();
  const allowOncoming = gs.waveCount >= 4;

  if (!forcePattern3 && roll < 0.36) {
    // PATTERN 1: Ramp & Roof Surfing
    const rampLane = lanes[Math.floor(Math.random() * 3)];
    const adjacentLanes = lanes.filter((l) => Math.abs(l - rampLane) === 1);
    const chainLane = adjacentLanes[Math.floor(Math.random() * adjacentLanes.length)];

    const len1 = 15 + Math.random() * 6;
    pushVehicle(gs, {
      lane: rampLane,
      zStart: zBase + RAMP_LEN,
      length: len1,
      hasRamp: true,
      speedExtra: 0,
      variant: Math.random() < 0.35 ? 'alt' : 'main',
    });
    spawnCoinLine(gs, rampLane, zBase + RAMP_LEN + 2, 5, 2.6, ROOF_H + 0.75, false);

    const len2 = 16 + Math.random() * 6;
    const zChain = zBase + RAMP_LEN + len1 * 0.55;
    pushVehicle(gs, {
      lane: chainLane,
      zStart: zChain,
      length: len2,
      hasRamp: false,
      speedExtra: 0,
      variant: 'main',
    });
    spawnCoinLine(gs, chainLane, zChain + 2.5, 5, 2.7, ROOF_H + 0.75, false);

    if (Math.random() < 0.3) {
      spawnSparkle(gs, chainLane, zChain + len2 * 0.5, ROOF_H + 1.05);
    }

    // Bonus sky-glide coin ribbon above the gap between roofs to reward wing-flap flight
    if (Math.random() < 0.55) {
      spawnCoinLine(gs, chainLane, zChain - 2.5, 4, 2.5, ROOF_H + 1.85, true);
    }

    // Rare Giant Google G Medallion (3 medallions = stackable respawn!)
    if (gs.waveCount >= 4 && Math.random() < 0.24) {
      spawnMedallion(gs, rampLane, zBase + RAMP_LEN + len1 * 0.65, ROOF_H + 1.05);
    }

    const thirdLane = lanes.find((l) => l !== rampLane && l !== chainLane);
    if (Math.random() < 0.55) {
      pushLowHurdle(gs, thirdLane, zBase + 10);
      spawnCoinLine(gs, thirdLane, zBase + 6.5, 4, 2.4, 0.8, true);
    }

    // Tactical aerial hazard (seagull / pigeon / delivery drone) cleanly spaced in thirdLane airspace
    if (gs.waveCount >= 5 && Math.random() < 0.35) {
      pushAerialHazard(gs, thirdLane, zBase + 18, 3.45);
    }

    return zChain + len2 + waveGap;
  }

  if (!forcePattern3 && roll < 0.66 && allowOncoming) {
    // PATTERN 2: Oncoming Rush + Parked Vehicle
    const speedExtra = 7 + diff * 9;
    const vNow = Math.max(BASE_SPEED, gs.speed);
    const ratio = (vNow + speedExtra) / vNow;
    const vLen = 14 + Math.random() * 5;
    const zMin = zBase + 18;
    const zMax = Math.max(zBase + 45, (zBase + 24) * ratio);

    const candidateLanes = [...lanes].sort(() => Math.random() - 0.5);
    let chosen = null;
    for (const lane of candidateLanes) {
      const safeZ = findSafeOncomingZ(gs, lane, zMin, zMax, vLen, speedExtra);
      if (safeZ !== null && (!chosen || safeZ < chosen.safeZ)) {
        chosen = { lane, safeZ };
      }
    }

    if (!chosen) {
      // Safe fallback when all 3 lanes are constrained: at most 1 parked vehicle + low + high
      const fallbackLanes = [...lanes].sort(() => Math.random() - 0.5);
      const pLen = 14 + Math.random() * 6;
      const hasRamp = Math.random() < 0.65;
      const pZStart = zBase + (hasRamp ? RAMP_LEN : 0);
      pushVehicle(gs, {
        lane: fallbackLanes[0],
        zStart: pZStart,
        length: pLen,
        hasRamp,
        speedExtra: 0,
        variant: 'alt',
      });
      pushLowHurdle(gs, fallbackLanes[1], zBase + 6);
      spawnCoinLine(gs, fallbackLanes[1], zBase + 2.5, 4, 2.4, 0.8, true);
      pushHighGantry(gs, fallbackLanes[2], zBase + 10);
      spawnCoinLine(gs, fallbackLanes[2], zBase + 5, 5, 2.4, 0.6, false);
      return pZStart + pLen + waveGap;
    }

    const oncomingLane = chosen.lane;
    const pLen = 14 + Math.random() * 6;
    const hasRamp = Math.random() < 0.6;
    const pZStart = zBase + (hasRamp ? RAMP_LEN : 0);

    const [on0, on1] = getObstacleTimeWindow(chosen.safeZ, chosen.safeZ + vLen, speedExtra, vNow);
    const [pk0, pk1] = getObstacleTimeWindow(pZStart, pZStart + pLen, 0, vNow);
    const oncomingOverlapsParked = on0 <= pk1 + 0.45 && on1 >= pk0 - 0.45;

    const remaining = lanes.filter((l) => l !== oncomingLane);
    let parkedLane = remaining[Math.floor(Math.random() * remaining.length)];
    if (oncomingLane !== 0 && oncomingOverlapsParked) {
      parkedLane = -oncomingLane;
    }
    const openLane = remaining.find((l) => l !== parkedLane);

    pushVehicle(gs, {
      lane: oncomingLane,
      zStart: chosen.safeZ,
      length: vLen,
      hasRamp: false,
      speedExtra,
      variant: 'main',
    });

    pushVehicle(gs, {
      lane: parkedLane,
      zStart: pZStart,
      length: pLen,
      hasRamp,
      speedExtra: 0,
      variant: 'alt',
    });

    if (Math.random() < 0.55) {
      pushHighGantry(gs, openLane, zBase + 10);
      spawnCoinLine(gs, openLane, zBase + 5, 5, 2.4, 0.6, false);
    } else {
      spawnCoinLine(gs, openLane, zBase + 3, 6, 2.6, 0.8, false);
    }

    if (Math.random() < 0.18) {
      spawnSparkle(gs, openLane, zBase + 22, 0.95);
    } else if (gs.waveCount >= 4 && Math.random() < 0.22) {
      spawnMedallion(gs, openLane, zBase + 22, 1.05);
    }

    if (gs.waveCount >= 5 && Math.random() < 0.32) {
      pushAerialHazard(gs, openLane, zBase + 20, 3.45);
    }

    const vEndZ = chosen.safeZ + vLen;
    const clearHorizon = MAX_Z + 25;
    const maxDvClear = Math.max(0, vEndZ) * DIST_SCALE * SPEED_RAMP_PER_M;
    const vHiClear = Math.min(MAX_SPEED, vNow + maxDvClear);
    const ratioClear = (vHiClear + speedExtra) / vHiClear;
    const oncomingClear =
      vEndZ <= clearHorizon ? vEndZ : clearHorizon + (vEndZ - clearHorizon) / ratioClear + 2;
    const maxEnd = Math.max(oncomingClear, pZStart + pLen);
    return maxEnd + waveGap;
  }

  // PATTERN 3: Hurdle & Skybridge Rhythm Across All 3 Lanes
  const shuffled = [...lanes].sort(() => Math.random() - 0.5);

  pushLowHurdle(gs, shuffled[0], zBase + 4);
  spawnCoinLine(gs, shuffled[0], zBase + 0.5, 4, 2.4, 0.8, true);

  pushHighGantry(gs, shuffled[1], zBase + 4);
  spawnCoinLine(gs, shuffled[1], zBase + 1, 4, 2.3, 0.55, false);

  pushVehicle(gs, {
    lane: shuffled[2],
    zStart: zBase + RAMP_LEN,
    length: 14,
    hasRamp: true,
    speedExtra: 0,
    variant: 'main',
  });
  spawnCoinLine(gs, shuffled[2], zBase + RAMP_LEN + 2, 4, 2.8, ROOF_H + 0.75, false);

  const followLane = lanes[Math.floor(Math.random() * 3)];
  if (Math.random() < 0.5) {
    pushLowHurdle(gs, followLane, zBase + 24);
  } else {
    pushHighGantry(gs, followLane, zBase + 24);
  }

  return zBase + 24 + waveGap;
}

export function initProps(gs) {
  gs.roadProps = [];
  for (let z = 6; z < MAX_Z; z += 11) {
    gs.roadProps.push({ side: -1, z, prevZ: z });
    gs.roadProps.push({ side: 1, z: z + 5.5, prevZ: z + 5.5 });
  }
}
