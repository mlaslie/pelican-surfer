import {
  openGame,
  startGame,
  getState,
  waitForState,
  sampleFrames,
  swipeCanvas,
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
  assertMonotonic,
} from '../lib/assertions.mjs';

export const tier3Tests = [
  {
    id: 'T3-01',
    tier: 3,
    feature: 'F3+F4+F5',
    bucket: 'A',
    name: 'Lane switch -> jump -> mid-air double lane switch (-1) completes arc cleanly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowRight');
        await waitForState(g.page, (s) => s.player.lane === 1, { timeoutMs: 800, label: 'lane 1' });
        await g.page.keyboard.press('Space');
        await waitForState(g.page, (s) => s.player.y > 1.4, { timeoutMs: 700, pollMs: 12, label: 'mid-air' });
        await g.page.keyboard.press('ArrowLeft');
        await sleep(35);
        await g.page.keyboard.press('ArrowLeft');
        const landed = await waitForState(
          g.page,
          (s) => s.player.lane === -1 && s.player.grounded && s.player.y <= 0.05,
          { timeoutMs: 1500, pollMs: 15, label: 'landed in lane -1' },
        );
        assertEqual(landed.player.lane, -1, 'mid-air double lane change to -1');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-02',
    tier: 3,
    feature: 'F5+F6',
    bucket: 'A',
    name: 'Jump -> apex fast-fall -> pre-landing buffered jump chains seamlessly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('Space');
        await waitForState(g.page, (s) => s.player.y > 2.1, { timeoutMs: 900, pollMs: 12, label: 'apex' });
        await g.page.keyboard.press('ArrowDown');
        await waitForState(g.page, (s) => s.player.vy <= -20, { timeoutMs: 700, pollMs: 10, label: 'fast-fall' });
        await waitForState(g.page, (s) => s.player.y < 1.8 && s.player.y > 0.05, {
          timeoutMs: 700,
          pollMs: 10,
          label: 'near ground',
        });
        await g.page.keyboard.press('Space');
        const bounced = await waitForState(
          g.page,
          (s) => s.player.vy > 10 && s.player.y > 0.2,
          { timeoutMs: 600, pollMs: 12, label: 'buffered second jump' },
        );
        assert(bounced.player.vy > 10, `Expected buffered 2nd jump vy > 10, got ${bounced.player.vy}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-03',
    tier: 3,
    feature: 'F4+F7',
    bucket: 'A',
    timeoutMs: 25000,
    name: 'Wave 1 ramp -> roof surf -> lateral exit off roof edge lands cleanly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { state } = await rideNearestRampToRoof(g.page);
        const exitKey = state.player.lane >= 0 ? 'ArrowLeft' : 'ArrowRight';
        await g.page.keyboard.press(exitKey);
        const landed = await waitForState(
          g.page,
          (s) => !s.player.onRoof && s.player.grounded && s.player.y <= 0.05,
          { timeoutMs: 1600, pollMs: 15, label: 'side exit landing' },
        );
        assertEqual(landed.state, 'playing', 'playing after lateral roof exit');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-04',
    tier: 3,
    feature: 'F5+F7',
    bucket: 'A',
    timeoutMs: 35000,
    name: 'Roof surf (1.5x score) -> coyote jump off roof end launches mid-air and lands safely',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { launched, landed } = await runWithRestartBudget(
          g.page,
          {
            budgets: [15000, 15000],
            label: 'T3-04 coyote launch from roof',
            shouldRetryError: (err) =>
              /coyote launch|roof end coyote window|upcoming ramped vehicle|player\.onRoof/.test(err.message),
          },
          async () => {
            await rideNearestRampToRoof(g.page);
            await waitForState(g.page, (s) => !s.player.onRoof && s.player.y > 1.6, {
              timeoutMs: 3500,
              pollMs: 12,
              label: 'roof end coyote window',
            });
            await g.page.keyboard.press('Space');
            const launchedState = await waitForState(
              g.page,
              (s) => s.player.vy > 8 && s.player.y > 1.4,
              { timeoutMs: 500, pollMs: 12, label: 'coyote launch' },
            );
            assert(launchedState.player.vy > 8, 'coyote launch vy > 8');
            const landedState = await waitForState(
              g.page,
              (s) => s.player.grounded && s.player.y <= 0.05,
              { timeoutMs: 1800, pollMs: 15, label: 'safe ground landing' },
            );
            return { ok: true, result: { launched: launchedState, landed: landedState } };
          },
        );
        assert(launched.player.vy > 8, 'coyote launch vy > 8');
        assertEqual(landed.state, 'playing', 'survived coyote jump landing');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-05',
    tier: 3,
    feature: 'F6+F7',
    bucket: 'A',
    timeoutMs: 25000,
    name: 'Roof surf -> fast-fall slam off roof retains active ground duck on touchdown',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await rideNearestRampToRoof(g.page);
        await g.page.keyboard.press('ArrowLeft');
        await waitForState(g.page, (s) => !s.player.onRoof && s.player.y > 1.6, {
          timeoutMs: 1200,
          pollMs: 12,
          label: 'airborne off roof',
        });
        await g.page.keyboard.press('ArrowDown');
        await waitForState(g.page, (s) => s.player.vy <= -20, { timeoutMs: 650, pollMs: 10, label: 'fast-fall vy' });
        const landed = await waitForState(
          g.page,
          (s) => s.player.y <= 0.1 && s.player.grounded,
          { timeoutMs: 900, pollMs: 12, label: 'landed ducking' },
        );
        assert(landed.player.duckAmount > 0.35 || landed.player.duckTimer > 0.2, 'duck preserved on fast-fall touchdown');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-06',
    tier: 3,
    feature: 'F4+F8',
    bucket: 'A',
    timeoutMs: 55000,
    name: 'Mid-ramp lateral switch (no teleport) followed by vehicle side-bump recovers safely',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { postRamp, recovered, after } = await runWithRestartBudget(
          g.page,
          {
            budgets: [24000, 24000],
            label: 'T3-06 mid-ramp + side-bump recovery',
            shouldRetryError: (err) => /Could not find an adjacent vehicle/.test(err.message),
          },
          async () => {
            await waitForState(
              g.page,
              (s) => s.obstacles.some((o) => o.type === 'vehicle' && o.hasRamp && o.lane === 1 && o.zStart <= 3.5 && o.zStart >= 1.6),
              { timeoutMs: 8000, pollMs: 12, label: 'mid-ramp' },
            );
            await g.page.keyboard.press('ArrowRight');
            await sleep(180);
            const postRampState = await g.getState();
            assertEqual(postRampState.state, 'playing', 'mid-ramp lateral switch must not crash');
            assert(postRampState.player.y < 0.5, `Must not teleport onto elevated ramp (y=${postRampState.player.y})`);
            assert(
              postRampState.player.stumbleTimer > 2.0,
              `Expected mid-ramp bump stumbleTimer > 2.0, got ${postRampState.player.stumbleTimer}`,
            );

            const rec = await driveRun(g.page, {
              maxMs: 6500,
              pollMs: 20,
              until: (s) => s.player.stumbleTimer === 0,
            });
            if (rec.state !== 'playing' || rec.player.stumbleTimer !== 0) {
              return { ok: false, reason: `recovery failed: state=${rec?.state}, stumble=${rec?.player?.stumbleTimer}` };
            }

            const bumpRes = await triggerSideBump(g.page, { maxMs: 18000 });
            return { ok: true, result: { postRamp: postRampState, recovered: rec, after: bumpRes.after } };
          },
        );
        assertEqual(postRamp.state, 'playing', 'mid-ramp lateral switch must not crash');
        assert(postRamp.player.y < 0.5, `Must not teleport onto elevated ramp (y=${postRamp.player.y})`);
        assert(postRamp.player.stumbleTimer > 2.0, `Expected mid-ramp bump stumbleTimer > 2.0, got ${postRamp.player.stumbleTimer}`);
        assertEqual(recovered.state, 'playing', 'survived stumble recovery');
        assertEqual(recovered.player.stumbleTimer, 0, 'stumbleTimer recovered to 0 before 2nd side-bump test');
        assertEqual(after.state, 'playing', 'clean vehicle side-bump recoverable');
        assert(after.player.stumbleTimer > 0.4, 'stumbleTimer active after vehicle side-bump');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-07',
    tier: 3,
    feature: 'F8+F9',
    bucket: 'A',
    timeoutMs: 55000,
    name: 'First-bump stumble survival continues collecting coins and recovers cleanly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { after, end, coinsBefore } = await runWithRestartBudget(
          g.page,
          {
            budgets: [24000, 24000],
            label: 'T3-07 stumble survival + coins',
            shouldRetryError: (err) => /Could not find an adjacent vehicle/.test(err.message),
          },
          async () => {
            const bumpRes = await triggerSideBump(g.page, { maxMs: 18000 });
            assertEqual(bumpRes.after.state, 'playing', 'survived bump');
            const preCoins = bumpRes.after.coins;
            const recEnd = await driveRun(g.page, {
              maxMs: 8000,
              preferCoins: true,
              until: (s) => s.player.stumbleTimer === 0 && s.coins > preCoins,
            });
            if (recEnd.state === 'playing' && recEnd.player.stumbleTimer === 0 && recEnd.coins > preCoins) {
              return { ok: true, result: { after: bumpRes.after, end: recEnd, coinsBefore: preCoins } };
            }
            return {
              ok: false,
              reason: `state=${recEnd?.state}, stumble=${recEnd?.player?.stumbleTimer}, coins=${preCoins}->${recEnd?.coins}`,
            };
          },
        );
        assertEqual(after.state, 'playing', 'survived bump');
        assertEqual(end.state, 'playing', 'remained playing after stumble recovery and coin collection');
        assertEqual(end.player.stumbleTimer, 0, 'stumbleTimer recovered');
        assert(end.coins > coinsBefore, 'collected coins after stumble');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-08',
    tier: 3,
    feature: 'F9+F4+F7',
    bucket: 'A',
    timeoutMs: 220000,
    name: 'Gemini Sparkle overdrive combines coin magnet + vehicle smash (+150)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { pre, end, smashedVeh } = await runWithRestartBudget(
          g.page,
          {
            budgets: [105000, 105000],
            label: 'T3-08 sparkle vehicle smash',
            forceReload: true,
          },
          async () => {
            const s0 = await acquireSparkle(g.page, {
              minTimer: 4.5,
              label: 'T3-08 sparkle overdrive',
            });
            assertEqual(s0.state, 'playing', 'still playing after sparkle pickup');
            assert(s0.player.sparkleTimer > 3.0, 'active sparkle overdrive');
            let smashed = false;
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline) {
              const s = await g.getState();
              if (s.obstacles.some((o) => o.type === 'vehicle' && o.smashed)) {
                smashed = true;
                break;
              }
              if (s.state === 'playing' && s.player.sparkleTimer <= 0.45) break;
              assertEqual(s.state, 'playing', 'invulnerable during overdrive');
              if (s.player.onRoof) {
                await g.page.keyboard.press(s.player.lane >= 0 ? 'ArrowLeft' : 'ArrowRight');
                await sleep(80);
                continue;
              }
              const veh = s.obstacles
                .filter(
                  (o) =>
                    o.type === 'vehicle' &&
                    !o.smashed &&
                    o.zEnd > 0.5 &&
                    (!o.hasRamp || o.zStart <= 4.5) &&
                    s.player.sparkleTimer > 0.7 &&
                    o.zStart < s.speed * (s.player.sparkleTimer - 0.35),
                )
                .sort((a, b) => a.zStart - b.zStart)[0];
              if (veh && veh.lane !== s.player.lane) {
                await g.page.keyboard.press(veh.lane < s.player.lane ? 'ArrowLeft' : 'ArrowRight');
                await sleep(80);
                continue;
              }
              await sleep(25);
            }
            const endState = await g.getState();
            if (smashed && endState.state === 'playing') {
              return { ok: true, result: { pre: s0, end: endState, smashedVeh: smashed } };
            }
            return { ok: false, reason: `smashedVeh=${smashed}, state=${endState?.state}` };
          },
        );
        assert(smashedVeh, 'Expected to smash a vehicle during sparkle overdrive');
        assertEqual(end.state, 'playing', 'still playing after vehicle smash');
        assert(end.score >= pre.score + 150, `Expected +150 smash bonus, pre=${pre.score}, end=${end.score}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-09',
    tier: 3,
    feature: 'F1+F9+F10',
    bucket: 'A',
    timeoutMs: 28000,
    name: 'Manual campus (zurich) + pause + Wipeout badge + restart retention',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await clickCampusPill(g.page, 'zurich');
        await startGame(g.page, 'button');
        await sleep(500);
        await g.page.keyboard.press('KeyP');
        const p1 = await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused' });
        await sleep(350);
        const p2 = await g.getState();
        assertEqual(p2.distance, p1.distance, 'distance frozen during pause');
        await g.page.keyboard.press('KeyP');
        await waitForState(g.page, (s) => s.state === 'playing', { label: 'resumed' });
        assertEqual((await g.getState()).campusId, 'zurich', 'zurich retained after resume');

        await triggerHeadOnCrash(g.page);
        const badge = (await g.page.textContent('#overlay-badge')).trim();
        assert(badge.toUpperCase().includes('ZURICH'), `Expected badge to include ZURICH, got "${badge}"`);
        await g.page.click('#btn-play');
        const restarted = await waitForState(g.page, (s) => s.state === 'playing', { label: 'restarted' });
        assertEqual(restarted.campusId, 'zurich', 'zurich retained across restart');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-10',
    tier: 3,
    feature: 'F1+F11',
    bucket: 'A',
    name: 'Mute (M) + Start (Space) + Bell (B) + Pause (P) + #btn-mute + Resume (Space)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await g.page.keyboard.press('KeyM');
        await startGame(g.page, 'space');
        await g.page.keyboard.press('KeyB');
        await g.page.keyboard.press('KeyP');
        await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused' });
        await g.page.click('#btn-mute');
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔊 Sound', 'unmuted while paused');
        await g.page.keyboard.press('Space');
        const resumed = await waitForState(g.page, (s) => s.state === 'playing', { label: 'resumed via Space' });
        assertEqual(resumed.state, 'playing', 'resumed');
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔊 Sound', 'Space did not re-toggle mute');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-11',
    tier: 3,
    feature: 'F2+F10',
    bucket: 'B',
    name: 'Rapidly cycling all 6 campuses during active play maintains smooth rAF dt <= 0.05',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        for (const id of ['london', 'zurich', 'tokyo', 'nyc', 'sydney', 'mv']) {
          await clickCampusPill(g.page, id);
          const frames = await sampleFrames(g.page, 5);
          for (let i = 0; i < frames.length; i++) {
            assertInRange(frames[i].lastDt, 0, 0.05, `${id} frame[${i}].lastDt`);
            assertInRange(frames[i].campusTransition, 0, 1, `${id} campusTransition`);
            if (i > 0) {
              assert(frames[i].roadScroll > frames[i - 1].roadScroll, `${id} roadScroll stalled`);
            }
          }
        }
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-12',
    tier: 3,
    feature: 'F2+F12',
    bucket: 'B',
    name: 'Dynamic viewport resizes mid-flight update ResizeObserver without resetting run or dt',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 1280, height: 800 } });
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('Space');
        await g.page.setViewportSize({ width: 720, height: 600 });
        const s1 = await waitForState(g.page, (s) => s.viewport.cssW <= 720, { label: 'resize 720x600' });
        assert(s1.distance > 0, 'distance preserved across resize');
        assertInRange(s1.maxDt, 0, 0.05, 'maxDt bounded during resize');

        await g.page.keyboard.press('ArrowLeft');
        await g.page.setViewportSize({ width: 960, height: 600 });
        const s2 = await waitForState(g.page, (s) => s.viewport.cssW > s1.viewport.cssW, { label: 'resize 960x600' });
        assert(s2.distance > s1.distance, 'distance kept advancing across 2nd resize');
        assertInRange(s2.maxDt, 0, 0.05, 'maxDt bounded after 2nd resize');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-13',
    tier: 3,
    feature: 'F4+F5+F6+F12',
    bucket: 'A',
    name: 'Mobile 390x844 touch swipes (right, up, down, left) control rider with zero page scroll',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      try {
        const cdp = await g.context.newCDPSession(g.page);
        await startGame(g.page, 'button');
        await swipeCanvas(g.page, cdp, 'right');
        await waitForState(g.page, (s) => s.player.lane === 1, { timeoutMs: 1200, label: 'swipe right' });
        await swipeCanvas(g.page, cdp, 'up');
        await waitForState(g.page, (s) => s.player.vy > 8 && s.player.y > 1.0, {
          timeoutMs: 1200,
          pollMs: 15,
          label: 'swipe up jump',
        });
        await swipeCanvas(g.page, cdp, 'down');
        await waitForState(g.page, (s) => s.player.vy <= -18 || s.player.duckAmount > 0.35, {
          timeoutMs: 800,
          pollMs: 12,
          label: 'swipe down fast-fall',
        });
        await swipeCanvas(g.page, cdp, 'left');
        await waitForState(g.page, (s) => s.player.lane === 0, { timeoutMs: 1200, label: 'swipe left' });
        const scrollY = await g.page.evaluate(() => window.scrollY);
        assertEqual(scrollY, 0, 'zero accidental page scroll during swipes');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T3-14',
    tier: 3,
    feature: 'F3+F8+F1',
    bucket: 'B',
    timeoutMs: 130000,
    name: 'Sustained acceleration run -> 2nd-bump wipeout -> Game Over DOM matches telemetry exactly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { over, dom } = await runWithRestartBudget(
          g.page,
          {
            budgets: [40000, 40000, 40000],
            label: 'T3-14 acceleration + 2nd-bump wipeout',
            shouldRetryError: (err) => /Could not find an adjacent vehicle/.test(err.message),
          },
          async () => {
            await driveRun(g.page, {
              maxMs: 22000,
              preferCoins: true,
              avoidSparkles: true,
              until: (s) => s.distance >= 80 && s.player.sparkleTimer === 0,
            });
            const fast = await g.getState();
            if (fast.state !== 'playing' || fast.distance < 80) {
              return { ok: false, reason: `acceleration incomplete: state=${fast?.state}, dist=${fast?.distance}` };
            }
            assert(fast.speed > fast.baseSpeed + 1.0, `Expected sustained speed gain, got ${fast.speed}`);
            const { after, key } = await triggerSideBump(g.page, {
              minZEnd: 8.5,
              allowOncoming: false,
              maxMs: 20000,
            });
            assertEqual(after.state, 'playing', 'survived 1st bump');
            assert(after.player.stumbleTimer > 0.5, 'stumbleTimer active');
            await sleep(140);
            await g.page.keyboard.press(key);
            const overState = await waitForState(g.page, (s) => s.state === 'gameover', {
              timeoutMs: 1200,
              pollMs: 15,
              label: '2nd bump wipeout',
            });
            const domState = await g.page.evaluate(() => ({
              score: document.getElementById('final-score').textContent.trim(),
              coins: document.getElementById('final-coins').textContent.trim(),
              dist: document.getElementById('final-dist').textContent.trim(),
              best: document.getElementById('final-best').textContent.trim(),
              desc: document.getElementById('overlay-desc').textContent.trim(),
            }));
            return { ok: true, result: { over: overState, dom: domState } };
          },
        );
        assert(
          dom.desc.includes('Bumped twice'),
          `Expected 2nd-bump gameover reason to include "Bumped twice", got "${dom.desc}"`,
        );
        assertEqual(dom.score, Math.floor(over.score).toLocaleString(), '#final-score');
        assertEqual(dom.coins, over.coins.toLocaleString(), '#final-coins');
        assertEqual(dom.dist, `${Math.floor(over.distance)}m`, '#final-dist');
        assertEqual(dom.best, over.bestScore.toLocaleString(), '#final-best');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
];
