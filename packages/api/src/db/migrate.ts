import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { migrationClient } from './index';

async function main() {
  console.log('Running migrations...');
  
  const db = drizzle(migrationClient);
  await migrate(db, { migrationsFolder: './drizzle' });
  
  console.log('Migrations complete!');
  await migrationClient.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
