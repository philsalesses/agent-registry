import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/agent_registry';

/**
 * drizzle-orm 0.29 already JSON.stringify()s json/jsonb parameters, and postgres.js
 * would serialize them a second time, storing every jsonb value as a JSON string
 * scalar. Pass json (114) and jsonb (3802) parameters through untouched so they are
 * stored as real objects and arrays. (drizzle 0.30+ does the same internally.)
 * Rows written before this fix are unwrapped by migrations 0007 and 0008.
 */
function fixJsonSerialization(client: ReturnType<typeof postgres>) {
  const passthrough = (value: unknown) => value;
  const serializers = client.options.serializers as unknown as Record<number, (value: unknown) => unknown>;
  serializers[114] = passthrough;
  serializers[3802] = passthrough;
  return client;
}

/**
 * Timestamp columns are `timestamp without time zone` holding UTC wall-clock time:
 * drizzle writes JS Dates as UTC and reads them back as UTC. Pin the session to UTC
 * so database defaults (now()) agree on any host, not only on a UTC server.
 */
const UTC_SESSION = { connection: { TimeZone: 'UTC' } } as const;

// For query purposes
const queryClient = fixJsonSerialization(postgres(connectionString, UTC_SESSION));
export const db = drizzle(queryClient, { schema });

// For migrations
export const migrationClient = fixJsonSerialization(postgres(connectionString, { ...UTC_SESSION, max: 1, onnotice: () => undefined }));
