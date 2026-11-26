import {
  openGame,
  startGame,
  waitForState,
  sampleFrames,
  swipeCanvas,
  clickCampusPill,
  driveRun,
  runWithRestartBudget,
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
  assertViewportFit,
  assertCanvasNonBlank,
  captureShot,
  writeManifest,
  upsertManifestShot,
} from '../lib/assertions.mjs';

export const tier4Tests = [
  {
    id: 'T4-01',
    tier: 4,
    feature: 'F2+F4+F5+F6+F12',
    bucket: 'B',
    timeoutMs: 35000,
    name: 'Smoothness & Frame Pacing Run across 960x600 and 1280x800 with 150+ rAF samples',
    async fn({ browser, baseUrl }) {
      for (const vp of [
        { width: 960, height: 600 },
        { width: 1280, height: 800 },
      ]) {
        const g = await openGame(browser, baseUrl, { viewport: vp });
        try {
          await startGame(g.page, 'button');
          const pre = await driveRun(g.page, { maxMs: 2500, until: (s) => s.worldTime >= 1.6 });
          assertEqual(pre.state, 'playing', `${vp.width} remained playing before frame sampling`);

          const [frames] = await Promise.all([
            sampleFrames(g.page, 75),
            (async () => {
              await g.page.keyboard.press('ArrowLeft');
              await sleep(170);
              await g.page.keyboard.press('Space');
              await sleep(220);
              await g.page.keyboard.press('ArrowRight');
              await sleep(680);
              await g.page.keyboard.press('ArrowDown');
            })(),
          ]);
          assertEqual(frames.length, 75, `${vp.width}x${vp.height} sampled frames`);

          const scrolls = [];
          const dists = [];
          let prevRect = null;
          let minPx = Infinity;
          let maxPx = -Infinity;
          let maxPy = 0;
          let maxDuck = 0;
          let tickAdvances = 0;
          for (let i = 0; i < frames.length; i++) {
            const f = frames[i];
            assertEqual(f.state, 'playing', `${vp.width} frame[${i}].state`);
            assertInRange(f.lastDt, 0, 0.05, `${vp.width} frame[${i}].lastDt`);
            assertInRange(f.maxDt, 0, 0.05, `${vp.width} frame[${i}].maxDt`);
            scrolls.push(f.roadScroll);
            dists.push(f.distance);
            if (i > 0 && f.tickCount > frames[i - 1].tickCount) {
              tickAdvances++;
              assert(
                f.roadScroll > frames[i - 1].roadScroll,
                `${vp.width} roadScroll stalled on physics tick ${i}: ${frames[i - 1].roadScroll} -> ${f.roadScroll}`,
              );
              assert(
                f.distance > frames[i - 1].distance,
                `${vp.width} distance stalled on physics tick ${i}: ${frames[i - 1].distance} -> ${f.distance}`,
              );
            }
            assert(
              f.player.screenRect && f.player.screenRect.w > 0 && f.player.screenRect.h > 0,
              `${vp.width} frame[${i}] player.screenRect active`,
            );
            if (prevRect) {
              assert(
                Math.abs(f.player.screenRect.x - prevRect.x) <= vp.width * 0.1,
                `${vp.width} player.screenRect.x jump: ${prevRect.x} -> ${f.player.screenRect.x}`,
              );
              assert(
                Math.abs(f.player.screenRect.y - prevRect.y) <= vp.height * 0.1,
                `${vp.width} player.screenRect.y jump: ${prevRect.y} -> ${f.player.screenRect.y}`,
              );
            }
            prevRect = f.player.screenRect;
            minPx = Math.min(minPx, f.player.x);
            maxPx = Math.max(maxPx, f.player.x);
            maxPy = Math.max(maxPy, f.player.y);
            maxDuck = Math.max(maxDuck, f.player.duckAmount);
          }
          assert(tickAdvances >= 20, `${vp.width} expected >= 20 physics tick advances across 75 frames, got ${tickAdvances}`);
          assert(scrolls[scrolls.length - 1] > scrolls[0] + 5, `${vp.width} expected roadScroll net advance > 5`);
          assert(Math.abs(maxPx - minPx) > 1.5, `${vp.width} expected lateral motion > 1.5u, got ${minPx}..${maxPx}`);
          assert(maxPy > 1.0, `${vp.width} expected jump height > 1.0, got ${maxPy}`);
          assert(maxDuck > 0.3, `${vp.width} expected duckAmount > 0.3, got ${maxDuck}`);
          assertMonotonic(scrolls, { strict: false, label: `${vp.width} roadScroll` });
          assertMonotonic(dists, { strict: false, label: `${vp.width} distance` });

          // Check continuity of any vehicle tracked across >= 8 consecutive frames
          const byVeh = new Map();
          for (const f of frames) {
            for (const o of f.obstacles) {
              if (o.type === 'vehicle' && o.zStart > 2 && o.screenRect) {
                if (!byVeh.has(o.id)) byVeh.set(o.id, []);
                byVeh.get(o.id).push({ tick: f.tickCount, zStart: o.zStart, h: o.screenRect.h });
              }
            }
          }
          let checkedVeh = 0;
          let maxNetGrowth = 0;
          for (const samples of byVeh.values()) {
            if (samples.length >= 8) {
              for (let i = 1; i < samples.length; i++) {
                const prev = samples[i - 1];
                const curr = samples[i];
                if (curr.tick > prev.tick) {
                  assert(
                    curr.zStart < prev.zStart,
                    `${vp.width} vehicle zStart not advancing on tick: ${prev.zStart} -> ${curr.zStart}`,
                  );
                } else {
                  assert(
                    curr.zStart <= prev.zStart,
                    `${vp.width} vehicle zStart regressed: ${prev.zStart} -> ${curr.zStart}`,
                  );
                }
                assert(
                  curr.h >= prev.h - 0.15,
                  `${vp.width} vehicle screenRect.h shrank excessively: ${prev.h} -> ${curr.h}`,
                );
                assert(
                  Math.abs(curr.h - prev.h) <= Math.max(3.0, prev.h * 0.2),
                  `${vp.width} vehicle screenRect.h jitter spike: ${prev.h} -> ${curr.h}`,
                );
              }
              assert(
                samples[samples.length - 1].zStart < samples[0].zStart,
                `${vp.width} expected vehicle zStart net advance`,
              );
              const netGrowth = samples[samples.length - 1].h - samples[0].h;
              assert(
                netGrowth > 0,
                `${vp.width} expected vehicle screenRect.h net growth > 0, got ${netGrowth}`,
              );
              maxNetGrowth = Math.max(maxNetGrowth, netGrowth);
              checkedVeh++;
            }
          }
          assert(checkedVeh >= 1, `Expected >= 1 vehicle tracked >= 8 frames at ${vp.width}x${vp.height}`);
          assert(
            maxNetGrowth > 2.0,
            `Expected tracked vehicle screenRect.h net growth > 2px at ${vp.width}x${vp.height}, got ${maxNetGrowth}`,
          );
          g.tracker.assertNoErrors();
        } finally {
          await g.close();
        }
      }
    },
  },
  {
    id: 'T4-02',
    tier: 4,
    feature: 'F2+F3',
    bucket: 'B',
    timeoutMs: 65000,
    name: 'Approachable Starting Speed & Monotonic Acceleration over 125m+ reactive run',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 1280, height: 800 } });
      try {
        const s0Init = await startGame(g.page, 'button');
        const { end, samples } = await runWithRestartBudget(
          g.page,
          { budgets: [28000, 28000], label: 'T4-02 125m acceleration run' },
          async (attempt, budgetMs) => {
            const s0 = attempt === 0 ? s0Init : await g.getState();
            assert(s0.baseSpeed < 14, `Expected baseSpeed < 14, got ${s0.baseSpeed}`);
            assert(s0.speed < 13.5, `Expected launch speed < 13.5, got ${s0.speed}`);
            assert(s0.speed < s0.legacyBaseSpeed * 0.75, 'noticeably slower than legacy 19 u/s');

            const runSamples = [];
            const res = await driveRun(g.page, {
              maxMs: budgetMs,
              pollMs: 20,
              onSample(s) {
                if (
                  s.state === 'playing' &&
                  (runSamples.length === 0 || s.tickCount > runSamples[runSamples.length - 1].tick)
                ) {
                  runSamples.push({ tick: s.tickCount, d: s.distance, v: s.speed });
                }
              },
              until: (s) => s.distance >= 125,
            });
            if (res.state === 'playing' && res.distance >= 125) {
              return { ok: true, result: { end: res, samples: runSamples } };
            }
            return { ok: false, reason: `state=${res?.state}, dist=${res?.distance}` };
          },
        );

        assertEqual(end.state, 'playing', 'survived sustained acceleration run');
        assert(end.distance >= 125, `Expected distance >= 125, got ${end.distance}`);
        assert(samples.length >= 50, `Expected >= 50 samples over 125m, got ${samples.length}`);
        assertMonotonic(samples.map((x) => x.d), { strict: true, label: 'T4-02 distance' });
        assertMonotonic(samples.map((x) => x.v), { strict: false, label: 'T4-02 speed' });
        const vStart = samples[0].v;
        const vEnd = samples[samples.length - 1].v;
        assert(vEnd > vStart + 1.5, `Expected sustained speed gain > 1.5 u/s, got ${vStart} -> ${vEnd}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T4-03',
    tier: 4,
    feature: 'F1+F5+F6+F10+F12',
    bucket: 'B',
    timeoutMs: 55000,
    name: 'Multi-Campus World Tour & Visual Judge Screenshot Suite (1280x800 & 720x600)',
    async fn({ browser, baseUrl, shotDir }) {
      const manifest = [];

      // 1) Desktop 1280x800 capture suite
      const g = await openGame(browser, baseUrl, { viewport: { width: 1280, height: 800 } });
      try {
        await assertViewportFit(g.page, { width: 1280, height: 800, checkVerticalFit: true });
        await assertCanvasNonBlank(g.page);
        await captureShot(g.page, shotDir, '01_start_1280x800.png', { stage: 'start', vp: '1280x800' }, manifest);

        await startGame(g.page, 'button');

        // Roof surfing on Wave 1 (Mountain View)
        await rideNearestRampToRoof(g.page);
        await assertViewportFit(g.page, { width: 1280, height: 800, checkVerticalFit: true, checkOverlay: false });
        await captureShot(g.page, shotDir, '02_roof_surf_mv_1280x800.png', { stage: 'roof-surf', campus: 'mv' }, manifest);

        // Mid-jump capture
        await g.page.keyboard.press('Space');
        await waitForState(g.page, (s) => s.player.y > 3.2, { timeoutMs: 900, pollMs: 12, label: 'mid-jump height' });
        await captureShot(g.page, shotDir, '03_mid_jump_1280x800.png', { stage: 'mid-jump' }, manifest);
        await waitForState(g.page, (s) => s.player.grounded && s.player.y <= 0.1, { timeoutMs: 2500, label: 'landed' });

        // Ducking capture
        await g.page.keyboard.down('ArrowDown');
        await waitForState(g.page, (s) => s.player.duckAmount > 0.6, { timeoutMs: 600, pollMs: 12, label: 'full duck' });
        await captureShot(g.page, shotDir, '04_ducking_1280x800.png', { stage: 'ducking' }, manifest);
        await g.page.keyboard.up('ArrowDown');

        // Active running across all 6 campuses (waiting for smooth transition to settle)
        const campusShots = [
          ['mv', '05_campus_mv_1280x800.png'],
          ['london', '06_campus_london_1280x800.png'],
          ['zurich', '07_campus_zurich_1280x800.png'],
          ['tokyo', '08_campus_tokyo_1280x800.png'],
          ['nyc', '09_campus_nyc_1280x800.png'],
          ['sydney', '10_campus_sydney_1280x800.png'],
        ];
        for (const [cid, fname] of campusShots) {
          await clickCampusPill(g.page, cid);
          await driveRun(g.page, {
            maxMs: 2400,
            pollMs: 25,
            until: (s) => s.campusId === cid && s.campusTransition >= 0.98,
          });
          // Ensure we didn't wipe out right before capture; if gameover, quick restart
          if ((await g.getState()).state === 'gameover') {
            await g.page.click('#btn-play');
            await waitForState(g.page, (s) => s.state === 'playing', { label: 'revive for campus shot' });
            await sleep(300);
          }
          await assertCanvasNonBlank(g.page);
          await assertViewportFit(g.page, { width: 1280, height: 800, checkVerticalFit: true, checkOverlay: false });
          await captureShot(g.page, shotDir, fname, { stage: 'active-campus', campus: cid }, manifest);
        }

        // Game Over 1280x800
        await triggerHeadOnCrash(g.page);
        await assertViewportFit(g.page, { width: 1280, height: 800, checkVerticalFit: true });
        await captureShot(g.page, shotDir, '11_gameover_1280x800.png', { stage: 'gameover', vp: '1280x800' }, manifest);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }

      // 2) Narrow Desktop 720x600 capture suite
      const gNarrow = await openGame(browser, baseUrl, { viewport: { width: 720, height: 600 } });
      try {
        await assertViewportFit(gNarrow.page, { width: 720, height: 600 });
        await captureShot(gNarrow.page, shotDir, '12_start_720x600.png', { stage: 'start', vp: '720x600' }, manifest);

        await startGame(gNarrow.page, 'button');
        await sleep(350);
        await gNarrow.page.keyboard.press('KeyP');
        await waitForState(gNarrow.page, (s) => s.state === 'paused', { label: 'paused 720x600' });
        await assertViewportFit(gNarrow.page, { width: 720, height: 600 });
        await captureShot(gNarrow.page, shotDir, '13_pause_720x600.png', { stage: 'paused', vp: '720x600' }, manifest);

        await gNarrow.page.keyboard.press('KeyP');
        await waitForState(gNarrow.page, (s) => s.state === 'playing', { label: 'resumed 720x600' });
        await triggerHeadOnCrash(gNarrow.page);
        await assertViewportFit(gNarrow.page, { width: 720, height: 600 });
        await captureShot(gNarrow.page, shotDir, '14_gameover_720x600.png', { stage: 'gameover', vp: '720x600' }, manifest);
        gNarrow.tracker.assertNoErrors();
      } finally {
        await gNarrow.close();
      }

      await writeManifest(shotDir, manifest);
      assert(manifest.length >= 14, `Expected >= 14 visual judge captures, got ${manifest.length}`);
    },
  },
  {
    id: 'T4-04',
    tier: 4,
    feature: 'F4+F5+F6+F7+F8+F9',
    bucket: 'B',
    timeoutMs: 65000,
    name: 'Active Obstacle Navigation, Coin Collection & Roof-Surf Survival (>= 10s, >= 55m)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 1280, height: 800 } });
      try {
        await startGame(g.page, 'button');
        const end = await runWithRestartBudget(
          g.page,
          {
            budgets: [28000, 28000],
            label: 'T4-04 active navigation + roof surf',
            shouldRetryError: (err) => /upcoming ramped vehicle|player\.onRoof/.test(err.message),
          },
          async () => {
            await rideNearestRampToRoof(g.page);
            const res = await driveRun(g.page, {
              maxMs: 22000,
              pollMs: 20,
              preferCoins: true,
              until: (s) => s.distance >= 55 && s.score >= 250 && s.worldTime >= 10.0,
            });
            if (res.state === 'playing' && res.distance >= 55 && res.score >= 250 && res.worldTime >= 10.0) {
              return { ok: true, result: res };
            }
            return {
              ok: false,
              reason: `state=${res?.state}, dist=${res?.distance}, score=${res?.score}, worldTime=${res?.worldTime}`,
            };
          },
        );
        assertEqual(end.state, 'playing', 'survived full navigation run');
        assert(end.coins >= 4, `Expected >= 4 coins collected, got ${end.coins}`);
        assert(end.distance >= 55, `Expected distance >= 55, got ${end.distance}`);
        assert(end.score >= 250, `Expected score >= 250, got ${end.score}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T4-05',
    tier: 4,
    feature: 'F1+F8+F9+F11',
    bucket: 'B',
    timeoutMs: 85000,
    name: 'Stumble Resilience, Bell, Mute, Pause/Resume & localStorage Best-Score Reload Persistence',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 1280, height: 800 } });
      try {
        await startGame(g.page, 'button');
        const { after, mid } = await runWithRestartBudget(
          g.page,
          {
            budgets: [38000, 38000],
            label: 'T4-05 stumble + bell/mute/pause + recovery',
            shouldRetryError: (err) => /Could not find an adjacent vehicle/.test(err.message),
          },
          async () => {
            const bump = await triggerSideBump(g.page, { maxMs: 18000 });
            assertEqual(bump.after.state, 'playing', 'survived 1st bump');
            assert(bump.after.player.stumbleTimer > 0.3, 'stumble active');

            await g.page.keyboard.press('KeyB');
            await g.page.keyboard.press('KeyM');
            assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔇 Muted', 'muted');
            await g.page.keyboard.press('KeyM');

            await g.page.keyboard.press('KeyP');
            await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused' });
            await g.page.keyboard.press('KeyP');
            await waitForState(g.page, (s) => s.state === 'playing', { label: 'resumed' });

            const rec = await driveRun(g.page, {
              maxMs: 8000,
              preferCoins: true,
              preferSparkle: true,
              until: (s) => s.worldTime >= 5.0 && s.player.stumbleTimer === 0,
            });
            if (rec.state === 'playing' && rec.player.stumbleTimer === 0 && rec.worldTime >= 5.0) {
              return { ok: true, result: { after: bump.after, mid: rec } };
            }
            return {
              ok: false,
              reason: `state=${rec?.state}, stumble=${rec?.player?.stumbleTimer}, worldTime=${rec?.worldTime}`,
            };
          },
        );
        assertEqual(after.state, 'playing', 'survived 1st bump');
        assert(after.player.stumbleTimer > 0.3, 'stumble active');
        assertEqual(mid.state, 'playing', 'survived post-resume driveRun before intentional crash');
        assertEqual(mid.player.stumbleTimer, 0, 'stumbleTimer recovered before intentional crash');
        const over = await triggerHeadOnCrash(g.page);
        assert(over.bestScore >= Math.floor(over.score) && over.bestScore > 0, 'bestScore recorded');

        await g.page.reload({ waitUntil: 'domcontentloaded' });
        await waitForState(g.page, (s) => s.state === 'start', { label: 'reloaded' });
        const reloaded = await g.getState();
        assertEqual(reloaded.bestScore, over.bestScore, 'bestScore persisted across reload');
        assertEqual((await g.page.textContent('#hud-best')).trim(), over.bestScore.toLocaleString(), '#hud-best persisted');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T4-06',
    tier: 4,
    feature: 'F1+F4+F5+F6+F10+F12',
    bucket: 'B',
    timeoutMs: 30000,
    name: 'Mobile Portrait 390x844 Touch Swipe Usability & Layout Integrity',
    async fn({ browser, baseUrl, shotDir }) {
      const g = await openGame(browser, baseUrl, {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      try {
        const cdp = await g.context.newCDPSession(g.page);
        await assertViewportFit(g.page, { width: 390, height: 844 });
        await startGame(g.page, 'button');
        await clickCampusPill(g.page, 'london');
        await swipeCanvas(g.page, cdp, 'left');
        await waitForState(g.page, (s) => s.player.lane === -1, { timeoutMs: 1200, label: 'mobile left' });
        await swipeCanvas(g.page, cdp, 'right');
        await waitForState(g.page, (s) => s.player.lane === 0, { timeoutMs: 1200, label: 'mobile right' });
        await swipeCanvas(g.page, cdp, 'up');
        await waitForState(g.page, (s) => s.player.vy > 8 && s.player.y > 1.0, {
          timeoutMs: 1200,
          pollMs: 15,
          label: 'mobile jump',
        });
        await swipeCanvas(g.page, cdp, 'down');
        await waitForState(g.page, (s) => s.player.vy <= -18 || s.player.duckAmount > 0.35, {
          timeoutMs: 900,
          pollMs: 15,
          label: 'mobile duck/fast-fall',
        });
        await assertViewportFit(g.page, { width: 390, height: 844, checkOverlay: false });
        if (shotDir) {
          const entry = await captureShot(g.page, shotDir, '15_mobile_390x844.png', { stage: 'mobile', vp: '390x844' });
          await upsertManifestShot(shotDir, entry);
        }
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
];
