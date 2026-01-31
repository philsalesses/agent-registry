import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app';

const port = parseInt(process.env.PORT || '3000', 10);
const app = createApp();

console.log(`🚀 AgentRegistry API starting on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`✅ Server running at http://localhost:${port}`);
