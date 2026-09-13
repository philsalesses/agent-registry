import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { migrationClient } from '../db';

/**
 * Apply pending migrations at boot (production deploys have no separate migrate step).
 * A session advisory lock keeps two starting instances from migrating at once.
 */

const MIGRATION_LOCK_KEY = 8_675_309;

export function migrationsFolder(): string {
  const here = typeof __dirname === 'string' ? __dirname : process.cwd();
  const candidates = [
    process.env.ANS_MIGRATIONS_DIR,
    resolve(here, '../drizzle'), // dist/server.js -> packages/api/drizzle
    resolve(here, '../../drizzle'), // src/lib/migrate.ts -> packages/api/drizzle
    resolve(process.cwd(), 'drizzle'),
    resolve(process.cwd(), 'packages/api/drizzle'),
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(resolve(p, 'meta/_journal.json')));
  if (!found) throw new Error(`migrations folder not found (looked in ${candidates.join(', ')})`);
  return found;
}

export async function runMigrations(): Promise<{ folder: string; ms: number }> {
  const started = Date.now();
  const folder = migrationsFolder();
  await migrationClient`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
  try {
    await migrate(drizzle(migrationClient), { migrationsFolder: folder });
  } finally {
    await migrationClient`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
  }
  return { folder, ms: Date.now() - started };
}
