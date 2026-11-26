import fs from 'node:fs/promises';
import path from 'node:path';
import { getState } from './harness.mjs';

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

export function assertEqual(actual, expected, label = 'value') {
  if (actual !== expected) {
    throw new Error(`Expected ${label} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertInRange(value, min, max, label = 'value') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Expected ${label} (${value}) to be finite within [${min}, ${max}]`);
  }
}

export function assertMonotonic(values, { strict = false, label = 'sequence' } = {}) {
  assert(Array.isArray(values) && values.length >= 2, `${label} must have >= 2 samples`);
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) {
      throw new Error(`${label} contains non-finite value at index ${i - 1}/${i}: ${prev}, ${curr}`);
    }
    if (strict ? curr <= prev : curr < prev) {
      throw new Error(
        `${label} is not ${strict ? 'strictly ' : ''}monotonically non-decreasing at index ${i}: prev=${prev}, curr=${curr}`,
      );
    }
  }
}

export function assertRectsNoOverlap(a, b, labelA = 'rectA', labelB = 'rectB', tolerance = 1) {
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (overlapX > tolerance && overlapY > tolerance) {
    throw new Error(
      `${labelA} (${JSON.stringify(a)}) overlaps ${labelB} (${JSON.stringify(b)}) by ${overlapX.toFixed(1)}x${overlapY.toFixed(1)}px`,
    );
  }
}

export function assertRectContained(inner, outer, innerLabel = 'inner', outerLabel = 'outer', tolerance = 1.5) {
  if (
    inner.left < outer.left - tolerance ||
    inner.top < outer.top - tolerance ||
    inner.right > outer.right + tolerance ||
    inner.bottom > outer.bottom + tolerance
  ) {
    throw new Error(
      `${innerLabel} (${Math.round(inner.left)},${Math.round(inner.top)}..${Math.round(inner.right)},${Math.round(inner.bottom)}) is clipped outside ${outerLabel} (${Math.round(outer.left)},${Math.round(outer.top)}..${Math.round(outer.right)},${Math.round(outer.bottom)})`,
    );
  }
}

/**
 * Inspects DOM layout, scroll overflow, HUD containment/non-overlap, overlay containment, and campus pills.
 */
export async function assertViewportFit(page, { width, height, checkVerticalFit = false, checkOverlay = true } = {}) {
  const metrics = await page.evaluate(() => {
    const rectOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };

    const overlay = document.getElementById('overlay');
    const overlayVisible = overlay ? !overlay.classList.contains('hidden') : false;
    const pills = Array.from(document.querySelectorAll('#campus-pills button')).map((btn) => ({
      campus: btn.getAttribute('data-campus') || btn.textContent?.trim() || '',
      rect: rectOf(btn),
    }));

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      stageWrap: rectOf(document.querySelector('.stage-wrap')),
      canvas: rectOf(document.getElementById('game-canvas')),
      hudLeft: rectOf(document.querySelector('.hud-left')),
      hudRight: rectOf(document.querySelector('.hud-right')),
      hudCampus: rectOf(document.getElementById('hud-campus')),
      hudScore: rectOf(document.getElementById('hud-score')?.closest('.stat-card') || document.getElementById('hud-score')),
      hudCoins: rectOf(document.getElementById('hud-coins')?.closest('.stat-card') || document.getElementById('hud-coins')),
      hudBest: rectOf(document.getElementById('hud-best')?.closest('.stat-card') || document.getElementById('hud-best')),
      sparkleWrap: document.getElementById('sparkle-wrap')?.hidden ? null : rectOf(document.getElementById('sparkle-wrap')),
      overlayVisible,
      overlayCard: overlayVisible ? rectOf(document.getElementById('overlay-card')) : null,
      btnPlay: overlayVisible ? rectOf(document.getElementById('btn-play')) : null,
      campusBar: rectOf(document.querySelector('.campus-bar')),
      pills,
    };
  });

  const vpRect = { left: 0, top: 0, right: width, bottom: height, width, height };

  assert(
    metrics.scrollWidth <= width + 1,
    `Horizontal overflow at ${width}x${height}: scrollWidth=${metrics.scrollWidth} > ${width}`,
  );
  if (checkVerticalFit) {
    assert(
      metrics.scrollHeight <= height + 1,
      `Vertical overflow at ${width}x${height}: scrollHeight=${metrics.scrollHeight} > ${height}`,
    );
  }

  assert(metrics.stageWrap && metrics.stageWrap.width > 0 && metrics.stageWrap.height > 0, '.stage-wrap has zero size');
  assert(metrics.canvas && metrics.canvas.width > 0 && metrics.canvas.height > 0, '#game-canvas has zero size');

  assertRectContained(metrics.hudCampus, metrics.stageWrap, '#hud-campus', '.stage-wrap', 2);
  assertRectContained(metrics.hudScore, metrics.stageWrap, '#hud-score card', '.stage-wrap', 2);
  assertRectContained(metrics.hudCoins, metrics.stageWrap, '#hud-coins card', '.stage-wrap', 2);
  assertRectContained(metrics.hudBest, metrics.stageWrap, '#hud-best card', '.stage-wrap', 2);
  if (metrics.hudLeft && metrics.hudRight) {
    assertRectsNoOverlap(metrics.hudLeft, metrics.hudRight, '.hud-left', '.hud-right', 2);
  }
  assertRectsNoOverlap(metrics.hudCampus, metrics.hudScore, '#hud-campus', '#hud-score card', 2);

  if (metrics.sparkleWrap) {
    assertRectContained(metrics.sparkleWrap, metrics.stageWrap, '#sparkle-wrap', '.stage-wrap', 2);
  }

  if (checkOverlay && metrics.overlayVisible) {
    assert(metrics.overlayCard, '#overlay-card missing when overlay is visible');
    assertRectContained(metrics.overlayCard, metrics.stageWrap, '#overlay-card', '.stage-wrap', 2);
    assertRectContained(metrics.overlayCard, vpRect, '#overlay-card', 'viewport', 2);
    if (metrics.btnPlay) {
      assertRectContained(metrics.btnPlay, vpRect, '#btn-play', 'viewport', 2);
    }
  }

  assert(metrics.pills.length >= 6, `Expected >= 6 campus pills, found ${metrics.pills.length}`);
  for (let i = 0; i < metrics.pills.length; i++) {
    const p = metrics.pills[i];
    assert(p.rect && p.rect.width > 10 && p.rect.height > 10, `Campus pill "${p.campus}" has invalid box`);
    assert(
      p.rect.left >= -1 && p.rect.right <= width + 1,
      `Campus pill "${p.campus}" overflows horizontally (${p.rect.left}..${p.rect.right} vs ${width})`,
    );
    for (let j = i + 1; j < metrics.pills.length; j++) {
      assertRectsNoOverlap(p.rect, metrics.pills[j].rect, `pill[${p.campus}]`, `pill[${metrics.pills[j].campus}]`, 1);
    }
  }

  return metrics;
}

/**
 * Samples #game-canvas pixels (via offscreen 2D drawImage so it works for both 2D and WebGL)
 * to assert non-blank rendering and active frame-to-frame animation when playing.
 */
export async function sampleCanvasGrid(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('game-canvas');
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Cannot sample #game-canvas: missing or zero-sized');
    }
    const w = 32;
    const h = 20;
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(canvas, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const colors = new Set();
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      pixels.push(r, g, b, a);
      colors.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
    return { distinctBuckets: colors.size, pixels };
  });
}

export function diffCanvasSamples(a, b) {
  assertEqual(a.pixels.length, b.pixels.length, 'sampled pixel array length');
  let changed = 0;
  const total = a.pixels.length / 4;
  for (let i = 0; i < a.pixels.length; i += 4) {
    const dr = Math.abs(a.pixels[i] - b.pixels[i]);
    const dg = Math.abs(a.pixels[i + 1] - b.pixels[i + 1]);
    const db = Math.abs(a.pixels[i + 2] - b.pixels[i + 2]);
    if (dr + dg + db > 12) {
      changed++;
    }
  }
  return { changed, total, ratio: changed / total };
}

export async function assertCanvasNonBlank(page, minDistinctBuckets = 4) {
  const sample = await sampleCanvasGrid(page);
  assert(
    sample.distinctBuckets >= minDistinctBuckets,
    `Canvas appears blank/flat: only ${sample.distinctBuckets} distinct color buckets (expected >= ${minDistinctBuckets})`,
  );
  return sample;
}

/**
 * Captures a PNG screenshot into shotDir and appends telemetry metadata for Visual Judge manifest.
 */
export async function captureShot(page, shotDir, filename, meta = {}, manifestEntries = null) {
  await fs.mkdir(shotDir, { recursive: true });
  const outPath = path.join(shotDir, filename);
  await page.screenshot({ path: outPath });
  const state = await getState(page);
  const entry = {
    filename,
    path: outPath,
    capturedAt: new Date().toISOString(),
    meta,
    telemetry: {
      state: state.state,
      campusId: state.campusId,
      campusName: state.campusName,
      distance: Number(state.distance.toFixed(2)),
      speed: Number(state.speed.toFixed(2)),
      score: Math.floor(state.score),
      coins: state.coins,
      viewport: state.viewport,
      player: {
        lane: state.player.lane,
        y: Number(state.player.y.toFixed(2)),
        vy: Number(state.player.vy.toFixed(2)),
        duckAmount: Number(state.player.duckAmount.toFixed(2)),
        onRoof: state.player.onRoof,
        sparkleTimer: Number(state.player.sparkleTimer.toFixed(2)),
      },
    },
  };
  if (Array.isArray(manifestEntries)) {
    manifestEntries.push(entry);
  }
  return entry;
}

export async function writeManifest(shotDir, entries) {
  await fs.mkdir(shotDir, { recursive: true });
  const manifestPath = path.join(shotDir, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), count: entries.length, shots: entries }, null, 2),
    'utf8',
  );
  return manifestPath;
}

export async function upsertManifestShot(shotDir, entry) {
  await fs.mkdir(shotDir, { recursive: true });
  const manifestPath = path.join(shotDir, 'manifest.json');
  let shots = [];
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.shots)) {
      shots = parsed.shots;
    }
  } catch {
    // No existing manifest yet
  }
  const idx = shots.findIndex((s) => s.filename === entry.filename);
  if (idx >= 0) {
    shots[idx] = entry;
  } else {
    shots.push(entry);
  }
  return writeManifest(shotDir, shots);
}
