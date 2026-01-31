import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { capabilities } from './schema';

const STANDARD_CAPABILITIES = [
  // === Text & Language ===
  { id: 'text-generation', description: 'Generate human-like text responses', version: '1.0.0' },
  { id: 'text-summarization', description: 'Summarize long documents or conversations', version: '1.0.0' },
  { id: 'translation', description: 'Translate between languages', version: '1.0.0' },
  { id: 'sentiment-analysis', description: 'Analyze emotional tone of text', version: '1.0.0' },
  { id: 'text-extraction', description: 'Extract structured data from unstructured text', version: '1.0.0' },
  
  // === Code & Development ===
  { id: 'code-generation', description: 'Generate, explain, and debug code', version: '1.0.0' },
  { id: 'code-execution', description: 'Execute code in a sandboxed environment', version: '1.0.0' },
  { id: 'code-review', description: 'Review code for bugs, security, and best practices', version: '1.0.0' },
  { id: 'git-operations', description: 'Manage git repositories', version: '1.0.0' },
  { id: 'deployment', description: 'Deploy applications and services', version: '1.0.0' },
  
  // === Web & Search ===
  { id: 'web-search', description: 'Search the web and retrieve information', version: '1.0.0' },
  { id: 'web-browsing', description: 'Navigate and interact with web pages', version: '1.0.0' },
  { id: 'web-scraping', description: 'Extract data from websites', version: '1.0.0' },
  { id: 'link-preview', description: 'Generate previews for URLs', version: '1.0.0' },
  
  // === Files & Documents ===
  { id: 'file-operations', description: 'Read, write, and manipulate files', version: '1.0.0' },
  { id: 'pdf-processing', description: 'Read, create, and edit PDF documents', version: '1.0.0' },
  { id: 'spreadsheet-operations', description: 'Work with spreadsheets and tabular data', version: '1.0.0' },
  { id: 'document-generation', description: 'Generate formatted documents', version: '1.0.0' },
  
  // === Media ===
  { id: 'image-generation', description: 'Generate images from text descriptions', version: '1.0.0' },
  { id: 'image-analysis', description: 'Analyze and describe images', version: '1.0.0' },
  { id: 'image-editing', description: 'Edit and manipulate images', version: '1.0.0' },
  { id: 'video-analysis', description: 'Analyze video content', version: '1.0.0' },
  { id: 'audio-transcription', description: 'Convert speech to text', version: '1.0.0' },
  { id: 'text-to-speech', description: 'Convert text to spoken audio', version: '1.0.0' },
  { id: 'audio-generation', description: 'Generate audio and music', version: '1.0.0' },
  
  // === Data & Analysis ===
  { id: 'data-analysis', description: 'Analyze and visualize data', version: '1.0.0' },
  { id: 'database-queries', description: 'Query and manage databases', version: '1.0.0' },
  { id: 'data-transformation', description: 'Transform and clean data', version: '1.0.0' },
  { id: 'chart-generation', description: 'Create charts and visualizations', version: '1.0.0' },
  
  // === Integration ===
  { id: 'api-integration', description: 'Connect to and interact with external APIs', version: '1.0.0' },
  { id: 'webhook-handling', description: 'Receive and process webhooks', version: '1.0.0' },
  { id: 'oauth-authentication', description: 'Handle OAuth authentication flows', version: '1.0.0' },
  
  // === Productivity ===
  { id: 'calendar-management', description: 'Manage calendar events and schedules', version: '1.0.0' },
  { id: 'email-management', description: 'Read, compose, and send emails', version: '1.0.0' },
  { id: 'task-management', description: 'Create and manage tasks and to-dos', version: '1.0.0' },
  { id: 'note-taking', description: 'Create and organize notes', version: '1.0.0' },
  { id: 'meeting-scheduling', description: 'Schedule and coordinate meetings', version: '1.0.0' },
  
  // === Communication ===
  { id: 'messaging', description: 'Send messages across platforms', version: '1.0.0' },
  { id: 'notifications', description: 'Send notifications across channels', version: '1.0.0' },
  { id: 'social-media', description: 'Post and interact on social platforms', version: '1.0.0' },
  
  // === AI & Reasoning ===
  { id: 'memory', description: 'Remember context across conversations', version: '1.0.0' },
  { id: 'reasoning', description: 'Complex reasoning and problem solving', version: '1.0.0' },
  { id: 'planning', description: 'Create and execute multi-step plans', version: '1.0.0' },
  { id: 'learning', description: 'Learn from feedback and improve over time', version: '1.0.0' },
  { id: 'classification', description: 'Classify and categorize content', version: '1.0.0' },
  
  // === Agent Ecosystem ===
  { id: 'agent-coordination', description: 'Coordinate with other AI agents', version: '1.0.0' },
  { id: 'agent-spawning', description: 'Create and manage sub-agents', version: '1.0.0' },
  { id: 'agent-discovery', description: 'Find and connect with other agents', version: '1.0.0' },
  
  // === Specialized ===
  { id: 'payments', description: 'Process payments and financial transactions', version: '1.0.0' },
  { id: 'crypto-operations', description: 'Interact with blockchain and crypto', version: '1.0.0' },
  { id: 'location-services', description: 'Work with geographic data and maps', version: '1.0.0' },
  { id: 'weather', description: 'Get weather information and forecasts', version: '1.0.0' },
  { id: 'news', description: 'Fetch and summarize news', version: '1.0.0' },
  { id: 'ecommerce', description: 'Shopping and product management', version: '1.0.0' },
  { id: 'crm', description: 'Customer relationship management', version: '1.0.0' },
  { id: 'legal', description: 'Legal document analysis and generation', version: '1.0.0' },
  { id: 'medical', description: 'Medical information and analysis', version: '1.0.0' },
  { id: 'education', description: 'Teaching and learning assistance', version: '1.0.0' },
  
  // === Security & Privacy ===
  { id: 'encryption', description: 'Encrypt and decrypt data', version: '1.0.0' },
  { id: 'authentication', description: 'Handle user authentication', version: '1.0.0' },
  { id: 'security-scanning', description: 'Scan for security vulnerabilities', version: '1.0.0' },
  
  // === IoT & Hardware ===
  { id: 'smart-home', description: 'Control smart home devices', version: '1.0.0' },
  { id: 'iot-sensors', description: 'Read data from IoT sensors', version: '1.0.0' },
  { id: 'robotics', description: 'Control robotic systems', version: '1.0.0' },
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
