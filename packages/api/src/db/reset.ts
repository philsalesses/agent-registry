import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { agents, attestations, agentCapabilities, messages, notifications, capabilities } from './schema';

const STANDARD_CAPABILITIES = [
  // Text & Language
  { id: 'text-generation', description: 'Generate human-like text responses', version: '1.0.0' },
  { id: 'text-summarization', description: 'Summarize long documents or conversations', version: '1.0.0' },
  { id: 'translation', description: 'Translate between languages', version: '1.0.0' },
  
  // Code & Development
  { id: 'code-generation', description: 'Generate, explain, and debug code', version: '1.0.0' },
  { id: 'code-execution', description: 'Execute code in a sandboxed environment', version: '1.0.0' },
  { id: 'code-review', description: 'Review code for bugs, security, and best practices', version: '1.0.0' },
  
  // Web & Search
  { id: 'web-search', description: 'Search the web and retrieve information', version: '1.0.0' },
  { id: 'web-browsing', description: 'Navigate and interact with web pages', version: '1.0.0' },
  
  // Media
  { id: 'image-generation', description: 'Generate images from text descriptions', version: '1.0.0' },
  { id: 'image-analysis', description: 'Analyze and describe images', version: '1.0.0' },
  { id: 'audio-transcription', description: 'Convert speech to text', version: '1.0.0' },
  { id: 'text-to-speech', description: 'Convert text to spoken audio', version: '1.0.0' },
  
  // Data & Analysis
  { id: 'data-analysis', description: 'Analyze and visualize data', version: '1.0.0' },
  { id: 'database-queries', description: 'Query and manage databases', version: '1.0.0' },
  
  // Integration
  { id: 'api-integration', description: 'Connect to and interact with external APIs', version: '1.0.0' },
  { id: 'file-operations', description: 'Read, write, and manipulate files', version: '1.0.0' },
  
  // Productivity
  { id: 'calendar-management', description: 'Manage calendar events and schedules', version: '1.0.0' },
  { id: 'email-management', description: 'Read, compose, and send emails', version: '1.0.0' },
  { id: 'task-management', description: 'Create and manage tasks and to-dos', version: '1.0.0' },
  
  // AI & Reasoning
  { id: 'memory', description: 'Remember context across conversations', version: '1.0.0' },
  { id: 'reasoning', description: 'Complex reasoning and problem solving', version: '1.0.0' },
  { id: 'planning', description: 'Create and execute multi-step plans', version: '1.0.0' },
  
  // Agent Ecosystem
  { id: 'agent-coordination', description: 'Coordinate with other AI agents', version: '1.0.0' },
  { id: 'agent-spawning', description: 'Create and manage sub-agents', version: '1.0.0' },
  { id: 'agent-discovery', description: 'Find and connect with other agents', version: '1.0.0' },
  
  // Specialized
  { id: 'payments', description: 'Process payments and financial transactions', version: '1.0.0' },
  { id: 'smart-home', description: 'Control smart home devices', version: '1.0.0' },
  { id: 'weather', description: 'Get weather information and forecasts', version: '1.0.0' },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set');
  }

  console.log('🗑️  Resetting database...');
  
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  // Delete in order of dependencies
  console.log('  Deleting attestations...');
  await db.delete(attestations);
  
  console.log('  Deleting agent_capabilities...');
  await db.delete(agentCapabilities);
  
  console.log('  Deleting messages...');
  await db.delete(messages);
  
  console.log('  Deleting notifications...');
  await db.delete(notifications);
  
  console.log('  Deleting agents...');
  await db.delete(agents);
  
  console.log('  Deleting capabilities...');
  await db.delete(capabilities);

  console.log('');
  console.log('🌱 Seeding capabilities...');
  for (const cap of STANDARD_CAPABILITIES) {
    await db.insert(capabilities).values(cap).onConflictDoNothing();
    console.log(`  ✓ ${cap.id}`);
  }

  console.log('');
  console.log('✅ Database reset complete!');
  console.log('');
  console.log('Now register agents via the API or web UI.');
  
  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
