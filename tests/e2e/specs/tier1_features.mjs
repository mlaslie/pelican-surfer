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
  assertViewportFit,
  assertCanvasNonBlank,
  sampleCanvasGrid,
  diffCanvasSamples,
} from '../lib/assertions.mjs';

const CAMPUSES = [
  { idx: 0, id: 'mv', name: 'Mountain View', vehicle: 'GBuses' },
  { idx: 1, id: 'london', name: 'London', vehicle: 'Double-Deckers' },
  { idx: 2, id: 'zurich', name: 'Zurich', vehicle: 'VBZ Trams' },
  { idx: 3, id: 'tokyo', name: 'Tokyo', vehicle: 'Yamanote Cars' },
  { idx: 4, id: 'nyc', name: 'New York', vehicle: 'Box Trucks & Cabs' },
  { idx: 5, id: 'sydney', name: 'Sydney', vehicle: 'Harbor Ferries' },
];

export const tier1Tests = [
  // =========================================================================
  // F1: Start / Pause / Restart & Overlay Lifecycle (T1-F01-01 .. T1-F01-05)
  // =========================================================================
  {
    id: 'T1-F01-01',
    tier: 1,
    feature: 'F1',
    bucket: 'A',
    name: 'Initial boot state shows start overlay, zeroed HUD, and zero runtime errors',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 1280, height: 800 } });
      try {
        const s = await g.getState();
        assertEqual(s.state, 'start', 'boot state');
        const dom = await g.page.evaluate(() => ({
          overlayHidden: document.getElementById('overlay').classList.contains('hidden'),
          title: document.getElementById('overlay-title').textContent.trim(),
          statsHidden: document.getElementById('overlay-stats').hidden,
          btnPlay: document.getElementById('btn-play').textContent.trim(),
          score: document.getElementById('hud-score').textContent.trim(),
          coins: document.getElementById('hud-coins').textContent.trim(),
          best: document.getElementById('hud-best').textContent.trim(),
        }));
        assertEqual(dom.overlayHidden, false, '#overlay hidden');
        assertEqual(dom.title, 'Pelican Surfer', '#overlay-title');
        assertEqual(dom.statsHidden, true, '#overlay-stats.hidden');
        assertEqual(dom.btnPlay, 'Ride Now (Space)', '#btn-play');
        assertEqual(dom.score, '0', '#hud-score');
        assertEqual(dom.coins, '0', '#hud-coins');
        assertEqual(dom.best, '0', '#hud-best');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F01-02',
    tier: 1,
    feature: 'F1',
    bucket: 'A',
    name: 'Clicking #btn-play transitions start -> playing and advances simulation',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        const s1 = await startGame(g.page, 'button');
        const hidden = await g.page.evaluate(() =>
          document.getElementById('overlay').classList.contains('hidden'),
        );
        assertEqual(hidden, true, '#overlay hidden when playing');
        await sleep(350);
        const s2 = await g.getState();
        assertEqual(s2.state, 'playing', 'state after 350ms');
        assert(s2.tickCount > s1.tickCount, 'tickCount should advance');
        assert(s2.distance > s1.distance, 'distance should advance');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F01-03',
    tier: 1,
    feature: 'F1',
    bucket: 'A',
    name: 'Space starts run and KeyP pauses/resumes with frozen simulation during pause',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'space');
        await sleep(400);
        await g.page.keyboard.press('KeyP');
        const paused1 = await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused state' });
        const domPaused = await g.page.evaluate(() => ({
          overlayHidden: document.getElementById('overlay').classList.contains('hidden'),
          title: document.getElementById('overlay-title').textContent.trim(),
          btnPlay: document.getElementById('btn-play').textContent.trim(),
          btnPause: document.getElementById('btn-pause').textContent.trim(),
        }));
        assertEqual(domPaused.overlayHidden, false, '#overlay visible while paused');
        assertEqual(domPaused.title, 'Take a Breather', 'pause title');
        assertEqual(domPaused.btnPlay, 'Resume (Space)', '#btn-play while paused');
        assertEqual(domPaused.btnPause, '▶ Resume', '#btn-pause while paused');

        await sleep(300);
        const paused2 = await g.getState();
        assertEqual(paused2.tickCount, paused1.tickCount, 'tickCount frozen while paused');
        assertEqual(paused2.distance, paused1.distance, 'distance frozen while paused');

        await g.page.keyboard.press('KeyP');
        const resumed = await waitForState(g.page, (s) => s.state === 'playing', { label: 'resumed state' });
        await sleep(250);
        const afterResume = await g.getState();
        assert(afterResume.distance > resumed.distance, 'distance resumes advancing');
        const btnPauseText = await g.page.textContent('#btn-pause');
        assertEqual(btnPauseText.trim(), '⏸ Pause', '#btn-pause after resume');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F01-04',
    tier: 1,
    feature: 'F1',
    bucket: 'A',
    name: 'Clicking #btn-pause pauses and clicking #btn-play resumes gameplay',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await sleep(250);
        await g.page.click('#btn-pause');
        await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused via button' });
        await g.page.click('#btn-play');
        await waitForState(g.page, (s) => s.state === 'playing', { label: 'resumed via #btn-play' });
        const overlayHidden = await g.page.evaluate(() =>
          document.getElementById('overlay').classList.contains('hidden'),
        );
        assertEqual(overlayHidden, true, '#overlay hidden after resume');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F01-05',
    tier: 1,
    feature: 'F1',
    bucket: 'A',
    timeoutMs: 28000,
    name: 'Game Over displays Wipeout stats, saves bestScore, and restarts cleanly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const over = await triggerHeadOnCrash(g.page);
        assertEqual(over.state, 'gameover', 'gameover state');
        const dom = await g.page.evaluate(() => ({
          overlayHidden: document.getElementById('overlay').classList.contains('hidden'),
          title: document.getElementById('overlay-title').textContent.trim(),
          statsHidden: document.getElementById('overlay-stats').hidden,
          finalDist: document.getElementById('final-dist').textContent.trim(),
          btnPlay: document.getElementById('btn-play').textContent.trim(),
          storedBest: Number(window.localStorage.getItem('pelican_surfer_best') || '0'),
        }));
        assertEqual(dom.overlayHidden, false, '#overlay visible on gameover');
        assertEqual(dom.title, 'Wipeout!', 'gameover title');
        assertEqual(dom.statsHidden, false, '#overlay-stats visible');
        assert(/^\d+m$/.test(dom.finalDist), `Expected #final-dist to match /\\d+m/, got "${dom.finalDist}"`);
        assertEqual(dom.btnPlay, 'Ride Again (Space)', '#btn-play on gameover');
        assert(dom.storedBest >= Math.floor(over.score), 'localStorage best >= final score');

        await g.page.click('#btn-play');
        const restarted = await waitForState(
          g.page,
          (s) => s.state === 'playing' && s.distance < 15,
          { label: 'clean restart' },
        );
        assert(restarted.score < 50, `Expected reset score < 50, got ${restarted.score}`);
        assertEqual(restarted.coins, 0, 'coins reset on restart');
        assert(restarted.bestScore >= dom.storedBest, 'bestScore preserved on restart');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F2: Smoothness, Fixed-Timestep & Frame Pacing (T1-F02-01 .. T1-F02-05)
  // =========================================================================
  {
    id: 'T1-F02-01',
    tier: 1,
    feature: 'F2',
    bucket: 'B',
    name: '20 consecutive rAF frames maintain frameCount step=1, monotonic ticks, and dt <= 0.05',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 960, height: 600 } });
      try {
        await startGame(g.page, 'button');
        await sleep(150);
        const frames = await sampleFrames(g.page, 20);
        assertEqual(frames.length, 20, 'sampled frames');
        for (let i = 0; i < frames.length; i++) {
          assertInRange(frames[i].lastDt, 0, 0.05, `frames[${i}].lastDt`);
          assertInRange(frames[i].maxDt, 0, 0.05, `frames[${i}].maxDt`);
          if (i > 0) {
            assertEqual(frames[i].frameCount - frames[i - 1].frameCount, 1, `frameCount delta at ${i}`);
            assert(frames[i].tickCount >= frames[i - 1].tickCount, `tickCount non-decreasing at ${i}`);
          }
        }
        assert(frames[19].tickCount > frames[0].tickCount, 'tickCount advances across 20 frames');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F02-02',
    tier: 1,
    feature: 'F2',
    bucket: 'B',
    name: 'roadScroll and distance advance continuously across 15 rAF frames without stalls or jumps',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 1280, height: 800 } });
      try {
        await startGame(g.page, 'button');
        await sleep(200);
        const frames = await sampleFrames(g.page, 15);
        const dScrolls = [];
        for (let i = 1; i < frames.length; i++) {
          const dScroll = frames[i].roadScroll - frames[i - 1].roadScroll;
          const dDist = frames[i].distance - frames[i - 1].distance;
          assert(dScroll > 0, `Expected positive dRoadScroll at frame ${i}, got ${dScroll}`);
          assert(dDist > 0, `Expected positive dDistance at frame ${i}, got ${dDist}`);
          dScrolls.push(dScroll);
        }
        const sorted = [...dScrolls].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const maxJump = Math.max(...dScrolls);
        assert(maxJump <= median * 2.5 + 0.05, `Erratic roadScroll jump: max=${maxJump}, median=${median}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F02-03',
    tier: 1,
    feature: 'F2',
    bucket: 'B',
    name: 'Approaching vehicle screenRect scales smoothly without jitter or camera shake noise',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 960, height: 600 } });
      try {
        await startGame(g.page, 'button');
        await waitForState(
          g.page,
          (s) => s.obstacles.some((o) => o.type === 'vehicle' && o.zStart > 12 && o.zStart < 26 && o.screenRect),
          { timeoutMs: 6000, label: 'visible approaching vehicle in mid-range' },
        );
        const frames = await sampleFrames(g.page, 36);
        const firstVeh = frames[0].obstacles.find((o) => o.type === 'vehicle' && o.zStart > 12 && o.zStart < 26 && o.screenRect);
        assert(firstVeh, 'Expected approaching vehicle in first sampled frame');
        const heights = [];
        for (const f of frames) {
          assertEqual(f.camera.shakeX, 0, 'camera.shakeX without crash');
          assertEqual(f.camera.shakeY, 0, 'camera.shakeY without crash');
          const v = f.obstacles.find((o) => o.id === firstVeh.id);
          if (v && v.zStart > 2 && v.screenRect) {
            heights.push(v.screenRect.h);
          }
        }
        assert(heights.length >= 12, `Expected >= 12 valid screenRect samples, got ${heights.length}`);
        assertMonotonic(heights, { strict: false, label: 'approaching vehicle screenRect.h' });
        assert(
          heights[heights.length - 1] > heights[0] + 5,
          `Expected approaching vehicle screenRect.h to grow > 5px, got ${heights[0]} -> ${heights[heights.length - 1]}`,
        );
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F02-04',
    tier: 1,
    feature: 'F2',
    bucket: 'B',
    name: 'Canvas pixels animate actively during playing and freeze cleanly when paused',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 960, height: 600 } });
      try {
        await startGame(g.page, 'button');
        await sleep(200);
        const p1 = await sampleCanvasGrid(g.page);
        await sleep(450);
        const p2 = await sampleCanvasGrid(g.page);
        const playDiff = diffCanvasSamples(p1, p2);
        assert(playDiff.ratio > 0.05, `Expected >5% pixel change while playing, got ${(playDiff.ratio * 100).toFixed(1)}%`);

        await g.page.keyboard.press('KeyP');
        await waitForState(g.page, (s) => s.state === 'paused', { label: 'paused' });
        const q1 = await sampleCanvasGrid(g.page);
        await sleep(300);
        const q2 = await sampleCanvasGrid(g.page);
        const pauseDiff = diffCanvasSamples(q1, q2);
        assert(pauseDiff.ratio < 0.005, `Expected <0.5% pixel change while paused, got ${(pauseDiff.ratio * 100).toFixed(1)}%`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F02-05',
    tier: 1,
    feature: 'F2',
    bucket: 'B',
    name: 'HUD removes backdrop-filter compositor thrash and syncs score text accurately',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await sleep(400);
        const s = await g.getState();
        const styles = await g.page.evaluate(() => {
          const card = document.getElementById('hud-score').closest('.stat-card');
          const pill = document.getElementById('hud-campus');
          const csCard = getComputedStyle(card);
          const csPill = getComputedStyle(pill);
          return {
            cardFilter: csCard.backdropFilter || csCard.webkitBackdropFilter || 'none',
            pillFilter: csPill.backdropFilter || csPill.webkitBackdropFilter || 'none',
            hudScoreText: document.getElementById('hud-score').textContent.trim(),
          };
        });
        assertEqual(styles.cardFilter, 'none', '.stat-card backdrop-filter');
        assertEqual(styles.pillFilter, 'none', '#hud-campus backdrop-filter');
        const numericHud = Number(styles.hudScoreText.replace(/,/g, ''));
        assert(Math.abs(numericHud - Math.floor(s.score)) <= 2, `HUD score ${numericHud} vs state ${s.score}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F3: Starting Pace & Monotonic Speed Curve (T1-F03-01 .. T1-F03-05)
  // =========================================================================
  {
    id: 'T1-F03-01',
    tier: 1,
    feature: 'F3',
    bucket: 'B',
    name: 'Starting speed is noticeably slower than legacy 19 u/s baseline',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        const s = await startGame(g.page, 'button');
        assert(s.baseSpeed < 14, `Expected baseSpeed < 14, got ${s.baseSpeed}`);
        assertEqual(s.legacyBaseSpeed, 19, 'legacyBaseSpeed');
        assert(s.speed < 13.5, `Expected initial speed < 13.5, got ${s.speed}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F03-02',
    tier: 1,
    feature: 'F3',
    bucket: 'B',
    name: 'Speed increases monotonically with distance over sustained run',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const samples = [];
        const end = await driveRun(g.page, {
          maxMs: 7000,
          pollMs: 250,
          onSample(s) {
            if (s.state === 'playing') samples.push({ d: s.distance, v: s.speed });
          },
          until: (s) => s.worldTime >= 5.5,
        });
        assertEqual(end.state, 'playing', 'remained playing throughout monotonic speed run');
        assert(end.worldTime >= 5.5, `Expected worldTime >= 5.5, got ${end.worldTime}`);
        assert(samples.length >= 12, `Expected >= 12 samples, got ${samples.length}`);
        assertMonotonic(samples.map((x) => x.d), { strict: true, label: 'distance' });
        assertMonotonic(samples.map((x) => x.v), { strict: false, label: 'speed' });
        assert(
          samples[samples.length - 1].v > samples[0].v + 0.3,
          `Expected speed gain > 0.3, got ${samples[0].v} -> ${samples[samples.length - 1].v}`,
        );
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F03-03',
    tier: 1,
    feature: 'F3',
    bucket: 'B',
    name: 'Launch pacing keeps early 1.5s onboarding distance approachable (< 12m)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const s = await waitForState(g.page, (st) => st.worldTime >= 1.45, {
          timeoutMs: 3500,
          pollMs: 15,
          label: 'worldTime >= 1.45s',
        });
        assert(s.distance < 12, `Expected approachable 1.5s distance < 12, got ${s.distance}`);
        assert(s.speed < 14, `Expected early speed < 14, got ${s.speed}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F03-04',
    tier: 1,
    feature: 'F3',
    bucket: 'B',
    name: 'Speed remains strictly within [baseSpeed, 46] during active play',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        let sampleCount = 0;
        const end = await driveRun(g.page, {
          maxMs: 4000,
          pollMs: 100,
          onSample(s) {
            sampleCount++;
            assertEqual(s.state, 'playing', 'active play during speed check');
            assertInRange(s.speed, s.baseSpeed, 46, 'active speed');
          },
          until: (s) => s.worldTime >= 3.2,
        });
        assertEqual(end.state, 'playing', 'remained playing throughout speed check');
        assert(sampleCount >= 10, `Expected >= 10 active speed samples, got ${sampleCount}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F03-05',
    tier: 1,
    feature: 'F3',
    bucket: 'B',
    timeoutMs: 32000,
    name: 'Restart resets speed cleanly back to baseSpeed',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const fastState = await driveRun(g.page, { maxMs: 6000, until: (s) => s.worldTime >= 4.5 });
        assertEqual(fastState.state, 'playing', 'remained playing during speed ramp');
        assert(fastState.worldTime >= 4.5, `Expected worldTime >= 4.5, got ${fastState.worldTime}`);
        assert(fastState.speed > fastState.baseSpeed + 0.2, `speed increased before crash (${fastState.speed} vs ${fastState.baseSpeed})`);
        await triggerHeadOnCrash(g.page);
        await g.page.click('#btn-play');
        const restarted = await waitForState(g.page, (s) => s.state === 'playing', { label: 'restarted' });
        assert(
          restarted.speed < restarted.baseSpeed + 1.0,
          `Expected speed reset near ${restarted.baseSpeed}, got ${restarted.speed}`,
        );
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F4: 3-Lane Switching & Input Queue (T1-F04-01 .. T1-F04-05)
  // =========================================================================
  {
    id: 'T1-F04-01',
    tier: 1,
    feature: 'F4',
    bucket: 'A',
    name: 'ArrowLeft moves rider cleanly from lane 0 to lane -1',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowLeft');
        const s = await waitForState(
          g.page,
          (st) => st.player.lane === -1 && Math.abs(st.player.x - -2.65) < 0.15,
          { timeoutMs: 1200, label: 'lane -1 arrival' },
        );
        assertEqual(s.player.targetX, -2.65, 'targetX');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F04-02',
    tier: 1,
    feature: 'F4',
    bucket: 'A',
    name: 'ArrowRight moves rider cleanly from lane 0 to lane 1',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowRight');
        const s = await waitForState(
          g.page,
          (st) => st.player.lane === 1 && Math.abs(st.player.x - 2.65) < 0.15,
          { timeoutMs: 1200, label: 'lane 1 arrival' },
        );
        assertEqual(s.player.targetX, 2.65, 'targetX');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F04-03',
    tier: 1,
    feature: 'F4',
    bucket: 'A',
    name: 'KeyA and KeyD aliases navigate across all 3 lanes (-1 -> 0 -> 1)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('KeyA');
        await waitForState(g.page, (st) => st.player.lane === -1, { timeoutMs: 1000, label: 'KeyA to -1' });
        await g.page.keyboard.press('KeyD');
        await sleep(160);
        await g.page.keyboard.press('KeyD');
        const s = await waitForState(
          g.page,
          (st) => st.player.lane === 1 && Math.abs(st.player.x - 2.65) < 0.2,
          { timeoutMs: 1500, label: 'KeyD x2 to +1' },
        );
        assertEqual(s.player.lane, 1, 'final lane');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F04-04',
    tier: 1,
    feature: 'F4',
    bucket: 'A',
    name: 'Lateral lane transition interpolates smoothly across frames with lean tilt',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowRight');
        const frames = await sampleFrames(g.page, 22);
        const xs = frames.map((f) => f.player.x);
        const maxTilt = Math.max(...frames.map((f) => Math.abs(f.player.tilt)));
        let maxStep = 0;
        for (let i = 1; i < xs.length; i++) {
          maxStep = Math.max(maxStep, Math.abs(xs[i] - xs[i - 1]));
        }
        assert(maxStep < 1.2, `Lane transition teleported: max single-frame dx=${maxStep}`);
        assert(xs[xs.length - 1] > 1.8, `Expected smooth progress toward 2.65, ended at ${xs[xs.length - 1]}`);
        assert(maxTilt > 0.05, `Expected noticeable lean tilt > 0.05, got ${maxTilt}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F04-05',
    tier: 1,
    feature: 'F4',
    bucket: 'A',
    name: 'Touch swipe left and right switch lanes on mobile viewport',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      try {
        const cdp = await g.context.newCDPSession(g.page);
        await startGame(g.page, 'button');
        await swipeCanvas(g.page, cdp, 'left');
        await waitForState(g.page, (s) => s.player.lane === -1, { timeoutMs: 1200, label: 'swipe left to -1' });
        await swipeCanvas(g.page, cdp, 'right');
        await waitForState(g.page, (s) => s.player.lane === 0, { timeoutMs: 1200, label: 'swipe right to 0' });
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F5: Jumping, Coyote Time & Jump Buffering (T1-F05-01 .. T1-F05-05)
  // =========================================================================
  {
    id: 'T1-F05-01',
    tier: 1,
    feature: 'F5',
    bucket: 'A',
    name: 'Space triggers grounded jump arc (> 2.0u apex) and lands cleanly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('Space');
        let peakY = 0;
        let sawUpward = false;
        const landed = await waitForState(
          g.page,
          (s) => {
            if (s.player.vy > 10) sawUpward = true;
            if (s.player.y > peakY) peakY = s.player.y;
            return sawUpward && peakY > 2.0 && s.player.y <= 0.05 && s.player.grounded;
          },
          { timeoutMs: 1600, pollMs: 15, label: 'jump apex and landing' },
        );
        assert(sawUpward, 'Expected initial upward vy > 10');
        assert(peakY > 2.0, `Expected peak y > 2.0, got ${peakY}`);
        assertEqual(landed.player.grounded, true, 'grounded after landing');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F05-02',
    tier: 1,
    feature: 'F5',
    bucket: 'A',
    name: 'ArrowUp and KeyW jump aliases both produce clean jump arcs',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowUp');
        await waitForState(g.page, (s) => s.player.y > 1.5, { timeoutMs: 1000, label: 'ArrowUp jump' });
        await waitForState(g.page, (s) => s.player.grounded && s.player.y <= 0.05, { timeoutMs: 1400, label: 'land 1' });
        await g.page.keyboard.press('KeyW');
        await waitForState(g.page, (s) => s.player.y > 1.5, { timeoutMs: 1000, label: 'KeyW jump' });
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F05-03',
    tier: 1,
    feature: 'F5',
    bucket: 'A',
    timeoutMs: 35000,
    name: 'Coyote time permits jumping right after stepping off a vehicle roof',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { edge, jumped } = await runWithRestartBudget(
          g.page,
          {
            budgets: [15000, 15000],
            label: 'T1-F05-03 coyote roof jump',
            shouldRetryError: (err) =>
              /coyote mid-air jump|roof edge exit|upcoming ramped vehicle|player\.onRoof/.test(err.message),
          },
          async () => {
            await rideNearestRampToRoof(g.page);
            // Wait until rider just steps off roof end (onRoof becomes false while y is still elevated)
            const edgeState = await waitForState(
              g.page,
              (s) => !s.player.onRoof && s.player.y > 1.6,
              { timeoutMs: 3500, pollMs: 12, label: 'roof edge exit' },
            );
            assert(
              edgeState.player.coyoteTimer > 0,
              `Expected coyoteTimer > 0 on roof exit, got ${edgeState.player.coyoteTimer}`,
            );
            await g.page.keyboard.press('Space');
            const jumpedState = await waitForState(
              g.page,
              (s) => s.player.vy > 8 && s.player.y > 1.4,
              { timeoutMs: 500, pollMs: 12, label: 'coyote mid-air jump' },
            );
            return { ok: true, result: { edge: edgeState, jumped: jumpedState } };
          },
        );
        assert(edge.player.coyoteTimer > 0, `Expected coyoteTimer > 0 on roof exit, got ${edge.player.coyoteTimer}`);
        assert(jumped.player.vy > 8, `Expected coyote jump vy > 8, got ${jumped.player.vy}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F05-04',
    tier: 1,
    feature: 'F5',
    bucket: 'A',
    name: 'Jump buffering queues pre-landing Space press and auto-jumps on ground contact',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('Space');
        await waitForState(
          g.page,
          (s) => s.player.vy < -2 && s.player.y > 0.15 && s.player.y < 1.0,
          { timeoutMs: 1300, pollMs: 12, label: 'late descent window' },
        );
        await g.page.keyboard.press('Space');
        const autoJumped = await waitForState(
          g.page,
          (s) => s.player.vy > 10 && s.player.y < 1.5,
          { timeoutMs: 600, pollMs: 12, label: 'buffered auto-jump' },
        );
        assert(
          autoJumped.player.vy > 10 && autoJumped.player.y < 1.5,
          `Expected jump buffer to trigger second jump, got vy=${autoJumped.player.vy}, y=${autoJumped.player.y}`,
        );
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F05-05',
    tier: 1,
    feature: 'F5',
    bucket: 'A',
    timeoutMs: 35000,
    name: 'Reactive jump clears low hurdle cleanly without wipeout',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { end, cleared } = await runWithRestartBudget(
          g.page,
          { budgets: [14000, 14000], label: 'T1-F05-05 reactive low hurdle jump' },
          async (_attempt, budgetMs) => {
            let didClear = false;
            let jumpedOver = false;
            let targetId = null;
            const res = await driveRun(g.page, {
              maxMs: budgetMs,
              pollMs: 20,
              onSample(s) {
                if (!targetId) {
                  const low = s.obstacles.find((o) => o.type === 'low' && o.zStart > 4);
                  if (low) targetId = low.id;
                }
                if (targetId) {
                  const o = s.obstacles.find((x) => x.id === targetId);
                  if (o && o.lane === s.player.lane && o.zStart <= 1 && o.zEnd >= -1 && s.player.y >= 0.85) {
                    jumpedOver = true;
                  }
                  if (jumpedOver && o && o.zEnd < -2 && s.state === 'playing') didClear = true;
                }
              },
              until: () => didClear,
            });
            if (didClear && res.state === 'playing') {
              return { ok: true, result: { end: res, cleared: didClear } };
            }
            return { ok: false, reason: `state=${res?.state}, cleared=${didClear}` };
          },
        );
        assert(cleared, 'Expected to jump over and clear a low hurdle in same lane while playing');
        assertEqual(end.state, 'playing', 'remained playing after clearing low hurdle');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F6: Fast-Fall & Ducking (T1-F06-01 .. T1-F06-05)
  // =========================================================================
  {
    id: 'T1-F06-01',
    tier: 1,
    feature: 'F6',
    bucket: 'A',
    name: 'ArrowDown activates grounded duck smoothly (duckAmount > 0.35)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('ArrowDown');
        const s = await waitForState(
          g.page,
          (st) => st.player.duckAmount > 0.35 && st.player.duckTimer > 0,
          { timeoutMs: 600, pollMs: 15, label: 'duck active' },
        );
        assert(s.player.y < 0.2, `Expected grounded duck y < 0.2, got ${s.player.y}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F06-02',
    tier: 1,
    feature: 'F6',
    bucket: 'A',
    name: 'KeyS alias activates grounded duck',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('KeyS');
        await waitForState(
          g.page,
          (st) => st.player.duckAmount > 0.35 && st.player.duckTimer > 0,
          { timeoutMs: 600, pollMs: 15, label: 'KeyS duck active' },
        );
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F06-03',
    tier: 1,
    feature: 'F6',
    bucket: 'A',
    name: 'Airborne ArrowDown triggers fast-fall (vy <= -20) and rapid landing',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('Space');
        const preDown = await waitForState(g.page, (s) => s.player.y > 2.0, {
          timeoutMs: 900,
          pollMs: 12,
          label: 'jump near apex',
        });
        const tPress = Date.now();
        await g.page.keyboard.press('ArrowDown');
        const ff = await waitForState(g.page, (s) => s.player.vy <= -20, {
          timeoutMs: 600,
          pollMs: 10,
          label: 'fast-fall vy',
        });
        assert(ff.player.vy <= -20, `Expected vy <= -20, got ${ff.player.vy}`);
        const landed = await waitForState(g.page, (s) => s.player.y <= 0.1, {
          timeoutMs: 600,
          pollMs: 12,
          label: 'fast-fall landing',
        });
        assert(
          landed.worldTime - preDown.worldTime < 0.35,
          `Fast-fall simulated descent too slow: ${(landed.worldTime - preDown.worldTime).toFixed(3)}s`,
        );
        assert(Date.now() - tPress < 800, 'Fast-fall took too long to land');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F06-04',
    tier: 1,
    feature: 'F6',
    bucket: 'A',
    name: 'Holding ArrowDown sustains duck past 900ms and releases after keyup',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.down('ArrowDown');
        await sleep(900);
        const held = await g.getState();
        assert(held.player.duckAmount > 0.35, `Expected sustained duck > 0.35 at 900ms, got ${held.player.duckAmount}`);
        await g.page.keyboard.up('ArrowDown');
        await waitForState(g.page, (s) => s.player.duckAmount < 0.2, { timeoutMs: 1000, label: 'duck release' });
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F06-05',
    tier: 1,
    feature: 'F6',
    bucket: 'A',
    timeoutMs: 85000,
    name: 'Ducking clears overhead high gantry cleanly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { duckedUnder, finalState } = await runWithRestartBudget(
          g.page,
          { budgets: [24000, 24000, 24000], label: 'T1-F06-05 duck high gantry' },
          async (_attempt, budgetMs) => {
            let didDuckUnder = false;
            let targetGantryId = null;
            let lastSteerAt = 0;

            const end = await driveRun(g.page, {
              maxMs: budgetMs,
              pollMs: 20,
              avoidRamps: true,
              onSample: async (s) => {
                if (targetGantryId) {
                  const cur = s.obstacles.find((x) => x.id === targetGantryId);
                  if (!cur || (cur.zEnd < -1.5 && !didDuckUnder)) targetGantryId = null;
                }
                if (!targetGantryId) {
                  const hg = s.obstacles.find(
                    (o) =>
                      o.type === 'high' &&
                      o.zStart > 4 &&
                      o.zStart < 15 &&
                      !s.obstacles.some((b) => !b.smashed && b.lane === o.lane && b.zEnd > -0.5 && b.zStart < o.zStart),
                  );
                  if (hg) targetGantryId = hg.id;
                }
                if (targetGantryId && s.state === 'playing') {
                  const o = s.obstacles.find((x) => x.id === targetGantryId);
                  if (o && o.lane !== s.player.lane && o.zStart > 4 && Date.now() - lastSteerAt > 150) {
                    await g.page.keyboard.press(o.lane < s.player.lane ? 'ArrowLeft' : 'ArrowRight');
                    lastSteerAt = Date.now();
                  }
                  if (o && o.lane === s.player.lane && o.zStart <= 1 && o.zEnd >= -1 && s.player.duckAmount > 0.35 && s.player.y < 0.45) {
                    didDuckUnder = true;
                  }
                }
              },
              until: (s) => {
                if (!targetGantryId) return false;
                const o = s.obstacles.find((x) => x.id === targetGantryId);
                return didDuckUnder && (!o || o.zEnd < -1.5) && s.state === 'playing';
              },
            });
            if (didDuckUnder && end.state === 'playing') {
              return { ok: true, result: { duckedUnder: didDuckUnder, finalState: end } };
            }
            return { ok: false, reason: `state=${end?.state}, duckedUnder=${didDuckUnder}` };
          },
        );
        assert(duckedUnder, 'Expected to encounter and duck cleanly under a high gantry');
        assertEqual(finalState.state, 'playing', 'survived gantry');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F7: Ramp Launches & Roof Surfing (T1-F07-01 .. T1-F07-05)
  // =========================================================================
  {
    id: 'T1-F07-01',
    tier: 1,
    feature: 'F7',
    bucket: 'A',
    timeoutMs: 25000,
    name: 'Riding Wave 1 ramp climbs smoothly onto vehicle roof (onRoof === true)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { state } = await rideNearestRampToRoof(g.page);
        assertEqual(state.player.onRoof, true, 'onRoof');
        assert(state.player.y >= 2.2, `Expected roof height >= 2.2, got ${state.player.y}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F07-02',
    tier: 1,
    feature: 'F7',
    bucket: 'A',
    timeoutMs: 25000,
    name: 'Cresting ramp top delivers genuine upward launch velocity (vy > 0)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        let maxCrestVy = -999;
        let peakCrestY = 0;
        let crestSamples = 0;
        const end = await driveRun(g.page, {
          maxMs: 12000,
          pollMs: 12,
          preferRoof: true,
          onSample(s) {
            if (s.player.onRoof) {
              crestSamples++;
              if (s.player.vy > maxCrestVy) maxCrestVy = s.player.vy;
              if (s.player.y > peakCrestY) peakCrestY = s.player.y;
            }
          },
          until: (s) => s.player.onRoof && s.player.grounded && crestSamples >= 2,
        });
        assertEqual(end.state, 'playing', 'survived ramp crest onto roof');
        assert(crestSamples >= 2, `Expected >= 2 samples during post-crest launch hop, got ${crestSamples}`);
        assert(maxCrestVy > 1.0, `Expected upward crest launch vy > 1.0 after onRoof, got ${maxCrestVy}`);
        assert(peakCrestY >= 2.45, `Expected crest launch arc peak >= 2.45 (above ROOF_H 2.35), got ${peakCrestY}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F07-03',
    tier: 1,
    feature: 'F7',
    bucket: 'B',
    timeoutMs: 25000,
    name: 'Roof surfing scores at ~1.5x distance rate compared to 1.0x ground running',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        // Ground segment sample (stay in lane 0 briefly before Wave 1 coins, or sample between coins)
        const g1 = await g.getState();
        await sleep(350);
        const g2 = await g.getState();
        const groundNonCoin = g2.score - g1.score - 25 * (g2.coins - g1.coins);
        const groundScroll = g2.roadScroll - g1.roadScroll;
        const groundRate = groundNonCoin / groundScroll;

        await rideNearestRampToRoof(g.page);
        const r1 = await g.getState();
        await sleep(450);
        const r2 = await g.getState();
        assertEqual(r2.player.onRoof, true, 'Remained on roof during sample window');
        const roofNonCoin = r2.score - r1.score - 25 * (r2.coins - r1.coins);
        const roofScroll = r2.roadScroll - r1.roadScroll;
        const roofRate = roofNonCoin / roofScroll;

        assertInRange(groundRate, 0.85, 1.15, 'ground score multiplier');
        assertInRange(roofRate, 1.32, 1.68, 'roof surf 1.5x score multiplier');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F07-04',
    tier: 1,
    feature: 'F7',
    bucket: 'A',
    timeoutMs: 28000,
    name: 'Surfing Wave 1 roof collects roof coins (>= 3)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await rideNearestRampToRoof(g.page);
        const s = await waitForState(
          g.page,
          (st) => st.coins >= 3 || !st.player.onRoof,
          { timeoutMs: 3000, pollMs: 20, label: 'roof coin collection' },
        );
        assert(s.coins >= 3, `Expected >= 3 roof coins collected, got ${s.coins}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F07-05',
    tier: 1,
    feature: 'F7',
    bucket: 'A',
    timeoutMs: 25000,
    name: 'Exiting back of vehicle roof drops smoothly back to ground without crashing',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await rideNearestRampToRoof(g.page);
        const landed = await waitForState(
          g.page,
          (s) => !s.player.onRoof && s.player.grounded && s.player.y <= 0.05,
          { timeoutMs: 4000, pollMs: 20, label: 'smooth roof exit landing' },
        );
        assertEqual(landed.state, 'playing', 'still playing after roof exit');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F8: Accurate Collision Bounds & Stumble Forgiveness (T1-F08-01 .. T1-F08-05)
  // =========================================================================
  {
    id: 'T1-F08-01',
    tier: 1,
    feature: 'F8',
    bucket: 'A',
    name: 'Launch stumbleTimer starts at 0 during intro (decoupled from intro Noogler chaser)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        const s0 = await startGame(g.page, 'button');
        assertEqual(s0.player.stumbleTimer, 0, 'stumbleTimer at launch');
        await sleep(500);
        const s1 = await g.getState();
        assert(s1.worldTime < 1.0, 'within intro 1s');
        assertEqual(s1.player.stumbleTimer, 0, 'stumbleTimer remains 0 without bump');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F08-02',
    tier: 1,
    feature: 'F8',
    bucket: 'A',
    timeoutMs: 45000,
    name: 'First side-bump against vehicle body bounces rider back safely and sets stumbleTimer',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { before, after } = await runWithRestartBudget(
          g.page,
          {
            budgets: [18000, 18000],
            label: 'T1-F08-02 first side-bump',
            shouldRetryError: (err) => /Could not find an adjacent vehicle/.test(err.message),
          },
          async (_attempt, budgetMs) => {
            const res = await triggerSideBump(g.page, { maxMs: budgetMs });
            return { ok: true, result: res };
          },
        );
        assertEqual(after.state, 'playing', 'survives first side-bump');
        assertEqual(after.player.lane, before.player.lane, 'bounced back to previous lane');
        assert(after.player.stumbleTimer > 0.4, `Expected stumbleTimer > 0.4, got ${after.player.stumbleTimer}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F08-03',
    tier: 1,
    feature: 'F8',
    bucket: 'A',
    timeoutMs: 65000,
    name: 'Second side-bump while stumbleTimer > 0.25 triggers Wipeout gameover',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { over, dom } = await runWithRestartBudget(
          g.page,
          {
            budgets: [18000, 18000, 18000],
            label: 'T1-F08-03 second side-bump wipeout',
            shouldRetryError: (err) => /Could not find an adjacent vehicle/.test(err.message),
          },
          async (_attempt, budgetMs) => {
            const { after, key } = await triggerSideBump(g.page, {
              minZEnd: 8.5,
              allowOncoming: false,
              maxMs: budgetMs,
            });
            assertEqual(after.state, 'playing', 'survived 1st bump');
            assert(after.player.stumbleTimer > 0.5, 'stumbleTimer active');
            await sleep(140);
            await g.page.keyboard.press(key);
            const overState = await waitForState(
              g.page,
              (s) => s.state === 'gameover',
              { timeoutMs: 900, pollMs: 15, label: '2nd bump gameover' },
            );
            const domState = await g.page.evaluate(() => ({
              title: document.getElementById('overlay-title').textContent.trim(),
              desc: document.getElementById('overlay-desc').textContent.trim(),
            }));
            return { ok: true, result: { over: overState, dom: domState } };
          },
        );
        assertEqual(over.state, 'gameover', '2nd bump gameover');
        assertEqual(dom.title, 'Wipeout!', '#overlay-title');
        assert(
          dom.desc.includes('Bumped twice'),
          `Expected 2nd-bump gameover reason to include "Bumped twice", got "${dom.desc}"`,
        );
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F08-04',
    tier: 1,
    feature: 'F8',
    bucket: 'A',
    timeoutMs: 28000,
    name: 'Head-on obstacle collision triggers Wipeout gameover immediately',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const over = await triggerHeadOnCrash(g.page);
        assertEqual(over.state, 'gameover', 'head-on gameover');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F08-05',
    tier: 1,
    feature: 'F8',
    bucket: 'A',
    name: 'Low hurdle and high gantry obstacle bounds match shallow 3D visual geometry',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        let checkedLow = 0;
        let checkedHigh = 0;
        const end = await driveRun(g.page, {
          maxMs: 14000,
          pollMs: 50,
          onSample(s) {
            for (const o of s.obstacles) {
              const depth = o.zEnd - o.zStart;
              if (o.type === 'low') {
                assert(depth > 0 && depth <= 0.85, `Low hurdle depth ${depth} out of visual bounds (<= 0.85)`);
                assertEqual(o.minY, 0, 'low hurdle minY');
                checkedLow++;
              } else if (o.type === 'high') {
                assert(depth > 0 && depth <= 0.95, `High gantry depth ${depth} out of visual bounds (<= 0.95)`);
                assert(o.minY >= 1.2, `High gantry minY ${o.minY} too low (< 1.2)`);
                checkedHigh++;
              }
            }
          },
          until: () => checkedLow > 0 && checkedHigh > 0,
        });
        assertEqual(end.state, 'playing', 'remained playing while inspecting obstacle geometry');
        assert(checkedLow > 0, 'Expected at least 1 low hurdle inspected');
        assert(checkedHigh > 0, 'Expected at least 1 high gantry inspected');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F9: G Coins, Gemini Sparkle Overdrive & Noogler (T1-F09-01 .. T1-F09-05)
  // =========================================================================
  {
    id: 'T1-F09-01',
    tier: 1,
    feature: 'F9',
    bucket: 'A',
    name: 'Wave 1 center coins increment coins counter, HUD, and +25 score bonus',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const s = await waitForState(
          g.page,
          (st) => st.coins >= 4 || st.state !== 'playing',
          { timeoutMs: 8000, label: 'Wave 1 center coins' },
        );
        assert(s.coins >= 4, `Expected >= 4 coins, got ${s.coins}`);
        assert(s.score >= s.coins * 25, `Expected score >= ${s.coins * 25}, got ${s.score}`);
        const hudCoins = await g.page.textContent('#hud-coins');
        assertEqual(hudCoins.trim(), s.coins.toLocaleString(), '#hud-coins synced');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F09-02',
    tier: 1,
    feature: 'F9',
    bucket: 'A',
    timeoutMs: 195000,
    name: 'Collecting Gemini Sparkle activates 7.5s overdrive bar in HUD',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const s = await acquireSparkle(g.page, {
          minTimer: 6.5,
          label: 'T1-F09-02 sparkle HUD',
        });
        assertEqual(s.state, 'playing', 'still playing after sparkle pickup');
        assert(s.player.sparkleTimer > 6.5 && s.player.sparkleTimer <= 7.5, `sparkleTimer=${s.player.sparkleTimer}`);
        const hud = await g.page.evaluate(() => ({
          hidden: document.getElementById('sparkle-wrap').hidden,
          width: document.getElementById('sparkle-fill').style.width,
        }));
        assertEqual(hud.hidden, false, '#sparkle-wrap visible');
        assert(parseFloat(hud.width) > 80, `Expected #sparkle-fill width > 80%, got "${hud.width}"`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F09-03',
    tier: 1,
    feature: 'F9',
    bucket: 'A',
    timeoutMs: 220000,
    name: 'Gemini Sparkle overdrive smashes obstacles/vehicles cleanly (+75 / +150) without Wipeout',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { smashedAny } = await runWithRestartBudget(
          g.page,
          {
            budgets: [105000, 105000],
            label: 'T1-F09-03 sparkle smash',
            forceReload: true,
          },
          async () => {
            const sBefore = await acquireSparkle(g.page, {
              minTimer: 5.8,
              label: 'T1-F09-03 sparkle smash',
            });
            assertEqual(sBefore.state, 'playing', 'still playing at sparkle start');
            assert(sBefore.player.sparkleTimer > 4.5, 'Need active sparkleTimer for smash test');

            let smashed = false;
            const deadline = Date.now() + 7000;
            while (Date.now() < deadline) {
              const s = await g.getState();
              assertEqual(s.state, 'playing', 'must not die during sparkle overdrive');
              if (s.obstacles.some((o) => o.smashed)) {
                smashed = true;
                break;
              }
              if (s.player.sparkleTimer <= 0.1) break;
              if (s.player.onRoof) {
                // Drop off roof so ground smash triggers instead of roof surfing over vehicles
                await g.page.keyboard.press(s.player.lane >= 0 ? 'ArrowLeft' : 'ArrowRight');
                await sleep(140);
                continue;
              }
              const target = s.obstacles
                .filter((o) => !o.smashed && o.zEnd > 1.0)
                .sort((a, b) => a.zStart - b.zStart)[0];
              if (target && target.lane !== s.player.lane && s.player.sparkleTimer > 0.5) {
                await g.page.keyboard.press(target.lane < s.player.lane ? 'ArrowLeft' : 'ArrowRight');
                await sleep(140);
              }
              await sleep(25);
            }
            if (smashed) return { ok: true, result: { smashedAny: true } };
            return { ok: false, reason: 'no obstacle smashed during sparkle overdrive window' };
          },
        );
        assert(smashedAny, 'Expected to smash at least 1 obstacle/vehicle during overdrive');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F09-04',
    tier: 1,
    feature: 'F9',
    bucket: 'A',
    timeoutMs: 220000,
    name: 'Gemini Sparkle overdrive pulls adjacent-lane coins magnetically into player',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const { endState, observedPull, startCoins } = await runWithRestartBudget(
          g.page,
          {
            budgets: [105000, 105000],
            label: 'T1-F09-04 sparkle magnet',
            forceReload: true,
          },
          async () => {
            const startState = await acquireSparkle(g.page, {
              minTimer: 5.0,
              label: 'T1-F09-04 sparkle magnet',
            });
            assertEqual(startState.state, 'playing', 'still playing after sparkle pickup');
            assert(startState.player.sparkleTimer > 3.5, `Active sparkle required, got ${startState.player.sparkleTimer}`);
            let sawPull = false;
            let lastSteerAt = 0;
            const initialCoins = startState.coins;
            const end = await driveRun(g.page, {
              maxMs: 7500,
              pollMs: 20,
              onSample: async (s) => {
                for (const c of s.collectibles) {
                  if (c.type === 'coin' && !c.collected && c.z < 14 && c.z > -1 && Math.abs(c.x - c.lane * 2.65) > 0.15) {
                    sawPull = true;
                  }
                }
                if (!sawPull && s.state === 'playing' && s.player.sparkleTimer > 0.5 && Date.now() - lastSteerAt > 180) {
                  const nearCoins = s.collectibles.filter((c) => c.type === 'coin' && !c.collected && c.z > 2 && c.z < 20);
                  const hasSameLane = nearCoins.some((c) => c.lane === s.player.lane);
                  const hasAdjLane = nearCoins.some((c) => Math.abs(c.lane - s.player.lane) === 1);
                  if (hasSameLane && !hasAdjLane) {
                    await g.page.keyboard.press(s.player.lane === 1 ? 'ArrowLeft' : 'ArrowRight');
                    lastSteerAt = Date.now();
                  }
                }
              },
              until: (s) => (sawPull && s.coins > initialCoins) || s.player.sparkleTimer <= 0.1,
            });
            assertEqual(end.state, 'playing', 'remained playing during magnetic coin pull');
            if (sawPull && end.coins > initialCoins) {
              return { ok: true, result: { endState: end, observedPull: sawPull, startCoins: initialCoins } };
            }
            return { ok: false, reason: `observedPull=${sawPull}, coins=${initialCoins}->${end?.coins}` };
          },
        );
        assertEqual(endState.state, 'playing', 'remained playing during magnetic coin pull');
        assert(observedPull, 'Expected magnetic lateral pull (|x - lane*2.65| > 0.15) on off-lane coin during overdrive');
        assert(endState.coins > startCoins, `Expected pulled coin collection (start=${startCoins}, end=${endState.coins})`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F09-05',
    tier: 1,
    feature: 'F9',
    bucket: 'A',
    timeoutMs: 50000,
    name: 'Stumble recovery window decays cleanly back to 0 when no second bump occurs',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        const recovered = await runWithRestartBudget(
          g.page,
          {
            budgets: [24000, 24000],
            label: 'T1-F09-05 stumble recovery',
            shouldRetryError: (err) => /Could not find an adjacent vehicle/.test(err.message),
          },
          async () => {
            const { after } = await triggerSideBump(g.page, { maxMs: 18000 });
            assert(after.player.stumbleTimer > 0.4, 'stumbleTimer active after 1st bump');
            const rec = await driveRun(g.page, {
              maxMs: 6000,
              pollMs: 25,
              until: (s) => s.player.stumbleTimer === 0 && s.state === 'playing',
            });
            if (rec.state === 'playing' && rec.player.stumbleTimer === 0) {
              return { ok: true, result: rec };
            }
            return { ok: false, reason: `state=${rec?.state}, stumbleTimer=${rec?.player?.stumbleTimer}` };
          },
        );
        assertEqual(recovered.player.stumbleTimer, 0, 'stumbleTimer recovered to 0');
        assertEqual(recovered.state, 'playing', 'still playing after recovery');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F10: 6 Campus Themes, Picker & Transitions (T1-F10-01 .. T1-F10-05)
  // =========================================================================
  {
    id: 'T1-F10-01',
    tier: 1,
    feature: 'F10',
    bucket: 'A',
    name: 'Campus picker renders all 6 campus pills and Auto Tour with auto active initially',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        const pills = await g.page.evaluate(() => {
          return Array.from(document.querySelectorAll('#campus-pills button')).map((b) => ({
            campus: b.getAttribute('data-campus'),
            active: b.classList.contains('active'),
            text: b.textContent.trim(),
          }));
        });
        for (const c of CAMPUSES) {
          const found = pills.find((p) => p.campus === c.id);
          assert(found, `Missing campus pill [data-campus="${c.id}"]`);
          assertEqual(found.active, false, `${c.id} inactive while Auto Tour active`);
        }
        const autoPill = pills.find((p) => p.campus === 'auto' || /auto/i.test(p.text));
        assert(autoPill, 'Missing Auto Tour toggle pill in #campus-pills');
        assertEqual(autoPill.active, true, 'auto initially active when !lockedCampus');
        const s = await g.getState();
        assertEqual(s.lockedCampus, false, 'lockedCampus false at boot');
        assertEqual(s.campusId, 'mv', 'initial campusId mv');
        assertEqual((await g.page.textContent('#hud-campus')).trim(), 'Mountain View · GBuses', 'initial #hud-campus');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F10-02',
    tier: 1,
    feature: 'F10',
    bucket: 'A',
    name: 'Clicking each of the 6 campus pills updates telemetry, HUD pill, and lockedCampus',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        for (const c of [CAMPUSES[1], CAMPUSES[2], CAMPUSES[3], CAMPUSES[4], CAMPUSES[5], CAMPUSES[0]]) {
          await clickCampusPill(g.page, c.id);
          const s = await waitForState(g.page, (st) => st.campusId === c.id, {
            timeoutMs: 1000,
            label: `campusId === ${c.id}`,
          });
          assertEqual(s.campusIdx, c.idx, `campusIdx for ${c.id}`);
          assertEqual(s.campusName, c.name, `campusName for ${c.id}`);
          assertEqual(s.lockedCampus, true, `lockedCampus for ${c.id}`);
          const hudText = (await g.page.textContent('#hud-campus')).trim();
          assertEqual(hudText, `${c.name} · ${c.vehicle}`, `#hud-campus for ${c.id}`);
          const active = await g.page.evaluate((id) =>
            document.querySelector(`#campus-pills [data-campus="${id}"]`)?.classList.contains('active'),
          c.id);
          assertEqual(active, true, `.active class on ${c.id}`);
        }
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F10-03',
    tier: 1,
    feature: 'F10',
    bucket: 'A',
    name: 'Manual campus switch mid-run drives smooth campusTransition without frame stalls',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await sleep(200);
        await clickCampusPill(g.page, 'tokyo');
        const transitions = [];
        const deadline = Date.now() + 2600;
        while (Date.now() < deadline) {
          const s = await g.getState();
          assertInRange(s.campusTransition, 0, 1, 'campusTransition');
          assert(s.lastDt <= 0.05, `Frame stall during campus transition: lastDt=${s.lastDt}`);
          transitions.push(s.campusTransition);
          if (s.campusTransition >= 0.99 && transitions.length > 5) break;
          await sleep(60);
        }
        assert(transitions[transitions.length - 1] >= 0.9, 'campusTransition progresses toward 1.0');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F10-04',
    tier: 1,
    feature: 'F10',
    bucket: 'A',
    name: 'Clicking Auto Tour unlocks manual campus selection (lockedCampus === false)',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await clickCampusPill(g.page, 'london');
        let s = await g.getState();
        assertEqual(s.lockedCampus, true, 'lockedCampus after manual pick');
        await clickCampusPill(g.page, 'auto');
        s = await waitForState(g.page, (st) => st.lockedCampus === false, { label: 'auto tour unlock' });
        assertEqual(s.lockedCampus, false, 'lockedCampus after auto');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F10-05',
    tier: 1,
    feature: 'F10',
    bucket: 'B',
    timeoutMs: 185000,
    name: 'Auto Tour advances automatically from Mountain View to London at 450m',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        let checkedPre440 = false;
        let end = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt === 0) {
            await startGame(g.page, 'button');
          } else {
            await g.page.click('#btn-play');
            await waitForState(
              g.page,
              (s) => s.state === 'playing' && s.distance < 10 && s.tickCount > 0,
              { timeoutMs: 3000, label: 'retry T1-F10-05 restart' },
            );
          }
          checkedPre440 = false;
          end = await driveRun(g.page, {
            maxMs: 85000,
            pollMs: 25,
            onSample(s) {
              if (s.state === 'playing' && s.distance < 440) {
                checkedPre440 = true;
                assertEqual(s.campusIdx, 0, `Auto Tour must stay on mv (0) before 450m (dist=${s.distance.toFixed(1)})`);
              }
            },
            until: (s) => s.distance >= 455 && s.campusIdx >= 1,
          });
          if (end.state === 'playing' && end.distance >= 450 && end.campusIdx >= 1) {
            break;
          }
          if (end.state !== 'gameover' || end.distance >= 450) {
            break;
          }
        }
        assert(checkedPre440, 'Expected to sample Auto Tour staying on mv before 440m');
        assertEqual(end.state, 'playing', 'remained playing reaching London at 450m');
        assert(end.distance >= 450, `Expected distance >= 450m, got ${end.distance}`);
        assertEqual(end.campusIdx, 1, 'Auto Tour campusIdx at 450m');
        assertEqual(end.campusId, 'london', 'Auto Tour campusId at 450m');
        const hud = (await g.page.textContent('#hud-campus')).trim();
        assertEqual(hud, 'London · Double-Deckers', '#hud-campus after 450m');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F11: Web Audio SFX, Bell & Mute Controls (T1-F11-01 .. T1-F11-05)
  // =========================================================================
  {
    id: 'T1-F11-01',
    tier: 1,
    feature: 'F11',
    bucket: 'A',
    name: 'User gesture initializes Web Audio SFX across lane, jump, and coins without errors',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, {
        initScript: () => {
          window.__PW_AC_COUNT = 0;
          window.__PW_OSC_COUNT = 0;
          const Orig = window.AudioContext || window.webkitAudioContext;
          if (Orig) {
            const Wrapped = function (...args) {
              window.__PW_AC_COUNT++;
              const inst = new Orig(...args);
              const origCreateOsc = inst.createOscillator.bind(inst);
              inst.createOscillator = () => {
                window.__PW_OSC_COUNT++;
                return origCreateOsc();
              };
              return inst;
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
        await sleep(120);
        await g.page.keyboard.press('Space');
        await sleep(250);
        await g.page.keyboard.press('ArrowRight');
        await sleep(400);
        const audio = await g.page.evaluate(() => ({
          acCount: window.__PW_AC_COUNT,
          oscCount: window.__PW_OSC_COUNT,
        }));
        assertEqual(audio.acCount, 1, 'singleton AudioContext initialized');
        assert(audio.oscCount >= 3, `Expected >= 3 Web Audio oscillators created, got ${audio.oscCount}`);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F11-02',
    tier: 1,
    feature: 'F11',
    bucket: 'A',
    name: 'Clicking #btn-mute toggles Sound <-> Muted cleanly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔊 Sound', 'initial mute text');
        await g.page.click('#btn-mute');
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔇 Muted', 'muted text');
        await g.page.click('#btn-mute');
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔊 Sound', 'unmuted text');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F11-03',
    tier: 1,
    feature: 'F11',
    bucket: 'A',
    name: 'Pressing KeyM toggles mute mid-run without pausing or shifting lanes',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('KeyM');
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔇 Muted', 'muted via KeyM');
        const s1 = await g.getState();
        assertEqual(s1.state, 'playing', 'still playing');
        assertEqual(s1.player.lane, 0, 'lane unchanged');
        await g.page.keyboard.press('KeyM');
        assertEqual((await g.page.textContent('#btn-mute')).trim(), '🔊 Sound', 'unmuted via KeyM');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F11-04',
    tier: 1,
    feature: 'F11',
    bucket: 'A',
    name: 'Pressing KeyB rings GBike bell without altering lane, score, or throwing errors',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('KeyB');
        await sleep(100);
        const s = await g.getState();
        assertEqual(s.state, 'playing', 'still playing after bell');
        assertEqual(s.player.lane, 0, 'lane unaffected by bell');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F11-05',
    tier: 1,
    feature: 'F11',
    bucket: 'A',
    name: 'Pressing KeyB while muted and unmuted executes with zero runtime errors',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl);
      try {
        await startGame(g.page, 'button');
        await g.page.keyboard.press('KeyM');
        await g.page.keyboard.press('KeyB');
        await sleep(80);
        await g.page.keyboard.press('KeyM');
        await g.page.keyboard.press('KeyB');
        await sleep(80);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },

  // =========================================================================
  // F12: Responsive Viewport Fit & Visual Presentation (T1-F12-01 .. T1-F12-05)
  // =========================================================================
  {
    id: 'T1-F12-01',
    tier: 1,
    feature: 'F12',
    bucket: 'A',
    name: '1280x800 layout fits above the fold with non-blank canvas and unclipped HUD/overlay',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 1280, height: 800 } });
      try {
        await assertViewportFit(g.page, { width: 1280, height: 800, checkVerticalFit: true });
        await assertCanvasNonBlank(g.page);
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F12-02',
    tier: 1,
    feature: 'F12',
    bucket: 'A',
    name: '960x600 layout fits cleanly with exact DPR canvas dimensions',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 960, height: 600 } });
      try {
        await assertViewportFit(g.page, { width: 960, height: 600, checkVerticalFit: true });
        const s = await g.getState();
        assertEqual(s.viewport.canvasW, Math.round(s.viewport.cssW * s.viewport.dpr), 'canvasW');
        assertEqual(s.viewport.canvasH, Math.round(s.viewport.cssH * s.viewport.dpr), 'canvasH');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F12-03',
    tier: 1,
    feature: 'F12',
    bucket: 'A',
    timeoutMs: 28000,
    name: '720x600 layout shows unclipped start, playing HUD, and Game Over overlay card',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, { viewport: { width: 720, height: 600 } });
      try {
        await assertViewportFit(g.page, { width: 720, height: 600 });
        await startGame(g.page, 'button');
        await assertViewportFit(g.page, { width: 720, height: 600, checkOverlay: false });
        await triggerHeadOnCrash(g.page);
        await assertViewportFit(g.page, { width: 720, height: 600 });
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F12-04',
    tier: 1,
    feature: 'F12',
    bucket: 'A',
    name: '390x844 mobile portrait layout fits HUD, overlay, and wrapped campus pills cleanly',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      try {
        await assertViewportFit(g.page, { width: 390, height: 844 });
        await startGame(g.page, 'button');
        await assertViewportFit(g.page, { width: 390, height: 844, checkOverlay: false });
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
  {
    id: 'T1-F12-05',
    tier: 1,
    feature: 'F12',
    bucket: 'A',
    name: 'deviceScaleFactor=2 scales canvas buffer 2x while keeping player.screenRect in CSS px',
    async fn({ browser, baseUrl }) {
      const g = await openGame(browser, baseUrl, {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      });
      try {
        const s = await startGame(g.page, 'button');
        assertEqual(s.viewport.dpr, 2, 'viewport.dpr');
        assertEqual(s.viewport.canvasW, Math.round(s.viewport.cssW * 2), '2x canvasW');
        assertEqual(s.viewport.canvasH, Math.round(s.viewport.cssH * 2), '2x canvasH');
        assert(s.player.screenRect && s.player.screenRect.w > 0, 'player.screenRect present');
        assertInRange(s.player.screenRect.x, 0, s.viewport.cssW, 'player.screenRect.x');
        assertInRange(s.player.screenRect.y, 0, s.viewport.cssH, 'player.screenRect.y');
        g.tracker.assertNoErrors();
      } finally {
        await g.close();
      }
    },
  },
];
