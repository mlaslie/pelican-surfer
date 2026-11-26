import {
  openGame,
  startGame,
  getState,
  waitForState,
  sampleFrames,
  simulateFrameSpike,
  clickCampusPill,
  driveRun,
  runWithRestartBudget,
  acquireSparkle,
  triggerSideBump,
  triggerHeadOnCrash,
  rideNearestRampToRoof,
  sleep,
} from '../lib/harness.mjs';
import {
  assert,
  assertEqual,
  assertInRange,
  assertViewportFit,
} from '../lib/assertions.mjs';

export const tier2Tests = [
  // =========================================================================
  // F1 Boundaries (T2-F01-01 .. T2-F01-05)
  // =========================================================================
  {
    id: 'T2-F01-01',
    tier: 2,
    feature: 'F1',
    bucket: 'A',
    name: 'KeyP and Escape are ignored while on start overlay',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await g.page.keyboard.press('KeyP');
        await sleep(80);
        await g.page.keyboard.press('Escape');
        await sleep(80);
        const s = await g.getState();
        assertEqual(s.state, 'start', 'state stays start');
        assertEqual((await g.page.textContent('#overlay-title')).trim(), 'Pelican Surfer', 'title stays Pelican Surfer');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F01-02',
    tier: 2,
    feature: 'F1',
    bucket: 'A',
    timeoutMs: 28000,
    name: 'KeyP and Escape are ignored while on gameover overlay',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await triggerHeadOnCrash(g.page);
        await g.page.keyboard.press('KeyP');
        await sleep(80);
        await g.page.keyboard.press('Escape');
        await sleep(80);
        const s = await g.getState();
        assertEqual(s.state, 'gameover', 'state stays gameover');
        assertEqual((await g.page.textContent('#overlay-title')).trim(), 'Wipeout!', 'title stays Wipeout!');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F01-03',
    tier: 2,
    feature: 'F1',
    bucket: 'A',
    name: 'Rapid 6x KeyP toggle settles cleanly in playing state',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('KeyP');
        const paused = await waitForState(g.page, (st) => st.state === 'paused', { timeoutMs: 800, label: '1st KeyP pauses' });
        assertEqual(paused.state, 'paused', '1st KeyP must pause');
        await g.page.keyboard.press('KeyP');
        await waitForState(g.page, (st) => st.state === 'playing', { timeoutMs: 800, label: '2nd KeyP resumes' });
        for (let i = 0; i < 6; i++) {
          await g.page.keyboard.press('KeyP');
          await sleep(25);
        }
        const s = await waitForState(g.page, (st) => st.state === 'playing', { label: 'settled playing after 6x KeyP' });
        assertEqual(s.state, 'playing', 'even pause toggles end playing');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F01-04',
    tier: 2,
    feature: 'F1',
    bucket: 'A',
    timeoutMs: 28000,
    name: 'Lower score wipeout preserves higher localStorage bestScore (5,000)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { seedBestScore: 5000 });
      try {
        const boot = await g.getState();
        assertEqual(boot.bestScore, 5000, 'seeded bestScore');
        assertEqual((await g.page.textContent('#hud-best')).trim(), '5,000', '#hud-best formatted');
        await startGame(g.page, 'button');
        const over = await triggerHeadOnCrash(g.page);
        assert(over.score < 5000, 'test run score < 5000');
        assertEqual(over.bestScore, 5000, 'bestScore preserved on lower score');
        assertEqual((await g.page.textContent('#final-best')).trim(), '5,000', '#final-best preserved');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F01-05',
    tier: 2,
    feature: 'F1',
    bucket: 'A',
    name: 'Space starts, Escape pauses, and Space resumes seamlessly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'space');
        await sleep(180);
        await g.page.keyboard.press('Escape');
        await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused via Escape' });
        await g.page.keyboard.press('Space');
        await waitForState(g.page, (s) => s.state === 'playing', { label: 'resumed via Space' });
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F2 Boundaries (T2-F02-01 .. T2-F02-05)
  // =========================================================================
  {
    id: 'T2-F02-01',
    tier: 2,
    feature: 'F2',
    bucket: 'B',
    name: 'Dynamic viewport resize mid-run updates viewport dimensions via ResizeObserver',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 1280, height: 800 } });
      try {
        const s0 = await startGame(g.page, 'button');
        await g.page.setViewportSize({ width: 720, height: 600 });
        const s1 = await waitForState(
          g.page,
          (s) => s.viewport.cssW !== s0.viewport.cssW && s.viewport.cssW <= 720,
          { timeoutMs: 1200, label: '720x600 resize sync' },
        );
        await g.page.setViewportSize({ width: 1024, height: 700 });
        const s2 = await waitForState(
          g.page,
          (s) => s.viewport.cssW > s1.viewport.cssW,
          { timeoutMs: 1200, label: '1024x700 resize sync' },
        );
        assertEqual(s2.viewport.canvasW, Math.round(s2.viewport.cssW * s2.viewport.dpr), 'canvasW matches cssW*dpr');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F02-02',
    tier: 2,
    feature: 'F2',
    bucket: 'B',
    name: '220ms main-thread frame spike is clamped to dt <= 0.05 without huge physics jump',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await sleep(150);
        const { before, after } = await simulateFrameSpike(g.page, 220);
        assertEqual(after.state, 'playing', 'stays playing after frame spike');
        assertInRange(after.lastDt, 0, 0.05, 'after.lastDt');
        assertInRange(after.maxDt, 0, 0.05, 'after.maxDt');
        const distJump = after.distance - before.distance;
        assert(distJump < 3.0, `Clamped spike distance jump should be bounded (< 3.0m), got ${distJump}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F02-03',
    tier: 2,
    feature: 'F2',
    bucket: 'B',
    name: 'Fixed-timestep simulation advances at ~60 ticks/sec over 1000ms wall time',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        const s1 = await startGame(g.page, 'button');
        await sleep(1000);
        const s2 = await g.getState();
        const dTicks = s2.tickCount - s1.tickCount;
        assertInRange(dTicks, 45, 75, 'tickCount growth in 1000ms (60Hz)');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F02-04',
    tier: 2,
    feature: 'F2',
    bucket: 'B',
    name: 'styles.css fixes invalid contain-intrinsic-size value on #stage-shell',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        const check = await g.page.evaluate(async () => {
          const el = document.getElementById('stage-shell');
          const computed = getComputedStyle(el).containIntrinsicSize;
          const res = await fetch('styles.css');
          const cssText = await res.text();
          return {
            computed,
            hasInvalidRule: cssText.includes('auto none auto'),
          };
        });
        assertEqual(check.hasInvalidRule, false, 'styles.css must not contain "auto none auto"');
        assert(check.computed !== 'auto none auto 600px', 'computed containIntrinsicSize valid');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F02-05',
    tier: 2,
    feature: 'F2',
    bucket: 'B',
    name: 'Start screen attract mode increments frameCount while tickCount and distance stay 0',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        const s1 = await g.getState();
        await sleep(400);
        const s2 = await g.getState();
        assertEqual(s2.state, 'start', 'still on start');
        assert(s2.frameCount - s1.frameCount >= 10, 'frameCount animates on start screen');
        assertEqual(s2.tickCount, 0, 'tickCount stays 0 on start');
        assertEqual(s2.distance, 0, 'distance stays 0 on start');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F3 Boundaries (T2-F03-01 .. T2-F03-05)
  // =========================================================================
  {
    id: 'T2-F03-01',
    tier: 2,
    feature: 'F3',
    bucket: 'B',
    name: 'Initial speed at distance < 1 matches baseSpeed within 0.25 u/s',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        const s = await startGame(g.page, 'button');
        assert(s.distance < 3, `Expected early distance < 3, got ${s.distance}`);
        assert(Math.abs(s.speed - s.baseSpeed) < 0.3, `speed ${s.speed} vs baseSpeed ${s.baseSpeed}`);
        assert(s.speed < 14, `speed < 14`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F03-02',
    tier: 2,
    feature: 'F3',
    bucket: 'B',
    name: 'Speed at distance >= 25 exceeds speed at distance <= 5 without discontinuities',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        const sEarly = await startGame(g.page, 'button');
        const sLater = await driveRun(g.page, {
          maxMs: 8000,
          until: (s) => s.distance >= 25,
        });
        assertEqual(sLater.state, 'playing', 'remained playing at distance >= 25');
        assert(sLater.distance >= 25, `Expected distance >= 25, got ${sLater.distance}`);
        assert(sLater.speed > sEarly.speed + 0.3, `Expected speed(25+) > speed(early): ${sLater.speed} vs ${sEarly.speed}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F03-03',
    tier: 2,
    feature: 'F3',
    bucket: 'B',
    timeoutMs: 45000,
    name: 'Speed remains finite and bounded [baseSpeed, 46] across consecutive restarts',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        for (let run = 0; run < 2; run++) {
          const s0 = run === 0 ? await startGame(g.page, 'button') : await (async () => {
            await g.page.click('#btn-play');
            return waitForState(g.page, (st) => st.state === 'playing', { label: 'restart' });
          })();
          assertInRange(s0.speed, s0.baseSpeed, 46, `run ${run} initial speed`);
          await triggerHeadOnCrash(g.page);
        }
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F03-04',
    tier: 2,
    feature: 'F3',
    bucket: 'B',
    name: 'Pausing for 1000ms does not alter speed upon resume',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await sleep(700);
        await g.page.keyboard.press('KeyP');
        const paused = await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused' });
        await sleep(1000);
        await g.page.keyboard.press('KeyP');
        const resumed = await waitForState(g.page, (s) => s.state === 'playing', { label: 'resumed' });
        assert(
          Math.abs(resumed.speed - paused.speed) < 0.08,
          `Speed changed across pause: ${paused.speed} -> ${resumed.speed}`,
        );
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F03-05',
    tier: 2,
    feature: 'F3',
    bucket: 'B',
    name: 'Launch speed ratio relative to legacyBaseSpeed (19) is < 0.72 (>= 28% slower)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        const s = await startGame(g.page, 'button');
        const ratio = s.speed / s.legacyBaseSpeed;
        assert(ratio < 0.72, `Expected speed/legacyBaseSpeed < 0.72, got ${ratio.toFixed(3)}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F4 Boundaries (T2-F04-01 .. T2-F04-05)
  // =========================================================================
  {
    id: 'T2-F04-01',
    tier: 2,
    feature: 'F4',
    bucket: 'A',
    name: 'Pressing ArrowLeft 3 times clamps cleanly at lane -1',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        for (let i = 0; i < 3; i++) {
          await g.page.keyboard.press('ArrowLeft');
          await sleep(40);
        }
        const s = await waitForState(g.page, (st) => Math.abs(st.player.x + 2.65) < 0.15, { label: 'clamped -1' });
        assertEqual(s.player.lane, -1, 'clamped left lane');
        assertEqual(s.player.targetX, -2.65, 'clamped targetX');
        assert(s.player.x >= -2.75, `player.x out of road: ${s.player.x}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F04-02',
    tier: 2,
    feature: 'F4',
    bucket: 'A',
    name: 'Pressing ArrowRight 3 times clamps cleanly at lane +1',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        for (let i = 0; i < 3; i++) {
          await g.page.keyboard.press('ArrowRight');
          await sleep(40);
        }
        const s = await waitForState(g.page, (st) => Math.abs(st.player.x - 2.65) < 0.15, { label: 'clamped +1' });
        assertEqual(s.player.lane, 1, 'clamped right lane');
        assertEqual(s.player.targetX, 2.65, 'clamped targetX');
        assert(s.player.x <= 2.75, `player.x out of road: ${s.player.x}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F04-03',
    tier: 2,
    feature: 'F4',
    bucket: 'A',
    name: 'Rapid double-tap ArrowRight x2 within 35ms queues -1 -> 0 -> +1 cleanly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowLeft');
        await waitForState(g.page, (s) => s.player.lane === -1 && Math.abs(s.player.x + 2.65) < 0.2, { label: 'in -1' });
        const framesPromise = sampleFrames(g.page, 28);
        await g.page.keyboard.press('ArrowRight');
        await sleep(28);
        await g.page.keyboard.press('ArrowRight');
        const frames = await framesPromise;
        assert(
          frames.some((f) => f.player.lane === 0 && f.player.x > -1.5 && f.player.x < 0.2),
          'Expected intermediate lane 0 execution before queued lane +1',
        );
        assert(
          frames.some((f) => Math.abs(f.player.x) < 0.45),
          'Expected smooth trajectory passing through lane 0 (x ≈ 0)',
        );
        let maxPerTickStep = 0;
        let maxTickDelta = 0;
        for (let i = 1; i < frames.length; i++) {
          const tickDelta = frames[i].tickCount - frames[i - 1].tickCount;
          maxTickDelta = Math.max(maxTickDelta, tickDelta);
          maxPerTickStep = Math.max(
            maxPerTickStep,
            Math.abs(frames[i].player.x - frames[i - 1].player.x) / Math.max(1, tickDelta),
          );
        }
        assert(maxTickDelta <= 3, `Expected no frame stalls (max tickDelta <= 3), got ${maxTickDelta}`);
        assert(
          maxPerTickStep < 0.65,
          `Expected smooth two-step cubic ease (max |dx|/tick < 0.65), got ${maxPerTickStep}`,
        );
        const s = await waitForState(
          g.page,
          (st) => st.player.lane === 1 && Math.abs(st.player.x - 2.65) < 0.2,
          { timeoutMs: 1000, label: 'queued double-tap to +1' },
        );
        assertEqual(s.player.lane, 1, 'queued double-tap target lane');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F04-04',
    tier: 2,
    feature: 'F4',
    bucket: 'A',
    name: 'Rapid opposite double-tap ArrowLeft then ArrowRight within 40ms returns to lane 0',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowLeft');
        const framesPromise = sampleFrames(g.page, 26);
        await sleep(35);
        await g.page.keyboard.press('ArrowRight');
        const frames = await framesPromise;
        const minX = Math.min(...frames.map((f) => f.player.x));
        assert(minX < -1.8, `Expected leftward excursion (minX < -1.8) before return, got minX=${minX}`);
        assert(
          frames.some((f) => f.player.lane === -1 && f.player.x < -1.5),
          'Expected intermediate lane -1 execution (x < -1.5) before queued ArrowRight return',
        );
        const s = await waitForState(
          g.page,
          (st) => st.player.lane === 0 && Math.abs(st.player.x) < 0.2,
          { timeoutMs: 1000, label: 'opposite double-tap return to 0' },
        );
        assertEqual(s.player.lane, 0, 'returned to lane 0');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F04-05',
    tier: 2,
    feature: 'F4',
    bucket: 'A',
    name: 'Lane keys are ignored while state is start or paused',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await g.page.keyboard.press('ArrowLeft');
        await sleep(80);
        let s = await g.getState();
        assertEqual(s.player.lane, 0, 'lane unchanged on start');
        await startGame(g.page, 'button');
        await g.page.keyboard.press('KeyP');
        await waitForState(g.page, (st) => st.state === 'paused', { label: 'paused' });
        await g.page.keyboard.press('ArrowRight');
        await sleep(100);
        s = await g.getState();
        assertEqual(s.player.lane, 0, 'lane unchanged while paused');
        assertEqual(s.player.x, 0, 'x unchanged while paused');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F5 Boundaries (T2-F05-01 .. T2-F05-05)
  // =========================================================================
  {
    id: 'T2-F05-01',
    tier: 2,
    feature: 'F5',
    bucket: 'A',
    name: 'Mid-air wing flaps allow 4 flights boosts, reject 5th, and refill on landing',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('Space');
        await waitForState(g.page, (s) => s.player.y > 1.8 && s.player.flapsRemaining === 4, {
          timeoutMs: 900,
          pollMs: 12,
          label: 'initial jump ascent',
        });
        for (let expected = 3; expected >= 0; expected--) {
          await sleep(125);
          await g.page.keyboard.press('Space');
          await waitForState(g.page, (s) => s.player.flapsRemaining === expected, {
            timeoutMs: 500,
            pollMs: 12,
            label: `wing flap ${4 - expected}`,
          });
        }
        const exhausted = await g.getState();
        assert(exhausted.player.y > 2.5, `Expected pelican flying high after 4 flaps, got y=${exhausted.player.y}`);
        await sleep(140);
        const before5th = await g.getState();
        await g.page.keyboard.press('Space');
        await sleep(60);
        const after5th = await g.getState();
        assertEqual(after5th.player.flapsRemaining, 0, 'flaps remain exhausted on 5th press');
        assert(
          after5th.player.vy <= before5th.player.vy + 0.1,
          `5th mid-air press should not boost lift: ${before5th.player.vy} -> ${after5th.player.vy}`
        );
        const landed = await waitForState(g.page, (s) => s.player.grounded && s.player.flapsRemaining === 4, {
          timeoutMs: 2500,
          pollMs: 20,
          label: 'landing refills all 4 flaps',
        });
        assertEqual(landed.player.flapsRemaining, 4, 'flaps refill to 4 on landing');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F05-02',
    tier: 2,
    feature: 'F5',
    bucket: 'A',
    timeoutMs: 25000,
    name: 'Jumping from a vehicle roof reaches high apex (y > 4.0)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await rideNearestRampToRoof(g.page);
        await waitForState(g.page, (s) => s.player.onRoof && s.player.grounded, {
          timeoutMs: 800,
          pollMs: 12,
          label: 'grounded on roof after crest',
        });
        await g.page.keyboard.press('Space');
        const high = await waitForState(g.page, (s) => s.player.y > 4.0, {
          timeoutMs: 900,
          pollMs: 12,
          label: 'roof jump apex > 4.0',
        });
        assert(high.player.y > 4.0, `Expected roof jump y > 4.0, got ${high.player.y}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F05-03',
    tier: 2,
    feature: 'F5',
    bucket: 'A',
    timeoutMs: 25000,
    name: 'Jump input past coyote window (> 165ms after roof exit) is rejected in mid-air',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await rideNearestRampToRoof(g.page);
        const exit = await waitForState(g.page, (s) => !s.player.onRoof && s.player.y > 1.8, {
          timeoutMs: 3500,
          pollMs: 12,
          label: 'roof exit',
        });
        await waitForState(g.page, (s) => s.worldTime >= exit.worldTime + 0.165, {
          timeoutMs: 800,
          pollMs: 10,
          label: '165ms simulated time past roof exit',
        });
        const pre = await g.getState();
        assert(pre.player.y > 0.35, `Expected rider mid-air (y > 0.35) 165ms after roof exit, got y=${pre.player.y}`);
        assertEqual(pre.player.coyoteTimer, 0, 'coyoteTimer expired after 165ms');
        await g.page.keyboard.press('Space');
        await sleep(40);
        const post = await g.getState();
        assert(post.player.vy <= 0, `Late mid-air jump should be rejected, got vy=${post.player.vy}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F05-04',
    tier: 2,
    feature: 'F5',
    bucket: 'A',
    name: 'Early Space press at jump apex (> 350ms before landing) expires before landing',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('Space');
        await waitForState(g.page, (s) => s.player.y > 2.5, { timeoutMs: 900, pollMs: 12, label: 'high apex' });
        await g.page.keyboard.press('Space');
        const landed = await waitForState(
          g.page,
          (s) => s.player.y <= 0.05 && s.player.grounded,
          { timeoutMs: 1200, pollMs: 12, label: 'landing' },
        );
        await sleep(120);
        const settled = await g.getState();
        assert(settled.player.y <= 0.1, `Expired buffer should not auto-bounce, got y=${settled.player.y} (landed buffer=${landed.player.jumpBufferTimer})`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F05-05',
    tier: 2,
    feature: 'F5',
    bucket: 'A',
    name: 'Holding Space across landing performs a single jump without infinite bounce loop',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.down('Space');
        await waitForState(g.page, (s) => s.player.y > 2.0, { timeoutMs: 900, pollMs: 15, label: 'apex' });
        await waitForState(g.page, (s) => s.player.grounded && s.player.y <= 0.05, {
          timeoutMs: 1200,
          pollMs: 15,
          label: 'landing',
        });
        await sleep(200);
        const after = await g.getState();
        await g.page.keyboard.up('Space');
        assert(after.player.y <= 0.1, `Single Space hold should stay grounded after landing, got y=${after.player.y}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F6 Boundaries (T2-F06-01 .. T2-F06-05)
  // =========================================================================
  {
    id: 'T2-F06-01',
    tier: 2,
    feature: 'F6',
    bucket: 'A',
    name: 'Jumping while ducking immediately cancels duckTimer and launches upward',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowDown');
        await waitForState(g.page, (s) => s.player.duckTimer > 0, { timeoutMs: 400, pollMs: 12, label: 'ducking' });
        await g.page.keyboard.press('Space');
        const jumped = await waitForState(
          g.page,
          (s) => s.player.vy > 10 && s.player.duckTimer === 0,
          { timeoutMs: 400, pollMs: 12, label: 'jump cancels duck' },
        );
        assertEqual(jumped.player.duckTimer, 0, 'duckTimer cleared on jump');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F06-02',
    tier: 2,
    feature: 'F6',
    bucket: 'A',
    timeoutMs: 35000,
    name: 'Fast-fall from roof height lands rapidly AND preserves ground duck upon touchdown',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { landed, post } = await runWithRestartBudget(
          g.page,
          {
            budgets: [15000, 15000],
            label: 'T2-F06-02 fast-fall from roof',
            shouldRetryError: (err) =>
              /grounded near roof exit edge|high above ground past roof exit|upcoming ramped vehicle|player\.onRoof/.test(
                err.message,
              ),
          },
          async () => {
            await rideNearestRampToRoof(g.page);
            await waitForState(
              g.page,
              (s) =>
                s.player.onRoof &&
                s.player.grounded &&
                s.obstacles.some(
                  (o) =>
                    o.type === 'vehicle' &&
                    o.lane === s.player.lane &&
                    o.zStart <= 0.3 &&
                    o.zEnd >= 0.3 &&
                    o.zEnd <= 2.8,
                ),
              { timeoutMs: 2500, pollMs: 12, label: 'grounded near roof exit edge' },
            );
            await g.page.keyboard.press('Space');
            await waitForState(g.page, (s) => !s.player.onRoof && s.player.y > 3.2, {
              timeoutMs: 900,
              pollMs: 12,
              label: 'high above ground past roof exit',
            });
            await g.page.keyboard.press('ArrowDown');
            const landedState = await waitForState(
              g.page,
              (s) => s.player.y <= 0.15 && !s.player.onRoof && s.player.grounded,
              { timeoutMs: 900, pollMs: 12, label: 'fast-fall touchdown' },
            );
            assert(
              landedState.player.duckTimer > 0.25,
              `ground duck preserved after fast-fall (duckTimer=${landedState.player.duckTimer})`,
            );
            await sleep(180);
            const postState = await g.getState();
            return { ok: true, result: { landed: landedState, post: postState } };
          },
        );
        assert(landed.player.duckTimer > 0.25, `ground duck preserved after fast-fall (duckTimer=${landed.player.duckTimer})`);
        assert(post.player.duckAmount > 0.35, `Expected active duckAmount > 0.35 after fast-fall landing, got ${post.player.duckAmount}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F06-03',
    tier: 2,
    feature: 'F6',
    bucket: 'A',
    name: 'Brief ArrowDown tap expires cleanly while sustained hold keeps duck active',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowDown');
        await waitForState(g.page, (s) => s.player.duckAmount > 0.35, { timeoutMs: 400, label: 'tap duck' });
        await waitForState(g.page, (s) => s.player.duckAmount < 0.2, { timeoutMs: 1400, label: 'tap duck expired' });

        await g.page.keyboard.down('ArrowDown');
        await sleep(850);
        const held = await g.getState();
        await g.page.keyboard.up('ArrowDown');
        assert(held.player.duckAmount > 0.35, `Hold duck should stay > 0.35 at 850ms, got ${held.player.duckAmount}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F06-04',
    tier: 2,
    feature: 'F6',
    bucket: 'A',
    timeoutMs: 85000,
    name: 'Entering a high gantry upright (without ducking) triggers Wipeout gameover',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { end, targetId, hitGantry } = await runWithRestartBudget(
          g.page,
          { budgets: [24000, 24000, 24000], label: 'T2-F06-04 high gantry upright wipeout' },
          async (_attempt, budgetMs) => {
            let lockedId = null;
            let passedUprightWithoutDying = false;
            const res = await driveRun(g.page, {
              maxMs: budgetMs,
              pollMs: 20,
              avoidRamps: true,
              ignoreHighGantry: true,
              desiredLaneFn: (s) => {
                if (!lockedId) return null;
                const hg = s.obstacles.find((o) => o.id === lockedId && !o.smashed && o.zEnd > -0.5);
                if (!hg) return null;
                return { lane: hg.lane, ignoreObstacleId: hg.id, allowBehindTarget: true };
              },
              onSample: async (s) => {
                if (lockedId) {
                  const cur = s.obstacles.find((o) => o.id === lockedId);
                  if (
                    cur &&
                    s.state === 'playing' &&
                    cur.lane === s.player.lane &&
                    cur.zEnd < -0.6 &&
                    s.player.duckAmount <= 0.35 &&
                    s.player.y < 0.45
                  ) {
                    passedUprightWithoutDying = true;
                  }
                  if (!cur || cur.zEnd < -1.5) lockedId = null;
                }
                if (!lockedId && s.player.grounded && s.player.y < 0.25) {
                  const hg = s.obstacles
                    .filter((o) => {
                      if (o.type !== 'high' || o.zStart <= 5 || o.zStart >= 18) return false;
                      const tti = o.zStart / Math.max(1, s.speed);
                      const minTti = Math.abs(o.lane - s.player.lane) === 2 ? 0.52 : 0.35;
                      if (tti < minTti) return false;
                      return !s.obstacles.some(
                        (b) => !b.smashed && b.lane === o.lane && b.zEnd > -0.5 && b.zStart < o.zStart,
                      );
                    })
                    .sort((a, b) => a.zStart - b.zStart)[0];
                  if (hg) lockedId = hg.id;
                }
              },
              until: (s) => s.state === 'gameover',
            });
            assert(!passedUprightWithoutDying, 'Rider passed through high gantry upright without triggering Wipeout');
            const hit = lockedId !== null ? res.obstacles.find((o) => o.id === lockedId) : null;
            if (
              res.state === 'gameover' &&
              lockedId !== null &&
              hit &&
              hit.zStart <= 0.5 &&
              hit.zEnd >= -0.6 &&
              hit.lane === res.player.lane
            ) {
              return { ok: true, result: { end: res, targetId: lockedId, hitGantry: hit } };
            }
            return { ok: false, reason: `state=${res?.state}, lockedId=${lockedId}` };
          },
        );
        assert(targetId !== null, 'Expected to lock onto an approaching high gantry');
        assertEqual(end.state, 'gameover', 'upright collision with high gantry must Wipeout');
        assert(hitGantry, `Expected target high gantry id=${targetId} at gameover`);
        assert(
          hitGantry.zStart <= 0.5 && hitGantry.zEnd >= -0.6 && hitGantry.lane === end.player.lane,
          `Expected Wipeout at target high gantry (lane=${hitGantry.lane}, z=${hitGantry.zStart.toFixed(2)}..${hitGantry.zEnd.toFixed(2)}), got player lane=${end.player.lane}`,
        );
        assert(end.player.duckAmount <= 0.35, `Expected upright (duckAmount <= 0.35), got ${end.player.duckAmount}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F06-05',
    tier: 2,
    feature: 'F6',
    bucket: 'A',
    timeoutMs: 85000,
    name: 'High jump (y > 2.65) clears over top of a high gantry without Wipeout',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { end, targetId, clearedOverTop } = await runWithRestartBudget(
          g.page,
          { budgets: [24000, 24000, 24000], label: 'T2-F06-05 jump over high gantry' },
          async (_attempt, budgetMs) => {
            let cleared = false;
            let lockedId = null;
            let jumpedForIt = false;
            const res = await driveRun(g.page, {
              maxMs: budgetMs,
              pollMs: 20,
              avoidRamps: true,
              ignoreHighGantry: true,
              desiredLaneFn: (s) => {
                if (!lockedId) return null;
                const hg = s.obstacles.find((x) => x.id === lockedId && !x.smashed && x.zEnd > -0.5);
                if (!hg) return null;
                return { lane: hg.lane, ignoreObstacleId: hg.id };
              },
              onSample: async (s) => {
                if (lockedId) {
                  const cur = s.obstacles.find((x) => x.id === lockedId);
                  const curTti = cur ? cur.zStart / Math.max(1, s.speed) : -1;
                  if (
                    !cur ||
                    (cur.zEnd < -1.5 && !cleared) ||
                    (!jumpedForIt && !cleared && s.player.lane !== cur.lane && curTti < 0.34)
                  ) {
                    lockedId = null;
                    jumpedForIt = false;
                  }
                }
                if (!lockedId && s.player.grounded && s.player.y < 0.25) {
                  const hg = s.obstacles
                    .filter((o) => {
                      if (o.type !== 'high' || o.zStart <= 8 || o.zStart >= 20) return false;
                      const tti = o.zStart / Math.max(1, s.speed);
                      const minTti = Math.abs(o.lane - s.player.lane) === 2 ? 0.72 : 0.55;
                      if (tti < minTti) return false;
                      const clearBefore = !s.obstacles.some(
                        (b) => !b.smashed && b.lane === o.lane && b.zEnd > -0.5 && b.zStart < o.zStart,
                      );
                      const clearBehindVeh = !s.obstacles.some(
                        (b) =>
                          !b.smashed &&
                          b.type === 'vehicle' &&
                          b.lane === o.lane &&
                          b.zStart >= o.zStart &&
                          b.zStart < o.zEnd + 16,
                      );
                      return clearBefore && clearBehindVeh;
                    })
                    .sort((a, b) => a.zStart - b.zStart)[0];
                  if (hg) lockedId = hg.id;
                }
                if (lockedId && s.state === 'playing') {
                  const hg = s.obstacles.find((x) => x.id === lockedId);
                  if (hg) {
                    const tti = hg.zStart / Math.max(1, s.speed);
                    if (!jumpedForIt && s.player.lane === hg.lane && tti <= 0.50 && tti >= 0.30 && s.player.grounded) {
                      await g.page.keyboard.press('Space');
                      jumpedForIt = true;
                    }
                    if (s.player.lane === hg.lane && hg.zStart <= 0.8 && hg.zEnd >= -0.8 && s.player.y > 2.55) {
                      cleared = true;
                    }
                  }
                }
              },
              until: (s) => {
                if (!lockedId) return false;
                const hg = s.obstacles.find((o) => o.id === lockedId);
                return cleared && (!hg || hg.zEnd < -1.5) && s.state === 'playing';
              },
            });
            const rem = lockedId ? res.obstacles.find((o) => o.id === lockedId) : null;
            if (cleared && res.state === 'playing' && (!rem || rem.zEnd < -1.5)) {
              return { ok: true, result: { end: res, targetId: lockedId, clearedOverTop: cleared } };
            }
            return { ok: false, reason: `state=${res?.state}, cleared=${cleared}` };
          },
        );
        assert(clearedOverTop, 'Expected to jump high (> 2.55) over top of high gantry');
        assertEqual(end.state, 'playing', 'survived jumping over high gantry');
        const rem = end.obstacles.find((o) => o.id === targetId);
        assert(!rem || rem.zEnd < -1.5, 'high gantry cleared past zEnd < -1.5');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F7 Boundaries (T2-F07-01 .. T2-F07-05)
  // =========================================================================
  {
    id: 'T2-F07-01',
    tier: 2,
    feature: 'F7',
    bucket: 'A',
    name: 'Lateral switch into elevated mid-ramp at y=0 does NOT teleport rider vertically',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const rampMid = await waitForState(
          g.page,
          (s) =>
            s.obstacles.some(
              (o) =>
                o.type === 'vehicle' &&
                o.hasRamp &&
                o.lane === 1 &&
                o.zStart <= 3.6 &&
                o.zStart >= 0.6,
            ),
          { timeoutMs: 8000, pollMs: 15, label: 'Wave 1 mid-ramp window' },
        );
        assertEqual(rampMid.player.y, 0, 'grounded before lateral move');
        await g.page.keyboard.press('ArrowRight');
        await sleep(180);
        const after = await g.getState();
        assert(
          after.player.y < 0.5 && !after.player.onRoof,
          `Rider teleported onto elevated ramp/roof: y=${after.player.y}, onRoof=${after.player.onRoof}`,
        );
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F07-02',
    tier: 2,
    feature: 'F7',
    bucket: 'A',
    timeoutMs: 120000,
    name: 'Lateral hop between side-by-side vehicle roofs stays supported (onRoof === true)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { end, hopped } = await runWithRestartBudget(
          g.page,
          { budgets: [32000, 32000, 32000], label: 'T2-F07-02 adjacent roof hop' },
          async (_attempt, budgetMs) => {
            let didHop = false;
            const res = await driveRun(g.page, {
              maxMs: budgetMs,
              pollMs: 20,
              preferAdjacentRoof: true,
              desiredLaneFn: (s) => (s.player.onRoof ? s.player.lane : null),
              onSample: async (s) => {
                if (s.player.onRoof && s.player.grounded && s.player.y >= 2.2 && !didHop) {
                  const curVeh = s.obstacles.find(
                    (o) =>
                      !o.smashed &&
                      o.type === 'vehicle' &&
                      Math.abs(o.lane * 2.65 - s.player.x) <= 0.6 &&
                      o.zStart <= 0.25 &&
                      o.zEnd >= 0.25,
                  );
                  const adj = curVeh
                    ? s.obstacles.find(
                        (o) =>
                          !o.smashed &&
                          o.type === 'vehicle' &&
                          o.id !== curVeh.id &&
                          Math.abs(o.lane - s.player.lane) === 1 &&
                          o.zStart <= 0.2 &&
                          o.zEnd >= Math.max(3.0, s.speed * 0.25),
                      )
                    : null;
                  if (adj) {
                    await g.page.keyboard.press(adj.lane < s.player.lane ? 'ArrowLeft' : 'ArrowRight');
                    const landed = await waitForState(
                      g.page,
                      (st) =>
                        st.player.lane === adj.lane &&
                        Number.isFinite(st.player.x) &&
                        Math.abs(st.player.x - adj.lane * 2.65) < 0.35,
                      { timeoutMs: 700, pollMs: 15, label: 'adjacent roof hop' },
                    );
                    assertEqual(landed.state, 'playing', 'still playing after adjacent roof hop');
                    assertEqual(landed.player.onRoof, true, 'remains onRoof after lateral roof hop');
                    assert(
                      landed.player.y >= 2.15,
                      `Expected roof height >= 2.15 on adjacent vehicle, got ${landed.player.y}`,
                    );
                    const onAdj = landed.obstacles.find(
                      (o) => o.id === adj.id && o.zStart <= 0.3 && o.zEnd >= 0.1,
                    );
                    assert(onAdj, `Expected rider supported on distinct adjacent vehicle id=${adj.id}`);
                    didHop = true;
                  }
                }
              },
              until: () => didHop,
            });
            if (didHop && res.state === 'playing') {
              return { ok: true, result: { end: res, hopped: didHop } };
            }
            return { ok: false, reason: `state=${res?.state}, hopped=${didHop}` };
          },
        );
        assert(hopped, 'Expected to encounter Pattern 1 side-by-side roofs and hop cleanly');
        assertEqual(end.state, 'playing', 'remained playing after lateral roof hop');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F07-03',
    tier: 2,
    feature: 'F7',
    bucket: 'A',
    name: 'Jumping onto Wave 1 ramp entry catches ramp slope and rides onto roof',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowRight');
        await waitForState(
          g.page,
          (s) =>
            s.obstacles.some(
              (o) => o.type === 'vehicle' && o.hasRamp && o.lane === 1 && o.zStart > 3 && o.zStart <= (o.rampLen || 6.2) + 2,
            ),
          { timeoutMs: 8000, pollMs: 15, label: 'ramp entry' },
        );
        await g.page.keyboard.press('Space');
        const onRoof = await waitForState(g.page, (s) => s.player.onRoof, {
          timeoutMs: 2500,
          pollMs: 15,
          label: 'caught ramp to roof',
        });
        assertEqual(onRoof.state, 'playing', 'playing on roof');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F07-04',
    tier: 2,
    feature: 'F7',
    bucket: 'A',
    name: 'Climbing ramp mid-incline maintains non-negative vertical velocity (vy >= 0)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowRight');
        const mid = await waitForState(
          g.page,
          (s) => s.player.y > 0.6 && s.player.y < 1.9 && !s.player.onRoof,
          { timeoutMs: 8000, pollMs: 12, label: 'mid-ramp incline' },
        );
        assert(mid.player.vy >= 0, `Expected vy >= 0 on ramp incline, got ${mid.player.vy}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F07-05',
    tier: 2,
    feature: 'F7',
    bucket: 'A',
    timeoutMs: 25000,
    name: 'onRoof resets to false promptly after passing vehicle zEnd',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await rideNearestRampToRoof(g.page);
        const off = await waitForState(
          g.page,
          (s) => !s.player.onRoof,
          { timeoutMs: 3500, pollMs: 15, label: 'onRoof -> false' },
        );
        assertEqual(off.player.onRoof, false, 'onRoof cleared after roof exit');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F8 Boundaries (T2-F08-01 .. T2-F08-05)
  // =========================================================================
  {
    id: 'T2-F08-01',
    tier: 2,
    feature: 'F8',
    bucket: 'A',
    timeoutMs: 45000,
    name: 'stumbleTimer remains 0 for first 2.0s and first side-bump always survives',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { sPre, after } = await runWithRestartBudget(
          g.page,
          {
            budgets: [20000, 20000],
            label: 'T2-F08-01 first side-bump',
            shouldRetryError: (err) => /Could not find an adjacent vehicle/.test(err.message),
          },
          async () => {
            await sleep(1600);
            const preState = await g.getState();
            assertEqual(preState.player.stumbleTimer, 0, 'stumbleTimer === 0 before first bump');
            const bumpRes = await triggerSideBump(g.page, { maxMs: 18000 });
            return { ok: true, result: { sPre: preState, after: bumpRes.after } };
          },
        );
        assertEqual(sPre.player.stumbleTimer, 0, 'stumbleTimer === 0 before first bump');
        assertEqual(after.state, 'playing', 'first bump survives');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F08-02',
    tier: 2,
    feature: 'F8',
    bucket: 'A',
    timeoutMs: 75000,
    name: 'Second side-bump AFTER stumbleTimer expires survives again cleanly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { recovered, after } = await runWithRestartBudget(
          g.page,
          {
            budgets: [24000, 24000, 24000],
            label: 'T2-F08-02 second side-bump after recovery',
            shouldRetryError: (err) => /Could not find an adjacent vehicle/.test(err.message),
          },
          async () => {
            await triggerSideBump(g.page, { maxMs: 18000 });
            const rec = await driveRun(g.page, {
              maxMs: 6000,
              until: (s) => s.player.stumbleTimer === 0 && s.state === 'playing',
            });
            if (rec.state !== 'playing' || rec.player.stumbleTimer !== 0) {
              return { ok: false, reason: `recovery failed: state=${rec?.state}, stumble=${rec?.player?.stumbleTimer}` };
            }
            const bump2 = await triggerSideBump(g.page, { maxMs: 16000 });
            return { ok: true, result: { recovered: rec, after: bump2.after } };
          },
        );
        assertEqual(recovered.state, 'playing', 'survived stumble recovery before 2nd bump');
        assertEqual(recovered.player.stumbleTimer, 0, 'stumbleTimer recovered to 0 before 2nd bump');
        assertEqual(after.state, 'playing', 'survives fresh side-bump once stumbleTimer recovered');
        assert(after.player.stumbleTimer > 0.4, 'stumbleTimer re-triggered');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F08-03',
    tier: 2,
    feature: 'F8',
    bucket: 'A',
    timeoutMs: 50000,
    name: 'Leftward side-bump into lane -1 vehicle bounces back symmetrically to lane 0',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { before, after } = await runWithRestartBudget(
          g.page,
          {
            budgets: [18000, 18000],
            label: 'T2-F08-03 leftward side-bump',
            shouldRetryError: (err) => /Could not find an adjacent vehicle/.test(err.message),
          },
          async (_attempt, budgetMs) => {
            const res = await triggerSideBump(g.page, { targetLane: -1, maxMs: budgetMs });
            return { ok: true, result: res };
          },
        );
        assertEqual(after.state, 'playing', 'survives left side-bump');
        assertEqual(after.player.lane, before.player.lane, 'bounced back to original lane');
        assert(after.player.stumbleTimer > 0.4, 'stumbleTimer active');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F08-04',
    tier: 2,
    feature: 'F8',
    bucket: 'A',
    timeoutMs: 35000,
    name: 'Landing right behind low hurdle (zEnd < -0.55) does not trigger trailing phantom collision',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { end, tested } = await runWithRestartBudget(
          g.page,
          { budgets: [14000, 14000], label: 'T2-F08-04 low hurdle trailing landing' },
          async (_attempt, budgetMs) => {
            let didTest = false;
            let hurdleId = null;
            let fastFell = false;
            const res = await driveRun(g.page, {
              maxMs: budgetMs,
              pollMs: 15,
              onSample: async (s) => {
                if (hurdleId) {
                  const cur = s.obstacles.find((o) => o.id === hurdleId);
                  if (!cur || (cur.zEnd < -2 && !fastFell)) hurdleId = null;
                }
                if (!hurdleId) {
                  const h = s.obstacles.find((o) => o.type === 'low' && o.lane === s.player.lane && o.zStart > 4);
                  if (h) hurdleId = h.id;
                }
                if (hurdleId && !fastFell) {
                  const h = s.obstacles.find((o) => o.id === hurdleId);
                  if (h && h.lane === s.player.lane && h.zEnd < -0.55 && s.player.y > 0.8) {
                    await g.page.keyboard.press('ArrowDown');
                    fastFell = true;
                  }
                }
                if (hurdleId && fastFell && s.player.y <= 0.1 && s.state === 'playing') {
                  didTest = true;
                }
              },
              until: () => didTest,
            });
            if (didTest && res.state === 'playing') {
              return { ok: true, result: { end: res, tested: didTest } };
            }
            return { ok: false, reason: `state=${res?.state}, tested=${didTest}` };
          },
        );
        assert(tested, 'Expected safe landing immediately behind low hurdle');
        assertEqual(end.state, 'playing', 'survived landing behind low hurdle');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F08-05',
    tier: 2,
    feature: 'F8',
    bucket: 'A',
    timeoutMs: 85000,
    name: 'Standing up right behind high gantry (zEnd < -0.55) has no trailing phantom collision',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { end, released } = await runWithRestartBudget(
          g.page,
          { budgets: [24000, 24000, 24000], label: 'T2-F08-05 stand up behind high gantry' },
          async (_attempt, budgetMs) => {
            let gantryId = null;
            let duckHeld = false;
            let didRelease = false;
            let lastSteerAt = 0;
            try {
              const res = await driveRun(g.page, {
                maxMs: budgetMs,
                pollMs: 20,
                avoidRamps: true,
                ignoreHighGantry: true,
                onSample: async (s) => {
                  if (gantryId) {
                    const cur = s.obstacles.find((x) => x.id === gantryId);
                    if (!cur || (cur.zEnd < -1.5 && !didRelease)) {
                      gantryId = null;
                      if (duckHeld) {
                        await g.page.keyboard.up('ArrowDown').catch(() => {});
                        duckHeld = false;
                      }
                    }
                  }
                  if (!gantryId) {
                    const hg = s.obstacles.find(
                      (o) =>
                        o.type === 'high' &&
                        o.zStart > 4 &&
                        o.zStart < 15 &&
                        !s.obstacles.some((b) => !b.smashed && b.lane === o.lane && b.zEnd > -0.5 && b.zStart < o.zStart),
                    );
                    if (hg) gantryId = hg.id;
                  }
                  if (gantryId && s.state === 'playing') {
                    const hg = s.obstacles.find((x) => x.id === gantryId);
                    if (hg) {
                      if (s.player.lane !== hg.lane && hg.zStart > 4 && Date.now() - lastSteerAt > 150) {
                        await g.page.keyboard.press(hg.lane < s.player.lane ? 'ArrowLeft' : 'ArrowRight');
                        lastSteerAt = Date.now();
                      }
                      if (!duckHeld && s.player.lane === hg.lane && hg.zStart <= 7 && hg.zEnd > 0) {
                        await g.page.keyboard.down('ArrowDown');
                        duckHeld = true;
                      }
                      if (duckHeld && !didRelease && hg.zEnd < -0.55) {
                        await g.page.keyboard.up('ArrowDown');
                        duckHeld = false;
                        didRelease = true;
                      }
                    }
                  }
                },
                until: (s) => didRelease && s.player.duckAmount < 0.25 && s.state === 'playing',
              });
              if (didRelease && res.state === 'playing' && res.player.duckAmount < 0.25) {
                return { ok: true, result: { end: res, released: didRelease } };
              }
              return { ok: false, reason: `state=${res?.state}, released=${didRelease}` };
            } finally {
              await g.page.keyboard.up('ArrowDown').catch(() => {});
            }
          },
        );
        assert(released, 'Expected safe stand-up right behind high gantry');
        assertEqual(end.state, 'playing', 'survived standing up behind high gantry');
        assert(end.player.duckAmount < 0.25, `Expected full stand-up (duckAmount < 0.25), got ${end.player.duckAmount}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F9 Boundaries (T2-F09-01 .. T2-F09-05)
  // =========================================================================
  {
    id: 'T2-F09-01',
    tier: 2,
    feature: 'F9',
    bucket: 'A',
    name: 'Passing beside Wave 1 coins in lane -1 without overdrive collects 0 coins',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowLeft');
        const s = await waitForState(g.page, (st) => st.worldTime >= 3.5, {
          timeoutMs: 6000,
          label: 'passed Wave 1 in lane -1',
        });
        assertEqual(s.coins, 0, 'adjacent lane coins not collected without magnet');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F09-02',
    tier: 2,
    feature: 'F9',
    bucket: 'A',
    name: 'Wave 1 center coins are never double-counted (coins <= 5)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const s = await waitForState(
          g.page,
          (st) => st.coins >= 5 || st.worldTime >= 4.2,
          { timeoutMs: 6000, label: 'Wave 1 coin line complete' },
        );
        assertInRange(s.coins, 4, 5, 'Wave 1 coin count (no double count)');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F09-03',
    tier: 2,
    feature: 'F9',
    bucket: 'A',
    timeoutMs: 195000,
    name: 'Gemini Sparkle HUD bar shrinks over 7.5s and hides cleanly at expiration',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const gotSparkle = await acquireSparkle(g.page, {
          minTimer: 6.5,
          label: 'T2-F09-03 sparkle shrink',
        });
        assertEqual(gotSparkle.state, 'playing', 'still playing after sparkle pickup');
        assert(gotSparkle.player.sparkleTimer > 6.5, `Expected sparkleTimer > 6.5, got ${gotSparkle.player.sparkleTimer}`);
        const wStart = await g.page.evaluate(() => parseFloat(document.getElementById('sparkle-fill').style.width));
        const endState = await driveRun(g.page, {
          maxMs: 9000,
          pollMs: 50,
          until: (s) => s.player.sparkleTimer === 0,
        });
        const endDom = await g.page.evaluate(() => ({
          hidden: document.getElementById('sparkle-wrap').hidden,
        }));
        assert(wStart > 80, `Expected initial #sparkle-fill > 80%, got ${wStart}%`);
        assertEqual(endState.state, 'playing', 'still playing at sparkle expiration');
        assertEqual(endState.player.sparkleTimer, 0, 'sparkleTimer expired to 0');
        assertEqual(endDom.hidden, true, '#sparkle-wrap hides when sparkleTimer === 0');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F09-04',
    tier: 2,
    feature: 'F9',
    bucket: 'A',
    timeoutMs: 180000,
    name: 'sparkleTimer pauses cleanly when game is paused',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const acquired = await acquireSparkle(g.page, {
          minTimer: 4.0,
          label: 'T2-F09-04 pause sparkle',
        });
        assertEqual(acquired.state, 'playing', 'still playing after sparkle pickup');
        assert(acquired.player.sparkleTimer > 4.0, `Expected sparkleTimer > 4.0 before pause, got ${acquired.player.sparkleTimer}`);
        await g.page.keyboard.press('KeyP');
        const p1 = await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused during sparkle' });
        await sleep(600);
        const p2 = await g.getState();
        assert(
          Math.abs(p2.player.sparkleTimer - p1.player.sparkleTimer) < 0.05,
          `sparkleTimer changed during pause: ${p1.player.sparkleTimer} -> ${p2.player.sparkleTimer}`,
        );
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F09-05',
    tier: 2,
    feature: 'F9',
    bucket: 'A',
    timeoutMs: 360000,
    name: 'Collecting a second Gemini Sparkle restores full overdrive timer (<= 7.5s)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const deadline = Date.now() + 325000;
        let attempts = 0;
        let secondCollected = false;
        let endState = null;

        let cur = await acquireSparkle(g.page, {
          minTimer: 6.5,
          budgets: [55000, 50000, 45000],
          label: 'T2-F09-05 first sparkle',
        });
        assertEqual(cur.state, 'playing', 'still playing after 1st sparkle pickup');
        assert(cur.player.sparkleTimer > 6.5, `Expected 1st sparkleTimer > 6.5, got ${cur.player.sparkleTimer}`);

        while (Date.now() < deadline - 9000) {
          if (cur.state !== 'playing' || cur.player.sparkleTimer <= 6.5) {
            if (cur.state === 'gameover') {
              await g.page.click('#btn-play');
              cur = await waitForState(
                g.page,
                (s) => s.state === 'playing' && s.tickCount > 0,
                { timeoutMs: 3000, label: `T2-F09-05 restart after attempt ${attempts}` },
              );
            }
            const remForRun = deadline - Date.now() - 9000;
            if (remForRun < 8000) break;
            cur = await driveRun(g.page, {
              maxMs: Math.min(55000, remForRun),
              pollMs: 20,
              preferSparkle: true,
              until: (s) => s.player.sparkleTimer > 6.5,
            });
            if (cur.state !== 'playing' || cur.player.sparkleTimer <= 6.5) {
              continue;
            }
          }

          attempts++;
          // Wait briefly until sparkleTimer <= 6.5s so a refresh to 7.5s jumps by >= +1.0s (> +0.8s)
          let midPrev = cur.player.sparkleTimer;
          let midHitSecond = false;
          const mid = await driveRun(g.page, {
            maxMs: 2500,
            pollMs: 16,
            preferSparkle: true,
            onSample(s) {
              if (midPrev > 0 && s.player.sparkleTimer > midPrev + 0.8 && s.player.sparkleTimer <= 7.5) {
                midHitSecond = true;
              }
              midPrev = s.player.sparkleTimer;
            },
            until: (s) => midHitSecond || s.player.sparkleTimer <= 6.5 || s.state !== 'playing',
          });
          if (midHitSecond) {
            secondCollected = true;
            endState = mid;
            break;
          }
          if (mid.state !== 'playing' || mid.player.sparkleTimer <= 0 || mid.player.sparkleTimer > 6.5) {
            cur = mid;
            continue;
          }

          // Seek a 2nd sparkle strictly while overdrive is active (prevTimer > 0).
          // While sparkleTimer > 0, overdrive smashes obstacles, so steer straight for the nearest
          // uncollected sparkle and jump into high roof sparkles; abort immediately if sparkleTimer <= 0.
          let prevTimer = mid.player.sparkleTimer;
          let hitSecond = false;
          let lastLaneAt = 0;
          let lastJumpAt = 0;
          const overlapDeadline = Date.now() + 8000;
          let overlapState = mid;

          while (Date.now() < overlapDeadline) {
            const s = await g.getState();
            overlapState = s;
            if (prevTimer > 0 && s.player.sparkleTimer > prevTimer + 0.8 && s.player.sparkleTimer <= 7.5) {
              hitSecond = true;
              break;
            }
            prevTimer = s.player.sparkleTimer;
            if (s.player.sparkleTimer <= 0 || s.state !== 'playing') {
              break;
            }

            const targetSp = s.collectibles
              .filter((c) => c.type === 'sparkle' && !c.collected && c.z > -0.5 && c.z < 90)
              .sort((a, b) => a.z - b.z)[0] || null;
            const now = Date.now();
            if (targetSp) {
              if (targetSp.lane !== s.player.lane && now - lastLaneAt > 140) {
                await g.page.keyboard.press(targetSp.lane < s.player.lane ? 'ArrowLeft' : 'ArrowRight');
                lastLaneAt = now;
              }
              const spTti = targetSp.z / Math.max(1, s.speed);
              if (
                targetSp.y > 1.5 &&
                s.player.y < 0.3 &&
                s.player.sparkleTimer > 0.2 &&
                spTti <= 0.46 &&
                spTti >= 0.02 &&
                now - lastJumpAt > 260
              ) {
                await g.page.keyboard.press('ArrowUp');
                lastJumpAt = now;
              }
            }
            await sleep(16);
          }

          if (hitSecond) {
            secondCollected = true;
            endState = overlapState;
            break;
          }
          cur = overlapState;
        }

        assert(
          secondCollected,
          `Expected second Gemini Sparkle pickup while overdrive active (prevTimer > 0) across ${attempts} attempts (last state=${cur?.state}, sparkleTimer=${cur?.player?.sparkleTimer?.toFixed?.(2)}, distance=${cur?.distance?.toFixed?.(1)})`,
        );
        assertEqual(endState.state, 'playing', 'still playing after 2nd sparkle pickup');
        assert(
          endState.player.sparkleTimer > 0.8 && endState.player.sparkleTimer <= 7.5,
          `Expected sparkleTimer in (0.8, 7.5] after 2nd sparkle pickup, got ${endState.player.sparkleTimer}`,
        );
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F10 Boundaries (T2-F10-01 .. T2-F10-05)
  // =========================================================================
  {
    id: 'T2-F10-01',
    tier: 2,
    feature: 'F10',
    bucket: 'A',
    name: 'Manual campus selected on start screen stays locked after starting run',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await clickCampusPill(g.page, 'zurich');
        await startGame(g.page, 'button');
        const s = await g.getState();
        assertEqual(s.campusId, 'zurich', 'campusId preserved on start');
        assertEqual(s.lockedCampus, true, 'lockedCampus preserved on start');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F10-02',
    tier: 2,
    feature: 'F10',
    bucket: 'A',
    timeoutMs: 28000,
    name: 'Manual campus lock persists across Wipeout and restart',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await clickCampusPill(g.page, 'nyc');
        await startGame(g.page, 'button');
        await triggerHeadOnCrash(g.page);
        await g.page.click('#btn-play');
        const s = await waitForState(g.page, (st) => st.state === 'playing', { label: 'restarted' });
        assertEqual(s.campusId, 'nyc', 'nyc persists across restart');
        assertEqual(s.lockedCampus, true, 'lockedCampus persists across restart');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F10-03',
    tier: 2,
    feature: 'F10',
    bucket: 'A',
    name: 'Clicking the already-active campus pill twice remains valid without transition glitches',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await clickCampusPill(g.page, 'mv');
        await clickCampusPill(g.page, 'mv');
        const s = await g.getState();
        assertEqual(s.campusIdx, 0, 'campusIdx 0');
        assertEqual(s.lockedCampus, true, 'lockedCampus true');
        assertInRange(s.campusTransition, 0, 1, 'campusTransition');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F10-04',
    tier: 2,
    feature: 'F10',
    bucket: 'A',
    name: 'Rapidly cycling all 6 campus pills within 500ms settles cleanly on Sydney',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        for (const id of ['mv', 'london', 'zurich', 'tokyo', 'nyc', 'sydney']) {
          await clickCampusPill(g.page, id);
          await sleep(40);
        }
        const s = await waitForState(g.page, (st) => st.campusId === 'sydney', { label: 'settled sydney' });
        assertEqual(s.campusIdx, 5, 'sydney idx');
        assertInRange(s.campusTransition, 0, 1, 'campusTransition bounded');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F10-05',
    tier: 2,
    feature: 'F10',
    bucket: 'A',
    timeoutMs: 28000,
    name: 'Switching to Auto Tour and restarting resets campus back to Mountain View (0)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await clickCampusPill(g.page, 'sydney');
        await clickCampusPill(g.page, 'auto');
        await startGame(g.page, 'button');
        await triggerHeadOnCrash(g.page);
        await g.page.click('#btn-play');
        const s = await waitForState(g.page, (st) => st.state === 'playing', { label: 'auto tour restart' });
        assertEqual(s.lockedCampus, false, 'lockedCampus false');
        assertEqual(s.campusIdx, 0, 'restarts at Mountain View (0)');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F11 Boundaries (T2-F11-01 .. T2-F11-05)
  // =========================================================================
  {
    id: 'T2-F11-01',
    tier: 2,
    feature: 'F11',
    bucket: 'A',
    name: 'Mute state set before starting persists into gameplay',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await g.page.keyboard.press('KeyM');
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔇 Muted', 'muted on start');
        await startGame(g.page, 'button');
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔇 Muted', 'stays muted in play');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F11-02',
    tier: 2,
    feature: 'F11',
    bucket: 'A',
    timeoutMs: 28000,
    name: 'Mute key (M) works cleanly in both paused and gameover states',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('KeyP');
        await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused' });
        await g.page.keyboard.press('KeyM');
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔇 Muted', 'muted while paused');
        await g.page.keyboard.press('KeyP');
        await triggerHeadOnCrash(g.page);
        await g.page.keyboard.press('KeyM');
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔊 Sound', 'unmuted on gameover');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F11-03',
    tier: 2,
    feature: 'F11',
    bucket: 'A',
    name: 'Rapidly ringing GBike bell (5x KeyB) produces zero audio errors',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        for (let i = 0; i < 5; i++) {
          await g.page.keyboard.press('KeyB');
          await sleep(40);
        }
        const s = await g.getState();
        assertEqual(s.state, 'playing', 'still playing');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F11-04',
    tier: 2,
    feature: 'F11',
    bucket: 'A',
    name: 'Pressing Space after clicking #btn-mute jumps cleanly without re-toggling mute',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.click('#btn-mute');
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔇 Muted', 'muted via click');
        await g.page.keyboard.press('Space');
        const jumped = await waitForState(g.page, (s) => s.player.y > 0.5, {
          timeoutMs: 600,
          pollMs: 12,
          label: 'Space jump after button click',
        });
        assert(jumped.player.y > 0.5, `Space triggered jump (y=${jumped.player.y})`);
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔇 Muted', 'Space did not hijack #btn-mute');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F11-05',
    tier: 2,
    feature: 'F11',
    bucket: 'A',
    name: 'AudioContext is instantiated as a singleton (<= 1 instance across multiple SFX)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, {
        initScript: () => {
          window.__PW_AC_COUNT = 0;
          const Orig = window.AudioContext || window.webkitAudioContext;
          if (Orig) {
            const Wrapped = function (...args) {
              window.__PW_AC_COUNT++;
              return new Orig(...args);
            };
            Wrapped.prototype = Orig.prototype;
            if (window.AudioContext) window.AudioContext = Wrapped;
            if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
          }
        },
      });
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowLeft');
        await g.page.keyboard.press('Space');
        await g.page.keyboard.press('KeyB');
        await sleep(250);
        const count = await g.page.evaluate(() => window.__PW_AC_COUNT);
        assertEqual(count, 1, 'singleton AudioContext count');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F12 Boundaries (T2-F12-01 .. T2-F12-05)
  // =========================================================================
  {
    id: 'T2-F12-01',
    tier: 2,
    feature: 'F12',
    bucket: 'A',
    name: '720x600 Start and Pause overlays stay strictly inside .stage-wrap and viewport',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 720, height: 600 } });
      try {
        await assertViewportFit(g.page, { width: 720, height: 600 });
        await startGame(g.page, 'button');
        await g.page.keyboard.press('KeyP');
        await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused' });
        await assertViewportFit(g.page, { width: 720, height: 600 });
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F12-02',
    tier: 2,
    feature: 'F12',
    bucket: 'A',
    timeoutMs: 28000,
    name: '720x600 Game Over 4-stat overlay card does not clip CTA button',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 720, height: 600 } });
      try {
        await startGame(g.page, 'button');
        await triggerHeadOnCrash(g.page);
        await assertViewportFit(g.page, { width: 720, height: 600 });
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F12-03',
    tier: 2,
    feature: 'F12',
    bucket: 'A',
    name: '1280x800 keeps .campus-bar bottom <= 800 (fully visible above the fold)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 1280, height: 800 } });
      try {
        const metrics = await assertViewportFit(g.page, { width: 1280, height: 800, checkVerticalFit: true });
        assert(metrics.campusBar.bottom <= 801, `.campus-bar bottom ${metrics.campusBar.bottom} > 800`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T2-F12-04',
    tier: 2,
    feature: 'F12',
    bucket: 'A',
    name: 'DPR=1 vs DPR=2 doubles canvas pixel buffer while keeping CSS screenRect invariant',
    async fn({ browser, baseUrl }) {
      const g1 = await openGame(browser, baseUrl, { viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
      const g2 = await openGame(browser, baseUrl, { viewport: { width: 960, height: 600 }, deviceScaleFactor: 2 });
      try {
        const s1 = await startGame(g1.page, 'button');
        const s2 = await startGame(g2.page, 'button');
        assertEqual(s1.viewport.cssW, s2.viewport.cssW, 'cssW invariant across DPR');
        assertEqual(s2.viewport.canvasW, s1.viewport.canvasW * 2, 'canvasW doubled at DPR=2');
        assert(s1.player.screenRect && s2.player.screenRect, 'screenRect populated in both DPR modes');
        assert(
          Math.abs(s1.player.screenRect.x - s2.player.screenRect.x) <= 25,
          `screenRect.x drifted across DPR: ${s1.player.screenRect.x} vs ${s2.player.screenRect.x}`,
        );
        g1.tracker.assertNoErrors();
        g2.tracker.assertNoErrors();
      } finally {
        await g1.close();
        await g2.close();
      }
    },
  },
  {
    id: 'T2-F12-05',
    tier: 2,
    feature: 'F12',
    bucket: 'A',
    name: 'player.screenRect shifts left-to-right across lanes and obstacle screenRects are valid',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowLeft');
        const sLeft = await waitForState(
          g.page,
          (s) => s.player.lane === -1 && Math.abs(s.player.x + 2.65) < 0.15 && s.player.screenRect,
          { label: 'left screenRect' },
        );
        await g.page.keyboard.press('ArrowRight');
        await sleep(140);
        await g.page.keyboard.press('ArrowRight');
        const sRight = await waitForState(
          g.page,
          (s) => s.player.lane === 1 && Math.abs(s.player.x - 2.65) < 0.15 && s.player.screenRect,
          { label: 'right screenRect' },
        );
        assert(
          sRight.player.screenRect.x > sLeft.player.screenRect.x + 40,
          `Expected player.screenRect.x to move right: ${sLeft.player.screenRect.x} -> ${sRight.player.screenRect.x}`,
        );
        let checkedRects = 0;
        for (const o of sRight.obstacles) {
          if (o.screenRect) {
            checkedRects++;
            assert(
              Number.isFinite(o.screenRect.x) && o.screenRect.w > 0 && o.screenRect.h > 0,
              `Invalid obstacle screenRect: ${JSON.stringify(o.screenRect)}`,
            );
          }
        }
        assert(checkedRects >= 1, 'Expected at least 1 obstacle with valid screenRect');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
];
