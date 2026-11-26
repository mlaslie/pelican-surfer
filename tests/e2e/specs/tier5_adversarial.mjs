import {
  openGame,
  startGame,
  waitForState,
  clickCampusPill,
  driveRun,
  runWithRestartBudget,
  triggerSideBump,
  sleep,
} from '../lib/harness.mjs';
import {
  assert,
  assertEqual,
  assertInRange,
  assertViewportFit,
} from '../lib/assertions.mjs';

export const tier5Tests = [
  {
    id: 'T5-01',
    tier: 5,
    feature: 'Spawner+F8',
    bucket: 'B',
    timeoutMs: 45000,
    name: 'Oncoming vehicles never overlap same-lane obstacles or active ramps in active play',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const overlaps = [];
        await driveRun(g.page, {
          maxMs: 28000,
          pollMs: 25,
          onSample(s) {
            const active = s.obstacles.filter((o) => !o.smashed && o.zEnd > -1 && o.zStart < 140);
            for (let i = 0; i < active.length; i++) {
              for (let j = i + 1; j < active.length; j++) {
                const a = active[i];
                const b = active[j];
                if (a.lane === b.lane) {
                  const aMin = a.hasRamp ? a.zStart - (a.rampLen || 6.2) : a.zStart;
                  const bMin = b.hasRamp ? b.zStart - (b.rampLen || 6.2) : b.zStart;
                  const ov = Math.min(a.zEnd, b.zEnd) - Math.max(aMin, bMin);
                  if (ov > 0.05) {
                    overlaps.push({ dist: s.distance, a, b, ov });
                  }
                }
              }
            }
          },
          until: (s) => overlaps.length > 0 || s.distance >= 140,
        });
        assertEqual(overlaps.length, 0, `Same-lane obstacle overlaps detected: ${JSON.stringify(overlaps[0])}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T5-02',
    tier: 5,
    feature: 'F12+CSS',
    bucket: 'A',
    name: 'Landscape mobile (667x375) and narrow portrait (320x568) render non-collapsed stage and unclipped overlay',
    async fn({ browser, baseUrl }) {
      for (const vp of [
        { width: 667, height: 375 },
        { width: 320, height: 568 },
      ]) {
        const g = await openGame(browser, baseUrl, { viewport: vp, hasTouch: true, isMobile: true });
        try {
          await assertViewportFit(g.page, vp);
          await startGame(g.page, 'button');
          await assertViewportFit(g.page, { ...vp, checkOverlay: false });
          await g.page.keyboard.press('KeyP');
          await waitForState(g.page, (s) => s.state === 'paused', { label: `paused at ${vp.width}x${vp.height}` });
          await assertViewportFit(g.page, vp);
          g.tracker.assertNoErrors();
        } finally {
          await g.close();
        }
      }
    },
  },
  {
    id: 'T5-03',
    tier: 5,
    feature: 'F1+F11',
    bucket: 'A',
    name: 'Pressing KeyB while paused does not mutate paused canvas pixels',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 960, height: 600 } });
      try {
        await startGame(g.page, 'button');
        await sleep(200);
        await g.page.keyboard.press('KeyP');
        await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused' });
        await sleep(260); // let 200ms #overlay CSS opacity transition finish before baseline capture
        const png1 = await g.page.locator('#game-canvas').screenshot();
        await g.page.keyboard.press('KeyB');
        await sleep(120);
        const png2 = await g.page.locator('#game-canvas').screenshot();
        assertEqual(Buffer.compare(png1, png2), 0, 'Paused canvas bytes must remain identical after KeyB');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T5-04',
    tier: 5,
    feature: 'F1+F10',
    bucket: 'A',
    name: 'Selecting campus or Auto Tour while paused keeps campusTransition and HUD consistent',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 960, height: 600 } });
      try {
        await startGame(g.page, 'button');
        await sleep(200);
        await g.page.keyboard.press('KeyP');
        await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused' });
        await clickCampusPill(g.page, 'tokyo');
        const s1 = await g.getState();
        const hud1 = await g.page.locator('#hud-campus').textContent();
        assertEqual(s1.campusId, 'tokyo', 'campusId updated');
        assertEqual(s1.campusTransition, 1, 'paused campus switch must not freeze at transition=0');
        assert(hud1 && hud1.includes(s1.campusName), `Expected #hud-campus "${hud1}" to include "${s1.campusName}"`);
        await clickCampusPill(g.page, 'auto');
        const s2 = await g.getState();
        const hud2 = await g.page.locator('#hud-campus').textContent();
        assertEqual(s2.lockedCampus, false, 'auto tour unlocked');
        assertEqual(s2.campusTransition, 1, 'paused auto tour must not freeze at transition=0');
        assert(hud2 && hud2.includes(s2.campusName), `Expected #hud-campus "${hud2}" to include "${s2.campusName}"`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T5-05',
    tier: 5,
    feature: 'F1+Storage',
    bucket: 'A',
    timeoutMs: 25000,
    name: 'Corrupted localStorage best scores (Infinity, -Infinity, -500, -0, float) and SecurityError sanitize safely',
    async fn({ browser, baseUrl }) {
      for (const raw of ['Infinity', '-Infinity', '-500', '-0', '123.7', 'not-a-number']) {
        const g = await openGame(browser, baseUrl);
        try {
          await g.page.evaluate((v) => window.localStorage.setItem('pelican_surfer_best', v), raw);
          await g.page.reload({ waitUntil: 'domcontentloaded' });
          await waitForState(g.page, (s) => s.frameCount >= 1, { label: `reload raw=${raw}` });
          const s = await g.getState();
          const hudBest = await g.page.locator('#hud-best').textContent();
          assert(Number.isFinite(s.bestScore) && s.bestScore >= 0, `Invalid bestScore=${s.bestScore} for "${raw}"`);
          assert(Number.isInteger(s.bestScore), `Non-integer bestScore=${s.bestScore} for "${raw}"`);
          assert(hudBest && !hudBest.includes('∞') && !hudBest.includes('-'), `Invalid #hud-best "${hudBest}" for "${raw}"`);
          g.tracker.assertNoErrors();
        } finally {
          await g.close();
        }
      }
      const gBlocked = await openGame(browser, baseUrl, {
        initScript: () => {
          Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() { throw new DOMException('Blocked', 'SecurityError'); },
          });
        },
      });
      try {
        const s = await startGame(gBlocked.page, 'button');
        assertEqual(s.bestScore, 0, 'SecurityError fallback bestScore=0');
        gBlocked.tracker.assertNoErrors();
      } finally {
        await gBlocked.close();
      }
    },
  },
  {
    id: 'T5-06',
    tier: 5,
    feature: 'F4+Touch',
    bucket: 'A',
    name: 'Multi-touch lift-and-jitter does not trigger phantom swipe across active touches',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      try {
        await startGame(g.page, 'button');
        const laneAfter = await g.page.evaluate(() => {
          const canvas = document.getElementById('game-canvas');
          const rect = canvas.getBoundingClientRect();
          const mk = (id, x, y) => new Touch({ identifier: id, target: canvas, clientX: x, clientY: y });
          const t1 = mk(1, rect.left + 100, rect.top + 200);
          const t2 = mk(2, rect.left + 220, rect.top + 200);
          canvas.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], targetTouches: [t1], changedTouches: [t1], bubbles: true }));
          canvas.dispatchEvent(new TouchEvent('touchstart', { touches: [t1, t2], targetTouches: [t1, t2], changedTouches: [t2], bubbles: true }));
          canvas.dispatchEvent(new TouchEvent('touchend', { touches: [t2], targetTouches: [t2], changedTouches: [t1], bubbles: true }));
          const t2Jitter = mk(2, rect.left + 222, rect.top + 200);
          canvas.dispatchEvent(new TouchEvent('touchmove', { touches: [t2Jitter], targetTouches: [t2Jitter], changedTouches: [t2Jitter], bubbles: true }));
          const t2Long = mk(2, rect.left + 320, rect.top + 200);
          canvas.dispatchEvent(new TouchEvent('touchmove', { touches: [t2Long], targetTouches: [t2Long], changedTouches: [t2Long], bubbles: true }));
          return window.__PELICAN_DEBUG__.getState().player.lane;
        });
        assertEqual(laneAfter, 0, 'Secondary touch jitter/move after primary lift must not trigger phantom swipe');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T5-07',
    tier: 5,
    feature: 'F1+F6+Lifecycle',
    bucket: 'A',
    name: 'visibilitychange auto-pauses active run, blur clears held duck, and keyboard repeat events are ignored',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 960, height: 600 } });
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.down('ArrowDown');
        await waitForState(g.page, (s) => s.player.duckAmount > 0.5, { label: 'duck held' });
        await g.page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await waitForState(g.page, (s) => s.player.duckAmount < 0.2, { timeoutMs: 1200, label: 'blur clears duckHeld' });
        await g.page.keyboard.up('ArrowDown');

        const rep = await g.page.evaluate(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', repeat: true, bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', repeat: true, bubbles: true }));
          return window.__PELICAN_DEBUG__.getState();
        });
        assertEqual(rep.state, 'playing', 'repeat KeyP ignored');
        assertEqual(rep.player.lane, 0, 'repeat ArrowLeft ignored');

        await g.page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        const paused = await waitForState(g.page, (s) => s.state === 'paused', { timeoutMs: 800, label: 'hidden auto-pause' });
        assertEqual(paused.state, 'paused', 'auto-paused when document hidden');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T5-08',
    tier: 5,
    feature: 'F4+Queue',
    bucket: 'A',
    name: 'Rapid 4-input lane queue overflow/reversal (L->R->L->R) caps at LANE_QUEUE_MAX=2 cleanly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowLeft');
        await g.page.keyboard.press('ArrowRight');
        await g.page.keyboard.press('ArrowLeft');
        await g.page.keyboard.press('ArrowRight');
        await sleep(500);
        const s = await g.getState();
        assertEqual(s.state, 'playing', 'still playing after 4-input lane burst');
        assertInRange(s.player.lane, -1, 1, 'lane bounded');
        assertEqual(s.player.lane, -1, '4th queued move dropped cleanly at LANE_QUEUE_MAX=2');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T5-09',
    tier: 5,
    feature: 'F1+F8+Touch',
    bucket: 'B',
    timeoutMs: 110000,
    name: 'Touch swipes ignored while paused, rapid pause/resume toggles cleanly, and stumble expiry survives subsequent side-bump',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      try {
        await startGame(g.page, 'button');
        const { firstBump, stillPaused, laneBeforeTouch, resumed, recovered, secondSafeBump } =
          await runWithRestartBudget(
            g.page,
            {
              budgets: [35000, 35000, 35000],
              label: 'T5-09 paused touch + stumble expiry + 2nd safe bump',
              shouldRetryError: (err) => /Could not find an adjacent vehicle/.test(err.message),
            },
            async () => {
              const bump1 = await triggerSideBump(g.page, {
                minZEnd: 6.0,
                allowOncoming: false,
                maxMs: 18000,
              });
              assertEqual(bump1.after.state, 'playing', 'survived 1st side-bump');
              assert(bump1.after.player.stumbleTimer > 0.5, 'stumbleTimer armed after 1st bump');

              // Pause and verify canvas touch swipes cannot unpause or move lane while paused
              await g.page.keyboard.press('KeyP');
              const paused = await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused after bump' });
              const laneBefore = paused.player.lane;

              await g.page.evaluate(() => {
                const canvas = document.getElementById('game-canvas');
                const rect = canvas.getBoundingClientRect();
                const mk = (id, x, y) => new Touch({ identifier: id, target: canvas, clientX: x, clientY: y });
                const startUp = mk(10, rect.left + 150, rect.top + 300);
                const moveUp = mk(10, rect.left + 150, rect.top + 180);
                canvas.dispatchEvent(new TouchEvent('touchstart', { touches: [startUp], targetTouches: [startUp], changedTouches: [startUp], bubbles: true }));
                canvas.dispatchEvent(new TouchEvent('touchmove', { touches: [moveUp], targetTouches: [moveUp], changedTouches: [moveUp], bubbles: true }));
                canvas.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [moveUp], bubbles: true }));

                const startLeft = mk(11, rect.left + 200, rect.top + 250);
                const moveLeft = mk(11, rect.left + 90, rect.top + 250);
                canvas.dispatchEvent(new TouchEvent('touchstart', { touches: [startLeft], targetTouches: [startLeft], changedTouches: [startLeft], bubbles: true }));
                canvas.dispatchEvent(new TouchEvent('touchmove', { touches: [moveLeft], targetTouches: [moveLeft], changedTouches: [moveLeft], bubbles: true }));
                canvas.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [moveLeft], bubbles: true }));
              });
              const pausedCheck = await g.getState();
              assertEqual(pausedCheck.state, 'paused', 'touch swipes while paused must not unpause');
              assertEqual(pausedCheck.player.lane, laneBefore, 'touch swipes while paused must not alter lane');

              // Rapid pause/resume toggling ends cleanly in 'playing'
              await g.page.keyboard.press('KeyP');
              await g.page.keyboard.press('KeyP');
              await g.page.keyboard.press('KeyP');
              const res = await waitForState(g.page, (s) => s.state === 'playing', { label: 'resumed after rapid KeyP' });
              assertEqual(res.state, 'playing', 'rapid pause/resume settles in playing');

              // Drive safely until stumbleTimer expires (<= 0.25), then survive a fresh side-bump
              const rec = await driveRun(g.page, {
                maxMs: 12000,
                pollMs: 30,
                avoidSparkles: true,
                until: (s) => s.player.stumbleTimer <= 0.25,
              });
              if (rec.state !== 'playing' || rec.player.stumbleTimer > 0.25) {
                return {
                  ok: false,
                  reason: `recovery failed: state=${rec?.state}, stumbleTimer=${rec?.player?.stumbleTimer}`,
                };
              }

              const bump2 = await triggerSideBump(g.page, {
                minZEnd: 5.0,
                allowOncoming: false,
                maxMs: 18000,
              });
              return {
                ok: true,
                result: {
                  firstBump: bump1,
                  stillPaused: pausedCheck,
                  laneBeforeTouch: laneBefore,
                  resumed: res,
                  recovered: rec,
                  secondSafeBump: bump2,
                },
              };
            },
          );

        assertEqual(firstBump.after.state, 'playing', 'survived 1st side-bump');
        assert(firstBump.after.player.stumbleTimer > 0.5, 'stumbleTimer armed after 1st bump');
        assertEqual(stillPaused.state, 'paused', 'touch swipes while paused must not unpause');
        assertEqual(stillPaused.player.lane, laneBeforeTouch, 'touch swipes while paused must not alter lane');
        assertEqual(resumed.state, 'playing', 'rapid pause/resume settles in playing');
        assertEqual(recovered.state, 'playing', 'remained playing while stumbleTimer expired');
        assert(recovered.player.stumbleTimer <= 0.25, `Expected stumbleTimer <= 0.25, got ${recovered.player.stumbleTimer}`);
        assertEqual(secondSafeBump.after.state, 'playing', 'survives fresh side-bump once stumbleTimer <= 0.25');
        assert(secondSafeBump.after.player.stumbleTimer > 2.0, `Expected re-armed stumbleTimer > 2.0, got ${secondSafeBump.after.player.stumbleTimer}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
];
