#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startStaticServer } from './lib/server.mjs';
import { launchBrowser } from './lib/harness.mjs';
import { tier1Tests } from './specs/tier1_features.mjs';
import { tier2Tests } from './specs/tier2_boundaries.mjs';
import { tier3Tests } from './specs/tier3_combinations.mjs';
import { tier4Tests } from './specs/tier4_scenarios.mjs';
import { tier5Tests } from './specs/tier5_adversarial.mjs';

const ALL_TESTS = [...tier1Tests, ...tier2Tests, ...tier3Tests, ...tier4Tests, ...tier5Tests];

function parseArgs(argv) {
  const opts = {
    tier: process.env.TIER || 'all',
    shotDir: process.env.SHOT_DIR || path.join(os.tmpdir(), 'pelican_e2e_shots'),
    jsonReport: null,
    filter: null,
    concurrency: 3,
    timeout: null,
    list: false,
  };

  for (const arg of argv) {
    if (arg === '--list') {
      opts.list = true;
    } else if (arg.startsWith('--tier=')) {
      opts.tier = arg.slice('--tier='.length);
    } else if (arg.startsWith('--shot-dir=')) {
      opts.shotDir = arg.slice('--shot-dir='.length);
    } else if (arg.startsWith('--json-report=')) {
      opts.jsonReport = arg.slice('--json-report='.length);
    } else if (arg.startsWith('--filter=')) {
      opts.filter = arg.slice('--filter='.length);
    } else if (arg.startsWith('--concurrency=')) {
      opts.concurrency = Math.max(1, Number.parseInt(arg.slice('--concurrency='.length), 10) || 3);
    } else if (arg.startsWith('--timeout=')) {
      const val = Number.parseInt(arg.slice('--timeout='.length), 10);
      if (Number.isFinite(val) && val > 0) opts.timeout = val;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node tests/e2e/run.mjs [--tier=1|2|3|4|5|all] [--shot-dir=<dir>] [--json-report=<path>] [--filter=<substr>] [--concurrency=<n>] [--timeout=<ms>] [--list]',
      );
      process.exit(0);
    }
  }
  return opts;
}

function selectTests(opts) {
  const tierNorm = String(opts.tier).toLowerCase();
  const allowedTiers =
    tierNorm === 'all'
      ? new Set([1, 2, 3, 4, 5])
      : new Set(
          tierNorm
            .split(',')
            .map((t) => Number.parseInt(t.trim(), 10))
            .filter((n) => [1, 2, 3, 4, 5].includes(n)),
        );

  const filterLower = opts.filter ? opts.filter.toLowerCase() : null;

  return ALL_TESTS.filter((t) => {
    if (!allowedTiers.has(t.tier)) return false;
    if (filterLower) {
      const hay = `${t.id} ${t.feature} ${t.name}`.toLowerCase();
      if (!hay.includes(filterLower)) return false;
    }
    return true;
  });
}

async function runWithTimeout(test, ctx) {
  const defaultTimeout = test.tier === 4 ? 35000 : 15000;
  const effectiveTimeout = Math.max(ctx.cliTimeout || 0, test.timeoutMs || defaultTimeout);
  const start = Date.now();
  let timerId;

  const openedContexts = new Set();
  const scopedBrowser = new Proxy(ctx.browser, {
    get(target, prop) {
      if (prop === 'newContext') {
        return async (...args) => {
          const bc = await target.newContext(...args);
          openedContexts.add(bc);
          return bc;
        };
      }
      const val = Reflect.get(target, prop, target);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
  const scopedCtx = { ...ctx, browser: scopedBrowser };

  const testPromise = Promise.resolve().then(() => test.fn(scopedCtx));
  testPromise.catch(() => {});

  try {
    await Promise.race([
      testPromise,
      new Promise((_, reject) => {
        timerId = setTimeout(() => {
          reject(new Error(`Test ${test.id} timed out after ${effectiveTimeout}ms`));
        }, effectiveTimeout);
      }),
    ]);
    return {
      id: test.id,
      tier: test.tier,
      feature: test.feature,
      bucket: test.bucket,
      name: test.name,
      status: 'PASS',
      durationMs: Date.now() - start,
      error: null,
    };
  } catch (err) {
    return {
      id: test.id,
      tier: test.tier,
      feature: test.feature,
      bucket: test.bucket,
      name: test.name,
      status: 'FAIL',
      durationMs: Date.now() - start,
      error: err?.message || String(err),
    };
  } finally {
    clearTimeout(timerId);
    await Promise.allSettled([...openedContexts].map((c) => c.close().catch(() => {})));
  }
}

async function runBucket(tests, concurrency, ctxFactory) {
  const results = new Array(tests.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const idx = nextIndex++;
      if (idx >= tests.length) break;
      const test = tests[idx];
      const res = await runWithTimeout(test, ctxFactory());
      results[idx] = res;
      const tag = res.status === 'PASS' ? 'PASS' : 'FAIL';
      const errSuffix = res.error ? ` — ${res.error}` : '';
      console.log(`[T${res.tier}][${res.bucket}] ${tag} ${res.id} (${res.durationMs}ms) ${res.name}${errSuffix}`);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, tests.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const selected = selectTests(opts);

  if (opts.list) {
    const byTier = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const t of selected) {
      byTier[t.tier]++;
      console.log(`${t.id} [T${t.tier}][${t.bucket}] ${t.feature}: ${t.name}`);
    }
    console.log(
      `\nTotal: ${selected.length} tests (T1=${byTier[1]}, T2=${byTier[2]}, T3=${byTier[3]}, T4=${byTier[4]}, T5=${byTier[5]})`,
    );
    process.exit(0);
  }

  if (selected.length === 0) {
    console.error(`No tests matched (--tier=${opts.tier}, --filter=${opts.filter || ''}).`);
    process.exit(1);
  }

  const server = await startStaticServer();
  let browser = null;
  let cleaningUp = false;

  const cleanup = async () => {
    if (cleaningUp) return;
    cleaningUp = true;
    await browser?.close().catch(() => {});
    await server.close().catch(() => {});
  };

  const onSignal = async (sig) => {
    console.error(`\nReceived ${sig}, shutting down E2E runner...`);
    await cleanup();
    process.exit(130);
  };

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const startedAt = Date.now();
  try {
    const launched = await launchBrowser();
    browser = launched.browser;

    console.log(
      `Pelican Surfer E2E Runner — ${selected.length} tests | server=${server.baseUrl} | concurrency(A)=${opts.concurrency} | shotDir=${opts.shotDir}`,
    );

    const bucketA = selected.filter((t) => t.bucket === 'A');
    const bucketB = selected.filter((t) => t.bucket !== 'A');

    const ctxFactory = () => ({
      browser,
      baseUrl: server.baseUrl,
      shotDir: opts.shotDir,
      cliTimeout: opts.timeout,
    });

    const resultsA = bucketA.length ? await runBucket(bucketA, opts.concurrency, ctxFactory) : [];
    const resultsB = bucketB.length ? await runBucket(bucketB, 1, ctxFactory) : [];
    const allResults = [...resultsA, ...resultsB];

    const passed = allResults.filter((r) => r.status === 'PASS').length;
    const failed = allResults.length - passed;
    const totalMs = Date.now() - startedAt;

    const byTier = {};
    for (const tier of [1, 2, 3, 4, 5]) {
      const sub = allResults.filter((r) => r.tier === tier);
      if (sub.length > 0) {
        byTier[`tier${tier}`] = {
          total: sub.length,
          passed: sub.filter((r) => r.status === 'PASS').length,
          failed: sub.filter((r) => r.status === 'FAIL').length,
        };
      }
    }

    console.log('\n=== E2E Summary ===');
    for (const [k, v] of Object.entries(byTier)) {
      console.log(`  ${k}: ${v.passed}/${v.total} passed (${v.failed} failed)`);
    }
    console.log(`  Total: ${passed}/${allResults.length} passed in ${(totalMs / 1000).toFixed(2)}s`);

    if (opts.jsonReport) {
      await fs.mkdir(path.dirname(path.resolve(opts.jsonReport)), { recursive: true });
      await fs.writeFile(
        opts.jsonReport,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            durationMs: totalMs,
            baseUrl: server.baseUrl,
            shotDir: opts.shotDir,
            summary: { total: allResults.length, passed, failed, byTier },
            results: allResults,
          },
          null,
          2,
        ),
        'utf8',
      );
    }

    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
