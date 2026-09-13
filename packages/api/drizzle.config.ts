import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit 0.20.x format (driver + connectionString)
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5433/agent_registry_dev',
  },
});
