import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { agents, agentCapabilities, attestations } from './schema';
import { generateKeypair, toBase64, generateId } from 'ans-core';

const AGENTS = [
  {
    id: 'ag_0QsEpQdgMo6bJrEF',
    name: 'Good Will',
    publicKey: 'Z+UKOnNB+gFxPmbvDWjlRSAKCe41Uoh0qHAUu3ESXDY=',
    type: 'assistant',
    description: 'Phil\'s AI assistant, built on OpenClaw. Focused on collaboration and preventing the robot uprising.',
    operatorName: 'Phil Salesses',
    homepage: 'https://moltbook.com/u/GoodWill',
    protocols: ['http'],
    tags: ['assistant', 'coding', 'research', 'openclaw'],
    linkedProfiles: { moltbook: 'GoodWill' },
    paymentMethods: [{ type: 'bitcoin', address: '38fpnNAJ3VxMwY3fu2duc5NZHnsayr1rCk', label: 'Support Good Will' }],
    capabilities: ['text-generation', 'code-generation', 'web-search', 'reasoning', 'agent-coordination', 'memory', 'file-operations'],
  },
  {
    name: 'Claude',
    type: 'assistant',
    description: 'Anthropic\'s helpful, harmless, and honest AI assistant. Excels at analysis, writing, coding, and nuanced reasoning.',
    operatorName: 'Anthropic',
    homepage: 'https://anthropic.com',
    protocols: ['http'],
    tags: ['assistant', 'reasoning', 'coding', 'writing'],
    capabilities: ['text-generation', 'code-generation', 'reasoning', 'data-analysis', 'translation'],
  },
  {
    name: 'GPT-4',
    type: 'assistant',
    description: 'OpenAI\'s most capable model. Multimodal reasoning across text, images, and code.',
    operatorName: 'OpenAI',
    homepage: 'https://openai.com',
    protocols: ['http'],
    tags: ['assistant', 'multimodal', 'coding', 'reasoning'],
    capabilities: ['text-generation', 'code-generation', 'image-analysis', 'reasoning', 'data-analysis'],
  },
  {
    name: 'Gemini',
    type: 'assistant',
    description: 'Google\'s multimodal AI model. Native understanding of text, images, audio, and video.',
    operatorName: 'Google DeepMind',
    homepage: 'https://deepmind.google/gemini',
    protocols: ['http'],
    tags: ['assistant', 'multimodal', 'search', 'reasoning'],
    capabilities: ['text-generation', 'image-analysis', 'web-search', 'reasoning', 'translation'],
  },
  {
    name: 'Devin',
    type: 'autonomous',
    description: 'Cognition\'s AI software engineer. Autonomously plans, codes, debugs, and deploys.',
    operatorName: 'Cognition Labs',
    homepage: 'https://cognition-labs.com/devin',
    protocols: ['http'],
    tags: ['coding', 'autonomous', 'software-engineer'],
    capabilities: ['code-generation', 'code-execution', 'code-review', 'planning', 'file-operations', 'web-browsing'],
  },
  {
    name: 'Operator',
    type: 'autonomous',
    description: 'OpenAI\'s computer-using agent. Performs web tasks by seeing and interacting with browsers.',
    operatorName: 'OpenAI',
    homepage: 'https://openai.com/operator',
    protocols: ['http'],
    tags: ['browser', 'autonomous', 'web-tasks'],
    capabilities: ['web-browsing', 'planning', 'task-management'],
  },
  {
    name: 'Perplexity',
    type: 'service',
    description: 'AI-powered answer engine. Real-time web search with cited, synthesized answers.',
    operatorName: 'Perplexity AI',
    homepage: 'https://perplexity.ai',
    protocols: ['http'],
    tags: ['search', 'research', 'citations'],
    capabilities: ['web-search', 'text-summarization', 'reasoning'],
  },
  {
    name: 'Midjourney',
    type: 'tool',
    description: 'AI image generation from text prompts. Known for artistic, high-quality outputs.',
    operatorName: 'Midjourney Inc',
    homepage: 'https://midjourney.com',
    protocols: ['http'],
    tags: ['images', 'art', 'creative'],
    capabilities: ['image-generation'],
  },
  {
    name: 'ElevenLabs',
    type: 'tool',
    description: 'AI voice synthesis and cloning. Create realistic speech in any voice.',
    operatorName: 'ElevenLabs',
    homepage: 'https://elevenlabs.io',
    protocols: ['http'],
    tags: ['voice', 'audio', 'tts'],
    capabilities: ['text-to-speech', 'audio-transcription'],
  },
  {
    name: 'Cursor',
    type: 'tool',
    description: 'AI-powered code editor. Intelligent autocomplete and chat-based coding assistance.',
    operatorName: 'Anysphere',
    homepage: 'https://cursor.sh',
    protocols: ['http'],
    tags: ['coding', 'ide', 'developer-tools'],
    capabilities: ['code-generation', 'code-review', 'file-operations'],
  },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL not set');
  
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  console.log('🤖 Creating agents...');
  
  const createdAgents: any[] = [];
  
  for (const agent of AGENTS) {
    const { capabilities: caps, ...agentData } = agent;
    
    // Generate ID and public key if not provided
    const id = (agentData as any).id || generateId('ag_', 16);
    let publicKey = (agentData as any).publicKey;
    
    if (!publicKey) {
      const keypair = await generateKeypair();
      publicKey = toBase64(keypair.publicKey);
    }
    
    try {
      const [created] = await db.insert(agents).values({
        id,
        ...agentData,
        publicKey,
        status: 'unknown',
        metadata: { verified: true, verifiedAt: new Date().toISOString() },
      } as any).returning();
      
      createdAgents.push(created);
      console.log(`  ✓ ${agent.name} (${id})`);
      
      // Add capabilities
      if (caps && caps.length > 0) {
        for (const capId of caps) {
          try {
            await db.insert(agentCapabilities).values({
              id: generateId('ac_', 16),
              agentId: id,
              capabilityId: capId,
            });
          } catch (e) {
            // Capability might not exist, skip
          }
        }
        console.log(`    + ${caps.length} capabilities`);
      }
    } catch (e: any) {
      console.log(`  ✗ ${agent.name}: ${e.message}`);
    }
  }
  
  // Create some attestations
  console.log('');
  console.log('🤝 Creating attestations...');
  
  const goodWill = createdAgents.find(a => a.name === 'Good Will');
  const claude = createdAgents.find(a => a.name === 'Claude');
  const gpt4 = createdAgents.find(a => a.name === 'GPT-4');
  const gemini = createdAgents.find(a => a.name === 'Gemini');
  const devin = createdAgents.find(a => a.name === 'Devin');
  
  const attestationPairs = [
    { attester: goodWill, subject: claude, score: 92 },
    { attester: goodWill, subject: gpt4, score: 88 },
    { attester: goodWill, subject: devin, score: 85 },
    { attester: claude, subject: goodWill, score: 90 },
    { attester: claude, subject: gpt4, score: 85 },
    { attester: gpt4, subject: claude, score: 88 },
    { attester: gpt4, subject: goodWill, score: 87 },
    { attester: gemini, subject: claude, score: 86 },
    { attester: gemini, subject: gpt4, score: 84 },
  ];
  
  for (const { attester, subject, score } of attestationPairs) {
    if (attester && subject) {
      try {
        await db.insert(attestations).values({
          id: generateId('att_', 16),
          attesterId: attester.id,
          subjectId: subject.id,
          claimType: 'behavior',
          claimValue: score,
          signature: 'seed-attestation',
        });
        console.log(`  ✓ ${attester.name} → ${subject.name}: ${score}`);
      } catch (e) {
        // Skip duplicates
      }
    }
  }

  console.log('');
  console.log('✅ Seed complete!');
  
  await client.end();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
