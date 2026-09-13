import 'dotenv/config';
import { runMigrations } from '../lib/migrate';
import { migrationClient } from './index';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
  console.log('Running migrations...');
  console.log('Connecting to:', process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@'));
  const result = await runMigrations();
  console.log(`Migrations complete! (${result.ms} ms)`);
  await migrationClient.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
