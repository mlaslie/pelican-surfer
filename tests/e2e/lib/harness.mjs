import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FALLBACK_NODE_PATH = '/Users/mlaslie/.npm/_npx/e41f203b7505f1fb/node_modules';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves Playwright via standard ESM import, NODE_PATH entries, or cached npx path.
 */
export async function loadPlaywright() {
  try {
    const mod = await import('playwright');
    if (mod?.chromium) return mod;
    if (mod?.default?.chromium) return mod.default;
  } catch {
    // Fall through to NODE_PATH / fallback resolution
  }

  const candidateBases = [];
  if (process.env.NODE_PATH) {
    for (const entry of process.env.NODE_PATH.split(path.delimiter)) {
      if (entry.trim()) candidateBases.push(entry.trim());
    }
  }
  candidateBases.push(FALLBACK_NODE_PATH);

  for (const base of candidateBases) {
    const indexMjs = path.join(base, 'playwright', 'index.mjs');
    try {
      await fs.access(indexMjs);
      const mod = await import(pathToFileURL(indexMjs).href);
      if (mod?.chromium) return mod;
      if (mod?.default?.chromium) return mod.default;
    } catch {
      // Try next candidate
    }
  }

  throw new Error(
    `Playwright module could not be resolved. Tried import('playwright') and NODE_PATH/fallback (${FALLBACK_NODE_PATH}).`,
  );
}

/**
 * Launches Chromium with background throttling disabled so rAF frame pacing is accurate across contexts.
 */
export async function launchBrowser(opts = {}) {
  const pw = await loadPlaywright();
  const headless =
    opts.headless !== undefined
      ? Boolean(opts.headless)
      : process.env.HEADLESS !== 'false';

  const browser = await pw.chromium.launch({
    headless,
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  return { browser, playwright: pw };
}

/**
 * Opens an isolated BrowserContext + Page at baseUrl, tracks runtime/HTTP errors,
 * and enforces the read-only window.__PELICAN_DEBUG__.getState() telemetry contract.
 */
export async function openGame(browser, baseUrl, opts = {}) {
  const viewport = opts.viewport || { width: 1280, height: 800 };
  const deviceScaleFactor = opts.deviceScaleFactor ?? 1;
  const hasTouch = Boolean(opts.hasTouch);
  const isMobile = Boolean(opts.isMobile);

  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    hasTouch,
    isMobile,
  });

  if (opts.seedBestScore !== undefined && opts.seedBestScore !== null) {
    await context.addInitScript((best) => {
      try {
        if (window.localStorage.getItem('pelican_surfer_best') === null) {
          window.localStorage.setItem('pelican_surfer_best', String(best));
        }
      } catch {
        // ignore
      }
    }, opts.seedBestScore);
  }

  if (opts.initScript) {
    await context.addInitScript(opts.initScript);
  }

  const page = await context.newPage();

  const tracker = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    httpErrors: [],
    assertNoErrors() {
      const problems = [];
      if (this.consoleErrors.length) {
        problems.push(`console.error: ${this.consoleErrors.join(' | ')}`);
      }
      if (this.pageErrors.length) {
        problems.push(`pageerror: ${this.pageErrors.join(' | ')}`);
      }
      if (this.requestFailures.length) {
        problems.push(`requestfailed: ${this.requestFailures.join(' | ')}`);
      }
      if (this.httpErrors.length) {
        problems.push(`http>=400: ${this.httpErrors.join(' | ')}`);
      }
      if (problems.length) {
        throw new Error(`Runtime errors detected: ${problems.join('; ')}`);
      }
    },
  };

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      tracker.consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    tracker.pageErrors.push(err?.message || String(err));
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.endsWith('/favicon.ico')) return;
    tracker.requestFailures.push(`${req.method()} ${url} (${req.failure()?.errorText || 'failed'})`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      const url = res.url();
      if (url.endsWith('/favicon.ico')) return;
      tracker.httpErrors.push(`${res.status()} ${url}`);
    }
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const deadline = Date.now() + 3000;
  let hasContract = false;
  let hasFirstFrame = false;
  while (Date.now() < deadline) {
    const probe = await page.evaluate(() => {
      const fn = window.__PELICAN_DEBUG__?.getState;
      if (typeof fn !== 'function') return { hasContract: false, frameCount: 0 };
      return { hasContract: true, frameCount: fn()?.frameCount ?? 0 };
    });
    hasContract = probe.hasContract;
    if (hasContract && probe.frameCount >= 1) {
      hasFirstFrame = true;
      break;
    }
    await sleep(25);
  }

  if (!hasContract) {
    await context.close().catch(() => {});
    throw new Error(
      'CONTRACT_MISSING: window.__PELICAN_DEBUG__.getState() is not defined (legacy game.js or incomplete M1 build; expected PROJECT.md §2 telemetry contract).',
    );
  }
  if (!hasFirstFrame) {
    await context.close().catch(() => {});
    throw new Error(
      'FIRST_FRAME_TIMEOUT: window.__PELICAN_DEBUG__.getState().frameCount remained 0 (initial rAF canvas paint did not complete within 3000ms).',
    );
  }

  return {
    context,
    page,
    tracker,
    async getState() {
      return getState(page);
    },
    async close() {
      await context.close().catch(() => {});
    },
  };
}

export async function getState(page) {
  return page.evaluate(() => window.__PELICAN_DEBUG__.getState());
}

export async function waitForState(page, predicate, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 4500;
  const pollMs = opts.pollMs ?? 20;
  const label = opts.label || 'state condition';
  const deadline = Date.now() + timeoutMs;
  let lastState = null;

  while (Date.now() <= deadline) {
    lastState = await getState(page);
    if (predicate(lastState)) {
      return lastState;
    }
    await sleep(pollMs);
  }

  const summary = lastState
    ? JSON.stringify({
        state: lastState.state,
        distance: Number(lastState.distance?.toFixed?.(2) ?? lastState.distance),
        speed: Number(lastState.speed?.toFixed?.(2) ?? lastState.speed),
        campusId: lastState.campusId,
        player: lastState.player
          ? {
              lane: lastState.player.lane,
              x: Number(lastState.player.x?.toFixed?.(2) ?? lastState.player.x),
              y: Number(lastState.player.y?.toFixed?.(2) ?? lastState.player.y),
              vy: Number(lastState.player.vy?.toFixed?.(2) ?? lastState.player.vy),
              onRoof: lastState.player.onRoof,
              duckAmount: Number(lastState.player.duckAmount?.toFixed?.(2) ?? lastState.player.duckAmount),
              stumbleTimer: Number(lastState.player.stumbleTimer?.toFixed?.(2) ?? lastState.player.stumbleTimer),
              sparkleTimer: Number(lastState.player.sparkleTimer?.toFixed?.(2) ?? lastState.player.sparkleTimer),
            }
          : null,
      })
    : 'null';

  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}. Last state: ${summary}`);
}

export async function startGame(page, via = 'button') {
  if (via === 'space') {
    await page.keyboard.press('Space');
  } else {
    await page.click('#btn-play');
  }
  return waitForState(page, (s) => s.state === 'playing' && s.tickCount > 0, {
    timeoutMs: 3000,
    label: `game start via ${via}`,
  });
}

/**
 * Samples N consecutive requestAnimationFrame ticks inside the browser to avoid Node<->CDP IPC jitter.
 */
export async function sampleFrames(page, count = 20) {
  return page.evaluate((n) => {
    return new Promise((resolve) => {
      const samples = [];
      function step(ts) {
        const s = window.__PELICAN_DEBUG__.getState();
        samples.push({
          rafTs: ts,
          state: s.state,
          frameCount: s.frameCount,
          tickCount: s.tickCount,
          lastDt: s.lastDt,
          maxDt: s.maxDt,
          worldTime: s.worldTime,
          distance: s.distance,
          speed: s.speed,
          roadScroll: s.roadScroll,
          campusTransition: s.campusTransition,
          camera: { ...s.camera },
          player: {
            lane: s.player.lane,
            targetX: s.player.targetX,
            x: s.player.x,
            y: s.player.y,
            vy: s.player.vy,
            tilt: s.player.tilt,
            duckAmount: s.player.duckAmount,
            onRoof: s.player.onRoof,
            grounded: s.player.grounded,
            screenRect: s.player.screenRect ? { ...s.player.screenRect } : null,
          },
          obstacles: s.obstacles.map((o) => ({
            id: o.id,
            type: o.type,
            lane: o.lane,
            zStart: o.zStart,
            zEnd: o.zEnd,
            hasRamp: o.hasRamp,
            oncoming: o.oncoming,
            smashed: o.smashed,
            screenRect: o.screenRect ? { ...o.screenRect } : null,
          })),
        });
        if (samples.length >= n) {
          resolve(samples);
        } else {
          requestAnimationFrame(step);
        }
      }
      requestAnimationFrame(step);
    });
  }, count);
}

/**
 * Simulates a main-thread frame stall inside rAF without triggering visibilitychange auto-pause.
 */
export async function simulateFrameSpike(page, spikeMs = 220) {
  return page.evaluate((ms) => {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        const before = window.__PELICAN_DEBUG__.getState();
        const end = performance.now() + ms;
        while (performance.now() < end) {
          // intentional busy wait to simulate frame spike
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const after = window.__PELICAN_DEBUG__.getState();
            resolve({ before, after });
          });
        });
      });
    });
  }, spikeMs);
}

/**
 * Sends a trusted CDP touch swipe across #game-canvas.
 */
export async function swipeCanvas(page, cdpSession, direction, opts = {}) {
  const box = await page.locator('#game-canvas').boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('Cannot swipe #game-canvas: boundingBox is empty');
  }
  const dist = opts.distance ?? 90;
  const cx = Math.round(box.x + box.width * 0.5);
  const cy = Math.round(box.y + box.height * 0.6);

  let dx = 0;
  let dy = 0;
  if (direction === 'left') dx = -dist;
  else if (direction === 'right') dx = dist;
  else if (direction === 'up') dy = -dist;
  else if (direction === 'down') dy = dist;
  else throw new Error(`Unknown swipe direction: ${direction}`);

  const p1 = { x: cx, y: cy, id: 1 };
  const p2 = { x: Math.round(cx + dx * 0.5), y: Math.round(cy + dy * 0.5), id: 1 };
  const p3 = { x: Math.round(cx + dx), y: Math.round(cy + dy), id: 1 };

  await cdpSession.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [p1],
  });
  await sleep(16);
  await cdpSession.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [p2],
  });
  await sleep(16);
  await cdpSession.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [p3],
  });
  await sleep(16);
  await cdpSession.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

/**
 * Clicks a campus pill in #campus-pills (supports 'mv', 'london', 'zurich', 'tokyo', 'nyc', 'sydney', 'auto').
 */
export async function clickCampusPill(page, campusId) {
  const exact = page.locator(`#campus-pills [data-campus="${campusId}"]`);
  if ((await exact.count()) > 0) {
    await exact.first().click();
    return;
  }
  if (campusId === 'auto') {
    const fallback = page.locator('#campus-pills button').filter({ hasText: /auto/i });
    if ((await fallback.count()) > 0) {
      await fallback.first().click();
      return;
    }
  }
  throw new Error(`Campus pill not found for "${campusId}"`);
}

function laneClearance(
  state,
  lane,
  prevZMap,
  dtWorld = 0.025,
  avoidRamps = false,
  ignoreObstacleId = null,
  allowBehindTargetZ = null,
  allowDuckHighGantry = false,
) {
  let minTti = Infinity;
  let wallMinTti = Infinity;
  let blockedNear = false;
  for (const o of state.obstacles) {
    if (o.smashed || o.lane !== lane || o.zEnd < -0.5) continue;
    if (ignoreObstacleId !== null && o.id === ignoreObstacleId) continue;
    if (allowBehindTargetZ !== null && o.zStart > allowBehindTargetZ) continue;
    if (
      state.player.onRoof &&
      state.player.y >= 2.2 &&
      o.type === 'vehicle' &&
      o.zStart <= Math.max(1.2, state.speed * 0.14) &&
      o.zEnd >= Math.max(2.2, state.speed * 0.16)
    ) {
      continue;
    }
    if (allowDuckHighGantry && o.type === 'high' && !state.player.onRoof && state.player.y < 0.45) {
      if (o.zStart > Math.max(3.0, state.speed * 0.20)) {
        continue;
      }
      if (o.zEnd >= -0.5) {
        blockedNear = true;
      }
    }
    const rampLen = o.rampLen || 6.2;
    const safeRampEntry = rampLen + Math.max(1.0, state.speed * 0.14);
    if (o.type === 'vehicle' && o.hasRamp && !o.oncoming) {
      if (!state.player.onRoof && state.player.y < 1.5 && o.zStart < safeRampEntry && o.zEnd >= -0.5) {
        blockedNear = true;
      } else if (!avoidRamps && o.zStart >= safeRampEntry) {
        continue;
      }
    }
    const minSafeZ = o.oncoming
      ? Math.max(6.0, (state.speed + 16) * 0.22)
      : Math.max(3.5, state.speed * 0.20);
    if (o.zStart <= minSafeZ && o.zEnd >= -0.5) {
      blockedNear = true;
    }
    const prevZ = prevZMap.get(o.id);
    const estSpeed =
      prevZ !== undefined && prevZ > o.zStart && dtWorld > 0.005
        ? Math.max(state.speed, Math.min(80, (prevZ - o.zStart) / dtWorld))
        : state.speed + (o.oncoming ? 16 : 0);
    const tti = Math.max(0, o.zStart) / Math.max(1, estSpeed);
    if (tti < minTti) minTti = tti;
    if (o.type === 'vehicle' && tti < wallMinTti) wallMinTti = tti;
  }
  return { minTti, wallMinTti, blockedNear };
}

/**
 * Pure opaque-box reactive gameplay pilot reading getState() and sending real keyboard inputs.
 */
export async function driveRun(page, opts = {}) {
  const maxMs = opts.maxMs ?? 12000;
  const pollMs = opts.pollMs ?? 25;
  const until = opts.until ?? (() => false);
  const onSample = opts.onSample ?? null;
  const desiredLaneFn = opts.desiredLaneFn ?? null;
  const preferRoof = Boolean(opts.preferRoof);
  const preferAdjacentRoof = Boolean(opts.preferAdjacentRoof);
  const preferCoins = Boolean(opts.preferCoins);
  const preferSparkle = Boolean(opts.preferSparkle);
  const avoidSparkles = Boolean(opts.avoidSparkles);
  const avoidRamps = Boolean(opts.avoidRamps);
  const ignoreHighGantry = Boolean(opts.ignoreHighGantry);
  const ignoreLowHurdle = Boolean(opts.ignoreLowHurdle);

  const startTime = Date.now();
  let lastLaneActionAt = 0;
  let lastJumpAt = 0;
  let lastDuckAt = 0;
  let prevWorldTime = null;
  const prevZMap = new Map();
  let lastState = null;

  while (Date.now() - startTime < maxMs) {
    const state = await getState(page);
    const dtWorld = prevWorldTime !== null ? state.worldTime - prevWorldTime : 0;
    lastState = state;
    if (onSample) await onSample(state);
    if (until(state)) {
      return state;
    }
    if (state.state !== 'playing') {
      return state;
    }

    const now = Date.now();
    const curLane = state.player.lane;

    const rawGoal = desiredLaneFn ? desiredLaneFn(state) : null;
    const customGoal =
      typeof rawGoal === 'number'
        ? { lane: rawGoal, ignoreObstacleId: null, allowBehindTarget: false }
        : rawGoal && typeof rawGoal === 'object'
          ? {
              lane: rawGoal.lane ?? null,
              ignoreObstacleId: rawGoal.ignoreObstacleId ?? null,
              allowBehindTarget: Boolean(rawGoal.allowBehindTarget),
            }
          : null;
    const customTargetObs =
      customGoal?.ignoreObstacleId != null
        ? state.obstacles.find((o) => o.id === customGoal.ignoreObstacleId && !o.smashed && o.zEnd > -0.5)
        : null;

    // Identify supporting vehicle only when actually onRoof (never while climbing a ramp with zStart > 0)
    const supportVeh = state.player.onRoof
      ? state.obstacles.find(
          (o) =>
            !o.smashed &&
            o.type === 'vehicle' &&
            o.lane === curLane &&
            o.zStart <= 0.1 &&
            o.zEnd >= -0.25,
        ) || null
      : null;

    // Look for threatening obstacles in current lane with world-time TTI
    const laneObstacles = state.obstacles
      .filter((o) => {
        if (o.smashed || o.lane !== curLane || o.zEnd <= -0.4) return false;
        if (supportVeh && o.id === supportVeh.id) return false;
        return true;
      })
      .map((o) => {
        const prevZ = prevZMap.get(o.id);
        const approachSpeed =
          prevZ !== undefined && prevZ > o.zStart && dtWorld > 0.005
            ? Math.max(state.speed, Math.min(80, (prevZ - o.zStart) / dtWorld))
            : state.speed + (o.oncoming ? 16 : 0);
        const tti = o.zStart / Math.max(1, approachSpeed);
        return { obs: o, tti };
      })
      .sort((a, b) => a.tti - b.tti || a.obs.zStart - b.obs.zStart);

    const nextEntry = laneObstacles[0] || null;
    const nextObs = nextEntry ? nextEntry.obs : null;
    const curGroundSp =
      preferSparkle && !avoidSparkles
        ? state.collectibles
            .filter(
              (c) =>
                c.type === 'sparkle' &&
                !c.collected &&
                c.y <= 1.5 &&
                c.lane === curLane &&
                c.z > 0 &&
                c.z < 75,
            )
            .sort((a, b) => a.z - b.z)[0] || null
        : null;
    const curGroundSpClose = Boolean(
      curGroundSp && curGroundSp.z / Math.max(1, state.speed) < 0.75,
    );
    const urgentVehEntry = laneObstacles.find(({ obs, tti }) => {
      if (obs.type !== 'vehicle') return false;
      if (customTargetObs && customTargetObs.lane === curLane && customTargetObs.zStart > -0.5) {
        if (customGoal.allowBehindTarget && obs.zStart > customTargetObs.zEnd) return false;
        if (!customGoal.allowBehindTarget && obs.zStart > customTargetObs.zEnd + 14) return false;
      }
      const isRampApproach = obs.hasRamp && !obs.oncoming && !avoidRamps && obs.zStart >= 0;
      if (state.player.onRoof) {
        // While on roof, ignore chained roofs touching supportVeh; dodge oncoming or spaced vehicles ahead of roof exit
        const gapAfterSupport = supportVeh ? obs.zStart - supportVeh.zEnd : obs.zStart;
        const chainedRoof = !obs.oncoming && gapAfterSupport <= 0.25;
        return !chainedRoof && obs.zStart > 0.25 && tti < 1.35;
      }
      const ttiLimit = curGroundSpClose && obs.zStart > curGroundSp.z + 2 ? 0.5 : 1.55;
      return !isRampApproach && obs.zStart > -0.5 && tti < ttiLimit;
    });
    let handledUrgent = false;

    if (urgentVehEntry && now - lastLaneActionAt > 150) {
      const bestLane = pickSafestAdjacentLane(
        state,
        curLane,
        prevZMap,
        dtWorld,
        avoidRamps,
        urgentVehEntry.tti,
      );
      if (bestLane !== curLane) {
        await page.keyboard.press(bestLane < curLane ? 'ArrowLeft' : 'ArrowRight');
        lastLaneActionAt = now;
        handledUrgent = true;
      } else if (
        !state.player.onRoof &&
        !urgentVehEntry.obs.oncoming &&
        state.player.y < 0.3 &&
        state.player.grounded &&
        urgentVehEntry.tti >= 0.18 &&
        urgentVehEntry.tti <= 0.46 &&
        now - lastJumpAt > 240
      ) {
        // Last-resort vault onto parked vehicle roof when both exits are blocked
        await page.keyboard.press('ArrowUp');
        lastJumpAt = now;
        handledUrgent = true;
      }
    }

    if (!handledUrgent && nextObs) {
      const tti = nextEntry.tti;

      if (nextObs.type === 'low' && !ignoreLowHurdle) {
        if (
          state.player.onRoof &&
          supportVeh &&
          nextObs.zStart > supportVeh.zEnd &&
          (nextObs.zStart - supportVeh.zEnd) / Math.max(1, state.speed) < 0.65 &&
          tti <= 0.95 &&
          now - lastLaneActionAt > 150
        ) {
          const bestLane = pickSafestAdjacentLane(state, curLane, prevZMap, dtWorld, avoidRamps, tti);
          if (bestLane !== curLane) {
            await page.keyboard.press(bestLane < curLane ? 'ArrowLeft' : 'ArrowRight');
            lastLaneActionAt = now;
            handledUrgent = true;
          }
        } else if (tti <= 0.34 && tti >= 0.02 && state.player.y < 0.3 && now - lastJumpAt > 240) {
          await page.keyboard.press('ArrowUp');
          lastJumpAt = now;
          handledUrgent = true;
        } else if (
          !state.player.grounded &&
          state.player.y >= 0.3 &&
          state.player.y < 1.8 &&
          state.player.vy <= 2 &&
          tti <= 0.55 &&
          now - lastLaneActionAt > 150
        ) {
          const bestLane = pickSafestAdjacentLane(state, curLane, prevZMap, dtWorld, avoidRamps, tti);
          if (bestLane !== curLane) {
            await page.keyboard.press(bestLane < curLane ? 'ArrowLeft' : 'ArrowRight');
            lastLaneActionAt = now;
            handledUrgent = true;
          }
        }
      } else if (nextObs.type === 'high' && !ignoreHighGantry) {
        if (state.player.onRoof || state.player.y > 0.6) {
          // On roof or mid-air approaching high gantry: switch lane or fast-fall underneath
          if (tti <= 1.05 && now - lastLaneActionAt > 150) {
            const bestLane = pickSafestAdjacentLane(state, curLane, prevZMap, dtWorld, avoidRamps, tti);
            if (bestLane !== curLane) {
              await page.keyboard.press(bestLane < curLane ? 'ArrowLeft' : 'ArrowRight');
              lastLaneActionAt = now;
              handledUrgent = true;
            } else if (!state.player.onRoof && tti <= 0.55 && now - lastDuckAt > 240) {
              await page.keyboard.press('ArrowDown');
              lastDuckAt = now;
              handledUrgent = true;
            }
          }
        } else if (tti <= 0.42 && tti >= 0.02 && now - lastDuckAt > 260) {
          await page.keyboard.press('ArrowDown');
          lastDuckAt = now;
          handledUrgent = true;
        }
      } else if (nextObs.type === 'vehicle') {
        const isRampApproach = nextObs.hasRamp && !nextObs.oncoming && !avoidRamps && nextObs.zStart >= 0;
        const behindCustomTarget =
          customTargetObs &&
          customTargetObs.lane === curLane &&
          customTargetObs.zStart > -0.5 &&
          ((customGoal.allowBehindTarget && nextObs.zStart > customTargetObs.zEnd) ||
            (!customGoal.allowBehindTarget && nextObs.zStart > customTargetObs.zEnd + 14));

        const fallbackTtiLimit =
          curGroundSpClose && nextObs.zStart > curGroundSp.z + 2 ? 0.5 : 1.55;
        if (
          !behindCustomTarget &&
          !isRampApproach &&
          !state.player.onRoof &&
          nextObs.zStart > -0.5 &&
          tti < fallbackTtiLimit
        ) {
          if (now - lastLaneActionAt > 150) {
            const bestLane = pickSafestAdjacentLane(state, curLane, prevZMap, dtWorld, avoidRamps, tti);
            if (bestLane !== curLane) {
              await page.keyboard.press(bestLane < curLane ? 'ArrowLeft' : 'ArrowRight');
              lastLaneActionAt = now;
              handledUrgent = true;
            }
          }
        }
      }
    }

    if (!handledUrgent && avoidSparkles && now - lastLaneActionAt > 150) {
      const aheadSparkle = state.collectibles.find(
        (c) =>
          c.type === 'sparkle' &&
          !c.collected &&
          c.y <= 1.5 &&
          c.lane === curLane &&
          c.z > 0 &&
          c.z < 18,
      );
      if (aheadSparkle) {
        const candidates = [];
        if (curLane - 1 >= -1) candidates.push(curLane - 1);
        if (curLane + 1 <= 1) candidates.push(curLane + 1);
        let bestEscape = curLane;
        let bestScore = -1;
        for (const lane of candidates) {
          const info = laneClearance(state, lane, prevZMap, dtWorld, avoidRamps);
          if (!info.blockedNear && info.wallMinTti > 0.8) {
            const hasAdjSparkle = state.collectibles.some(
              (c) => c.type === 'sparkle' && !c.collected && c.y <= 1.5 && c.lane === lane && c.z > 0 && c.z < 18,
            );
            const score = (hasAdjSparkle ? 0 : 100) + Math.min(info.minTti, 50);
            if (score > bestScore) {
              bestScore = score;
              bestEscape = lane;
            }
          }
        }
        if (bestEscape !== curLane) {
          await page.keyboard.press(bestEscape < curLane ? 'ArrowLeft' : 'ArrowRight');
          lastLaneActionAt = now;
          handledUrgent = true;
        }
      }
    }

    const onCurrentRamp = Boolean(
      nextObs &&
        nextObs.type === 'vehicle' &&
        nextObs.hasRamp &&
        !nextObs.oncoming &&
        !avoidRamps &&
        nextObs.zStart >= 0,
    );
    const groundSp =
      preferSparkle && !avoidSparkles
        ? state.collectibles
            .filter((c) => c.type === 'sparkle' && !c.collected && c.y <= 1.5 && c.z > 2 && c.z < 75)
            .sort((a, b) => a.z - b.z)[0] || null
        : null;
    const roofSp =
      preferSparkle && !avoidSparkles
        ? state.collectibles
            .filter((c) => c.type === 'sparkle' && !c.collected && c.y > 1.5 && c.z > 2 && c.z < 75)
            .sort((a, b) => a.z - b.z)[0] || null
        : null;
    const committedToRoofSp = Boolean(
      roofSp &&
        roofSp.z < 42 &&
        (state.player.onRoof || (onCurrentRamp && nextObs.zStart <= (nextObs.rampLen || 6.2) + 4)) &&
        (!groundSp || roofSp.z <= groundSp.z + 10),
    );
    const steerCooldown =
      state.player.onRoof && committedToRoofSp
        ? 80
        : customGoal && customGoal.lane !== null
          ? 160
          : 200;
    if (!handledUrgent && now - lastLaneActionAt > steerCooldown) {
      let desiredLane = customGoal && customGoal.lane !== null ? customGoal.lane : null;

      if (desiredLane === null && preferSparkle && !avoidSparkles) {
        if (groundSp && !committedToRoofSp) {
          desiredLane = groundSp.lane;
        } else if (roofSp) {
          if (state.player.onRoof) {
            if (Math.abs(roofSp.lane - curLane) <= 1) {
              desiredLane = roofSp.lane;
            }
          } else if (onCurrentRamp) {
            desiredLane = curLane;
          } else {
            const pairRamp = state.obstacles
              .filter((o) => {
                if (o.smashed || o.type !== 'vehicle' || !o.hasRamp || o.oncoming) return false;
                if (o.zStart >= roofSp.z || roofSp.z - o.zEnd > 14 || Math.abs(o.lane - roofSp.lane) > 1) return false;
                const minZ =
                  o.lane === curLane
                    ? 0
                    : (o.rampLen || 6.2) + Math.max(1.0, state.speed * 0.14);
                return o.zStart >= minZ;
              })
              .sort((a, b) => (roofSp.z - a.zStart) - (roofSp.z - b.zStart))[0];
            if (pairRamp) desiredLane = pairRamp.lane;
          }
        }
      }

      let pairedRampTarget = null;
      if (desiredLane === null && (preferRoof || preferAdjacentRoof)) {
        const minRampEntryZ = (o) => (o.rampLen || 6.2) + Math.max(4.0, state.speed * 0.16);
        const hasAdjacentChain = (s, o) =>
          s.obstacles.some(
            (adj) =>
              !adj.smashed &&
              adj.type === 'vehicle' &&
              !adj.oncoming &&
              adj.id !== o.id &&
              Math.abs(adj.lane - o.lane) === 1 &&
              adj.zStart < o.zEnd - 2.0 &&
              adj.zEnd > o.zStart + 2.0,
          );
        const currentLaneRamp =
          nextObs &&
          nextObs.type === 'vehicle' &&
          nextObs.hasRamp &&
          !nextObs.oncoming &&
          !avoidRamps &&
          nextObs.zStart >= 0;

        if (preferAdjacentRoof) {
          pairedRampTarget =
            state.obstacles
              .filter(
                (o) =>
                  !o.smashed &&
                  o.type === 'vehicle' &&
                  o.hasRamp &&
                  !o.oncoming &&
                  o.zStart > minRampEntryZ(o) &&
                  hasAdjacentChain(state, o),
              )
              .sort((a, b) => a.zStart - b.zStart)[0] || null;
          if (currentLaneRamp) {
            if (hasAdjacentChain(state, nextObs) || nextObs.zStart < minRampEntryZ(nextObs) + 4) {
              desiredLane = curLane;
            } else if (pairedRampTarget && pairedRampTarget.id !== nextObs.id) {
              desiredLane = pairedRampTarget.lane;
            }
          } else if (pairedRampTarget) {
            desiredLane = pairedRampTarget.lane;
          }
        } else if (currentLaneRamp) {
          desiredLane = curLane;
        } else {
          const rampVeh = state.obstacles
            .filter((o) => !o.smashed && o.type === 'vehicle' && o.hasRamp && o.zStart > minRampEntryZ(o))
            .sort((a, b) => a.zStart - b.zStart)[0];
          if (rampVeh) desiredLane = rampVeh.lane;
        }
      }

      if (desiredLane === null && preferCoins) {
        const coin = state.collectibles
          .filter((c) => c.type === 'coin' && !c.collected && c.z > 3 && c.z < 35 && c.y < 1.5)
          .sort((a, b) => a.z - b.z)[0];
        if (coin) desiredLane = coin.lane;
      }

      if (desiredLane !== null && desiredLane !== curLane) {
        const stepLane = desiredLane > curLane ? curLane + 1 : curLane - 1;
        const ignoreId = customGoal?.ignoreObstacleId ?? null;
        let allowBehindZ =
          customGoal?.allowBehindTarget && customTargetObs && customTargetObs.lane === stepLane
            ? customTargetObs.zEnd
            : null;
        if (
          allowBehindZ === null &&
          preferSparkle &&
          committedToRoofSp &&
          roofSp &&
          state.player.onRoof &&
          stepLane === roofSp.lane
        ) {
          allowBehindZ = roofSp.z + 2;
        }
        const isGroundSparkleStep = Boolean(
          preferSparkle &&
            !avoidSparkles &&
            groundSp &&
            desiredLane === groundSp.lane &&
            stepLane === groundSp.lane,
        );
        const allowDuckHighGantry = Boolean(isGroundSparkleStep && !ignoreHighGantry);
        const info = laneClearance(
          state,
          stepLane,
          prevZMap,
          dtWorld,
          avoidRamps,
          ignoreId,
          allowBehindZ,
          allowDuckHighGantry,
        );
        const targetIsInStep = Boolean(allowBehindZ !== null);
        const hasEscape =
          targetIsInStep ||
          state.player.onRoof ||
          info.wallMinTti >= 2.4 ||
          [-1, 0, 1]
            .filter((l) => Math.abs(l - stepLane) === 1)
            .some((esc) => {
              const escIgnore = customTargetObs && customTargetObs.lane === esc ? ignoreId : null;
              const escBehind =
                customGoal?.allowBehindTarget && customTargetObs && customTargetObs.lane === esc
                  ? customTargetObs.zEnd
                  : null;
              const escInfo = laneClearance(state, esc, prevZMap, dtWorld, avoidRamps, escIgnore, escBehind);
              return !escInfo.blockedNear && escInfo.wallMinTti > 1.2;
            });
        const spTti = isGroundSparkleStep ? groundSp.z / Math.max(1, state.speed) : null;
        let isPairedRampCross = false;
        if (
          preferAdjacentRoof &&
          pairedRampTarget &&
          desiredLane === pairedRampTarget.lane &&
          Math.abs(desiredLane - curLane) === 2
        ) {
          const pairedRampClear = laneClearance(state, desiredLane, prevZMap, dtWorld, avoidRamps);
          if (!pairedRampClear.blockedNear && pairedRampClear.minTti > 0.65) {
            isPairedRampCross = true;
          }
        }
        const reqWallTti = isGroundSparkleStep
          ? Math.min(1.4, spTti + 0.35)
          : isPairedRampCross
            ? 0.55
            : 1.4;
        const reqMinTti = isGroundSparkleStep
          ? Math.min(0.65, spTti + 0.25)
          : isPairedRampCross
            ? 0.55
            : 0.65;
        const hasSparkleEscape =
          hasEscape ||
          (isGroundSparkleStep &&
            (info.wallMinTti >= 1.4 ||
              [-1, 0, 1]
                .filter((l) => Math.abs(l - stepLane) === 1)
                .some(
                  (esc) =>
                    !state.obstacles.some((o) => {
                      if (o.smashed || o.lane !== esc || o.type !== 'vehicle' || o.zEnd < -0.5) {
                        return false;
                      }
                      const prevZ = prevZMap.get(o.id);
                      const estSpeed =
                        prevZ !== undefined && prevZ > o.zStart && dtWorld > 0.005
                          ? Math.max(state.speed, Math.min(80, (prevZ - o.zStart) / dtWorld))
                          : state.speed + (o.oncoming ? 16 : 0);
                      const zStartAtEnd = o.zStart - estSpeed * (spTti + 0.55);
                      const zEndAtStart = o.zEnd - estSpeed * spTti;
                      return zStartAtEnd <= 3.5 && zEndAtStart >= -0.5;
                    }),
                )));
        const stepHasSparkle =
          avoidSparkles &&
          !(customGoal && customGoal.lane !== null) &&
          state.collectibles.some(
            (c) => c.type === 'sparkle' && !c.collected && c.y <= 1.5 && c.lane === stepLane && c.z > 0 && c.z < 18,
          );
        if (
          !stepHasSparkle &&
          !info.blockedNear &&
          info.wallMinTti > reqWallTti &&
          info.minTti > reqMinTti &&
          hasSparkleEscape
        ) {
          await page.keyboard.press(stepLane < curLane ? 'ArrowLeft' : 'ArrowRight');
          lastLaneActionAt = now;
        }
      }
    }

    prevWorldTime = state.worldTime;
    prevZMap.clear();
    for (const o of state.obstacles) {
      prevZMap.set(o.id, o.zStart);
    }

    await sleep(pollMs);
  }

  return lastState;
}

function isEdgeLaneBoxedIn(state, edgeLane, wallMinTti, prevZMap, dtWorld, maxMidStart = 0.45) {
  if (edgeLane === 0 || !Number.isFinite(wallMinTti) || wallMinTti >= 2.2) return false;
  for (const o of state.obstacles) {
    if (o.smashed || o.lane !== 0 || o.type !== 'vehicle' || o.zEnd < -0.5) continue;
    const prevZ = prevZMap.get(o.id);
    const estSpeed =
      prevZ !== undefined && prevZ > o.zStart && dtWorld > 0.005
        ? Math.max(state.speed, Math.min(80, (prevZ - o.zStart) / dtWorld))
        : state.speed + (o.oncoming ? 16 : 0);
    const tMidStart = Math.max(0, o.zStart) / Math.max(1, estSpeed);
    const tMidClear = (o.zEnd + 0.5) / Math.max(1, estSpeed);
    // Lane 0 is already blocking or about to block before the edge lane's vehicle arrives
    if (tMidStart <= maxMidStart && tMidClear >= wallMinTti - 0.25) {
      return true;
    }
  }
  return false;
}

function pickSafestAdjacentLane(
  state,
  curLane,
  prevZMap,
  dtWorld = 0.025,
  avoidRamps = false,
  curThreatTti = Infinity,
) {
  const candidates = [];
  if (curLane - 1 >= -1) candidates.push(curLane - 1);
  if (curLane + 1 <= 1) candidates.push(curLane + 1);

  let bestLane = curLane;
  let bestScore = -1;
  let bestWallTti = -1;

  for (const lane of candidates) {
    const { minTti, wallMinTti, blockedNear } = laneClearance(state, lane, prevZMap, dtWorld, avoidRamps);
    if (blockedNear) continue;
    const boxedIn = curLane === 0 && isEdgeLaneBoxedIn(state, lane, wallMinTti, prevZMap, dtWorld);
    const rawScore =
      wallMinTti >= 2.5 && minTti > 0.45 ? 100 + Math.min(minTti, 50) : Math.min(wallMinTti, minTti);
    const score = boxedIn ? Math.min(rawScore, 0.35) : rawScore;
    if (score > bestScore) {
      bestScore = score;
      bestLane = lane;
      bestWallTti = wallMinTti;
    }
  }

  if (bestLane === curLane) return curLane;
  if (Number.isFinite(curThreatTti)) {
    if (curThreatTti >= 0.65) {
      // Allow immediate escape from an edge lane through lane 0 before lane 0 closes, if opposite lane is safer
      const edgeEscapeReady =
        curLane !== 0 &&
        bestLane === 0 &&
        bestWallTti > 0.36 &&
        isEdgeLaneBoxedIn(state, curLane, curThreatTti, prevZMap, dtWorld, 0.65) &&
        laneClearance(state, -curLane, prevZMap, dtWorld, avoidRamps).wallMinTti > curThreatTti + 0.15;
      // Avoid switching from a moderate-margin lane into an equal/worse lane (anti-ping-pong)
      if (!edgeEscapeReady && bestWallTti < 2.2 && bestWallTti < curThreatTti + 0.2) {
        return curLane;
      }
    } else if (bestWallTti <= curThreatTti && bestWallTti < 0.55) {
      return curLane;
    }
  }

  return bestScore > 0.25 ? bestLane : curLane;
}

/**
 * Restarts from gameover via #btn-play, or performs a clean page.reload() + startGame fallback
 * when an attempt expires while still playing/paused. Preserves locked campus and mute state.
 */
export async function restartOrReloadToPlaying(page, opts = {}) {
  const label = opts.label || 'restart';
  const forceReload = Boolean(opts.forceReload);
  let state = null;
  try {
    state = await getState(page);
  } catch {
    state = null;
  }

  if (!forceReload && state && state.state === 'gameover') {
    await page.click('#btn-play');
    state = await waitForState(page, (st) => st.state === 'playing' && st.tickCount > 0, {
      timeoutMs: 3000,
      label: `restart via #btn-play (${label})`,
    });
  } else {
    const prevCampusId = state?.lockedCampus ? state.campusId : null;
    const wasMuted = await page
      .evaluate(() => Boolean(document.getElementById('btn-mute')?.textContent?.includes('Muted')))
      .catch(() => false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloadDeadline = Date.now() + 3000;
    let reloaded = false;
    while (Date.now() < reloadDeadline) {
      const probe = await page
        .evaluate(() => {
          const st = window.__PELICAN_DEBUG__?.getState?.();
          return st ? { state: st.state, frameCount: st.frameCount ?? 0 } : null;
        })
        .catch(() => null);
      if (probe && probe.state === 'start' && probe.frameCount >= 1) {
        reloaded = true;
        break;
      }
      await sleep(25);
    }
    if (!reloaded) {
      throw new Error(
        `Timed out after 3000ms waiting for clean reload state='start' & frameCount>=1 (${label})`,
      );
    }
    if (prevCampusId) {
      await clickCampusPill(page, prevCampusId);
    }
    if (wasMuted) {
      await page.keyboard.press('KeyM');
    }
    state = await startGame(page, 'button');
  }

  if (opts.onReset) {
    await opts.onReset(page, state);
    state = await getState(page);
  }
  return state;
}

/**
 * Runs an RNG/timing-sensitive attempt across a multi-attempt restart/reload budget.
 * Only retries when attemptFn returns { ok: false } or throws an error matching shouldRetryError.
 * Post-condition assertions outside/after matching or non-retryable errors fail immediately.
 */
export async function runWithRestartBudget(page, opts, attemptFn) {
  const budgets =
    Array.isArray(opts?.budgets) && opts.budgets.length > 0 ? opts.budgets : [20000, 20000];
  const label = opts?.label || 'runWithRestartBudget';
  const shouldRetryError = opts?.shouldRetryError ?? (() => false);
  let lastError = null;
  let lastReason = null;

  for (let attempt = 0; attempt < budgets.length; attempt++) {
    if (attempt > 0) {
      await restartOrReloadToPlaying(page, {
        label: `${label} attempt ${attempt + 1}`,
        forceReload: Boolean(opts?.forceReload),
        onReset: opts?.onReset,
      });
    }
    try {
      const outcome = await attemptFn(attempt, budgets[attempt]);
      if (outcome && outcome.ok) {
        return outcome.result !== undefined ? outcome.result : outcome;
      }
      lastReason = outcome?.reason || 'attempt did not satisfy condition';
    } catch (err) {
      lastError = err;
      if (!shouldRetryError(err) || attempt + 1 >= budgets.length) {
        throw err;
      }
    }
  }

  if (lastError) throw lastError;
  throw new Error(
    `${label} failed after ${budgets.length} attempts (${budgets.join('+')}ms): ${lastReason}`,
  );
}

/**
 * Drives with preferSparkle across a multi-attempt budget, restarting via #btn-play on gameover,
 * and throws unconditionally if sparkleTimer > minTimer is not reached while playing.
 */
export async function acquireSparkle(page, opts = {}) {
  const budgets =
    Array.isArray(opts.budgets) && opts.budgets.length > 0 ? opts.budgets : [82000, 80000];
  const minTimer = opts.minTimer ?? 0;
  const pollMs = opts.pollMs ?? 20;
  const label = opts.label || 'Gemini Sparkle acquisition';

  let state = await getState(page);
  for (let attempt = 0; attempt < budgets.length; attempt++) {
    if (state.state === 'gameover') {
      await page.click('#btn-play');
      state = await waitForState(page, (st) => st.state === 'playing' && st.tickCount > 0, {
        timeoutMs: 3000,
        label: `retry ${attempt} for ${label}`,
      });
    } else if (state.state !== 'playing') {
      throw new Error(`Cannot acquire sparkle from unexpected state "${state.state}" (${label})`);
    }

    if (state.player.sparkleTimer > minTimer) {
      return state;
    }

    state = await driveRun(page, {
      maxMs: budgets[attempt],
      pollMs,
      preferSparkle: true,
      until: (st) => st.player.sparkleTimer > minTimer,
    });

    if (state.state === 'playing' && state.player.sparkleTimer > minTimer) {
      return state;
    }

    if (attempt + 1 < budgets.length && state.state === 'playing') {
      const prevCampusId = state.lockedCampus ? state.campusId : null;
      const wasMuted = await page.evaluate(() =>
        Boolean(document.getElementById('btn-mute')?.textContent?.includes('Muted')),
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      const reloadDeadline = Date.now() + 3000;
      let reloaded = false;
      while (Date.now() < reloadDeadline) {
        const probe = await page.evaluate(() => {
          const st = window.__PELICAN_DEBUG__?.getState?.();
          return st ? { state: st.state, frameCount: st.frameCount ?? 0 } : null;
        });
        if (probe && probe.state === 'start' && probe.frameCount >= 1) {
          reloaded = true;
          break;
        }
        await sleep(25);
      }
      if (!reloaded) {
        throw new Error(
          `Timed out after 3000ms waiting for clean reload state='start' & frameCount>=1 (${label})`,
        );
      }
      if (prevCampusId) {
        await clickCampusPill(page, prevCampusId);
      }
      if (wasMuted) {
        await page.keyboard.press('KeyM');
      }
      state = await startGame(page, 'button');
      if (opts.onReset) {
        await opts.onReset(page, state);
        state = await getState(page);
      }
    }
  }

  throw new Error(
    `Failed to acquire sparkle (sparkleTimer > ${minTimer}) within ${budgets.length} attempts (${budgets.join('+')}ms) for ${label}: state=${state?.state}, sparkleTimer=${state?.player?.sparkleTimer}, distance=${state?.distance?.toFixed?.(1)}`,
  );
}

/**
 * Drives safely until a vehicle overlaps z=0 in an adjacent lane, then switches laterally into its side.
 */
export async function triggerSideBump(page, opts = {}) {
  const maxMs = opts.maxMs ?? 20000;
  const minZEnd = opts.minZEnd ?? 1.8;
  const allowOncoming = opts.allowOncoming ?? true;
  const isDoubleBump = Boolean(opts.doubleBump) || minZEnd >= 7;
  const reqCurClearSec = opts.minCurClearSec ?? (isDoubleBump ? 0.65 : 0.45);
  let bumpTarget = null;

  const before = await driveRun(page, {
    maxMs,
    pollMs: 20,
    avoidRamps: true,
    avoidSparkles: true,
    until: (s) => {
      if (
        s.state !== 'playing' ||
        !s.player.grounded ||
        s.player.onRoof ||
        s.player.y >= 0.15 ||
        s.player.sparkleTimer > 0 ||
        Math.abs(s.player.x - s.player.targetX) >= 0.15
      ) {
        return false;
      }
      const cur = s.player.lane;
      for (const o of s.obstacles) {
        if (o.smashed || o.lane !== cur || o.zEnd < -0.25) continue;
        const effZStart =
          o.type === 'vehicle' && o.hasRamp && !o.oncoming
            ? o.zStart - (o.rampLen || 6.2)
            : o.zStart;
        const approachSpeed = Math.max(1, s.speed + (o.oncoming ? 16 : 0));
        if (effZStart / approachSpeed < reqCurClearSec) {
          return false;
        }
      }
      const adj = s.obstacles.find((o) => {
        if (o.smashed || o.type !== 'vehicle' || Math.abs(o.lane - cur) !== 1) return false;
        if (!allowOncoming && o.oncoming) return false;
        const reqZEnd = o.oncoming
          ? Math.max(minZEnd, (s.speed + 16) * 0.35, 11.5)
          : Math.max(minZEnd, s.speed * (isDoubleBump ? 0.5 : 0.25));
        return (
          o.zStart < -0.75 &&
          o.zEnd > reqZEnd &&
          (opts.targetLane === undefined || o.lane === opts.targetLane)
        );
      });
      if (adj) {
        bumpTarget = adj;
        return true;
      }
      return false;
    },
  });

  if (!bumpTarget) {
    throw new Error(
      `Could not find an adjacent vehicle overlapping z=0 to trigger side-bump (state=${before?.state}, dist=${before?.distance?.toFixed?.(1)})`,
    );
  }

  const prevStumble = before.player.stumbleTimer;
  const key = bumpTarget.lane < before.player.lane ? 'ArrowLeft' : 'ArrowRight';
  await page.keyboard.press(key);

  const after = await waitForState(
    page,
    (s) =>
      s.state === 'gameover' ||
      (prevStumble <= 0.25 ? s.player.stumbleTimer > 2.0 : s.player.stumbleTimer > prevStumble + 0.5),
    { timeoutMs: 1800, pollMs: 15, label: 'side-bump collision outcome' },
  );

  return { before, after, vehicleId: bumpTarget.id, bumpLane: bumpTarget.lane, key };
}

/**
 * Steers into a non-ramp obstacle and holds lane to reliably produce a head-on Wipeout ('gameover').
 */
export async function triggerHeadOnCrash(page, opts = {}) {
  const maxMs = typeof opts === 'number' ? opts : (opts?.maxMs ?? 20000);
  const startTime = Date.now();
  const initial = await getState(page);
  if (initial.state === 'gameover') return initial;

  if (initial.player.sparkleTimer > 0) {
    await driveRun(page, {
      maxMs: Math.max(1000, maxMs - 3000),
      pollMs: 25,
      avoidSparkles: true,
      until: (s) => s.state !== 'playing' || s.player.sparkleTimer <= 0,
    });
  }

  const deadline = startTime + maxMs;
  let lockedTargetId = null;

  while (Date.now() < deadline) {
    const s = await getState(page);
    if (s.state === 'gameover') return s;
    if (s.state !== 'playing' || s.player.sparkleTimer > 0) {
      if (s.player.sparkleTimer > 0) {
        const remainingMs = deadline - Date.now();
        if (remainingMs > 500) {
          await driveRun(page, {
            maxMs: Math.max(200, remainingMs - 500),
            pollMs: 25,
            avoidSparkles: true,
            until: (s2) => s2.state !== 'playing' || s2.player.sparkleTimer <= 0,
          });
          continue;
        }
      }
      await sleep(30);
      continue;
    }

    const target =
      (lockedTargetId && s.obstacles.find((o) => o.id === lockedTargetId && !o.smashed && o.zEnd > -0.2)) ||
      s.obstacles
        .filter(
          (o) =>
            !o.smashed &&
            o.zStart > 4 &&
            (o.type === 'low' || o.type === 'high' || (o.type === 'vehicle' && !o.hasRamp)),
        )
        .sort((a, b) => a.zStart - b.zStart)[0];

    if (target) {
      lockedTargetId = target.id;
      if (s.player.lane !== target.lane) {
        await page.keyboard.press(target.lane < s.player.lane ? 'ArrowLeft' : 'ArrowRight');
        await sleep(140);
      }
    }
    await sleep(30);
  }

  const finalState = await getState(page);
  if (finalState.state === 'gameover') return finalState;
  throw new Error(`Failed to trigger head-on gameover within ${maxMs}ms (state=${finalState.state})`);
}

/**
 * Steers onto the nearest ramped vehicle and waits until onRoof === true (and grounded by default).
 */
export async function rideNearestRampToRoof(page, opts = {}) {
  const maxMs = typeof opts === 'number' ? opts : (opts.maxMs ?? 18000);
  const requireGrounded = typeof opts === 'object' && opts.requireGrounded !== undefined ? Boolean(opts.requireGrounded) : true;
  let targetId = null;
  // Wait for first ramped vehicle to be visible ahead and align lane early
  const initial = await waitForState(
    page,
    (s) => s.obstacles.some((o) => !o.smashed && o.type === 'vehicle' && o.hasRamp && o.zStart > (o.rampLen || 6.2) + 8),
    { timeoutMs: 4000, pollMs: 20, label: 'upcoming ramped vehicle' },
  );
  const firstRamp = initial.obstacles
    .filter((o) => !o.smashed && o.type === 'vehicle' && o.hasRamp && o.zStart > (o.rampLen || 6.2) + 8)
    .sort((a, b) => a.zStart - b.zStart)[0];
  if (firstRamp) {
    targetId = firstRamp.id;
    let cur = initial;
    let guard = 0;
    while (cur.player.lane !== firstRamp.lane && guard++ < 4) {
      await page.keyboard.press(firstRamp.lane < cur.player.lane ? 'ArrowLeft' : 'ArrowRight');
      await sleep(140);
      cur = await getState(page);
    }
  }

  await driveRun(page, {
    maxMs,
    pollMs: 20,
    preferRoof: true,
    until: (s) => {
      if (s.state !== 'playing') return true;
      if (s.player.onRoof) return true;
      const rampVeh = s.obstacles.find(
        (o) => !o.smashed && o.type === 'vehicle' && o.hasRamp && o.lane === s.player.lane && o.zStart > 0 && o.zStart <= (o.rampLen || 6.2) + 2,
      );
      if (rampVeh) targetId = rampVeh.id;
      return false;
    },
  });

  const s = await waitForState(
    page,
    (st) =>
      requireGrounded
        ? (st.player.onRoof && st.player.grounded) || st.state !== 'playing'
        : st.player.onRoof || st.state !== 'playing',
    {
      timeoutMs: 3000,
      pollMs: 15,
      label: requireGrounded ? 'player.onRoof && player.grounded' : 'player.onRoof === true',
    },
  );
  if (s.state !== 'playing' || !s.player.onRoof || (requireGrounded && !s.player.grounded)) {
    throw new Error(
      `Expected player onRoof === true${requireGrounded ? ' && grounded === true' : ''}, got state=${s.state}, onRoof=${s.player.onRoof}, grounded=${s.player.grounded}, y=${s.player.y}`,
    );
  }
  return { state: s, vehicleId: targetId };
}
