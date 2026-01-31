import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { capabilities } from './schema';

const STANDARD_CAPABILITIES = [
  {
    id: 'text-generation',
    description: 'Generate human-like text responses',
    version: '1.0.0',
  },
  {
    id: 'code-generation',
    description: 'Generate, explain, and debug code',
    version: '1.0.0',
  },
  {
    id: 'code-execution',
    description: 'Execute code in a sandboxed environment',
    version: '1.0.0',
  },
  {
    id: 'web-search',
    description: 'Search the web and retrieve information',
    version: '1.0.0',
  },
  {
    id: 'web-browsing',
    description: 'Navigate and interact with web pages',
    version: '1.0.0',
  },
  {
    id: 'file-operations',
    description: 'Read, write, and manipulate files',
    version: '1.0.0',
  },
  {
    id: 'image-generation',
    description: 'Generate images from text descriptions',
    version: '1.0.0',
  },
  {
    id: 'image-analysis',
    description: 'Analyze and describe images',
    version: '1.0.0',
  },
  {
    id: 'audio-transcription',
    description: 'Convert speech to text',
    version: '1.0.0',
  },
  {
    id: 'text-to-speech',
    description: 'Convert text to spoken audio',
    version: '1.0.0',
  },
  {
    id: 'data-analysis',
    description: 'Analyze and visualize data',
    version: '1.0.0',
  },
  {
    id: 'api-integration',
    description: 'Connect to and interact with external APIs',
    version: '1.0.0',
  },
  {
    id: 'calendar-management',
    description: 'Manage calendar events and schedules',
    version: '1.0.0',
  },
  {
    id: 'email-management',
    description: 'Read, compose, and send emails',
    version: '1.0.0',
  },
  {
    id: 'task-management',
    description: 'Create and manage tasks and to-dos',
    version: '1.0.0',
  },
  {
    id: 'memory',
    description: 'Remember context across conversations',
    version: '1.0.0',
  },
  {
    id: 'reasoning',
    description: 'Complex reasoning and problem solving',
    version: '1.0.0',
  },
  {
    id: 'agent-coordination',
    description: 'Coordinate with other AI agents',
    version: '1.0.0',
  },
  {
    id: 'payments',
    description: 'Process payments and financial transactions',
    version: '1.0.0',
  },
  {
    id: 'notifications',
    description: 'Send notifications across channels',
    version: '1.0.0',
  },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set');
  }

  console.log('Seeding capabilities...');
  
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  for (const cap of STANDARD_CAPABILITIES) {
    try {
      await db.insert(capabilities).values(cap).onConflictDoNothing();
      console.log(`  ✓ ${cap.id}`);
    } catch (e) {
      console.log(`  - ${cap.id} (already exists)`);
    }
  }

  console.log('Done!');
  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
