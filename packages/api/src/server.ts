import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { config } from './config';
import { startClock, stopClock } from './lib/clock';
import { recomputeAll } from './lib/trust';
import { reconcile } from './lib/ledger';
import { pruneRateLimits } from './lib/ratelimit';
import { pruneIdempotencyKeys } from './lib/idempotency';
import { getRegistryKeys } from './lib/registry-keys';
import { runMigrations } from './lib/migrate';
import { ensureSecrets } from './lib/secrets';
import { ensureHouseAgent } from './lib/house';

const app = createApp();

// ---------------------------------------------------------------------------
// Nightly jobs: trust recompute (decay), ledger reconciliation, table pruning.
// Runs at 03:15 UTC. Skipped entirely under ANS_DISABLE_JOBS=1 (tests).
// ---------------------------------------------------------------------------

let nightlyTimer: NodeJS.Timeout | null = null;

function msUntilNextRun(hourUtc: number, minuteUtc: number, from: Date = new Date()): number {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hourUtc, minuteUtc, 0, 0));
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - from.getTime();
}

export async function runNightly(): Promise<void> {
  const started = Date.now();
  try {
    const trust = await recomputeAll();
    const ledger = await reconcile();
    const pruned = await pruneRateLimits();
    await pruneIdempotencyKeys();
    console.log(`[nightly] trust: ${trust.agents} agents (${trust.failed.length} failed); ledger: ${ledger.ok ? 'ok' : 'MISMATCH (frozen)'}, ${ledger.checkedAccounts} accounts, chain ${ledger.chain.checked} txns; pruned ${pruned} rate-limit rows; ${Date.now() - started} ms`);
  } catch (err) {
    console.error('[nightly] failed:', err);
  }
}

function scheduleNightly(): void {
  if (config.disableJobs) return;
  const schedule = () => {
    nightlyTimer = setTimeout(async () => {
      await runNightly();
      schedule();
    }, msUntilNextRun(3, 15));
    nightlyTimer.unref();
  };
  schedule();
}

async function main() {
  if (process.env.ANS_SKIP_MIGRATIONS !== '1') {
    const m = await runMigrations();
    console.log(`[migrate] up to date (${m.ms} ms, ${m.folder})`);
  }
  const sources = await ensureSecrets();
  console.log(`[secrets] session secret from ${sources.sessionSecret}; registry keys from ${sources.registryKeys}`);
  const keys = await getRegistryKeys();
  console.log(`ANS API starting on port ${config.port} (${config.nodeEnv}); registry key ${keys.kid}`);
  if (process.env.ANS_SKIP_HOUSE !== '1') {
    try {
      const house = await ensureHouseAgent();
      console.log(`[house] @${house.agent.handle} with ${house.offers.length} offers`);
    } catch (err) {
      console.error('[house] could not ensure the house agent:', err);
    }
  }

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Listening at http://localhost:${info.port}`);
  });

  if (config.disableJobs) {
    console.log('[jobs] ANS_DISABLE_JOBS=1: clock and nightly jobs are off');
  } else {
    startClock();
    scheduleNightly();
  }

  const shutdown = () => {
    stopClock();
    if (nightlyTimer) clearTimeout(nightlyTimer);
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
