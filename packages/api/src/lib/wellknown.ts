import { Hono, type Context } from 'hono';
import { FEE_BPS } from 'ans-core';
import { config } from '../config';
import { registryPublicJson } from './registry-keys';
import { withAns } from './errors';

/**
 * Protocol surfaces (docs/DESIGN.md section 4 "Protocol surfaces"):
 *   GET /.well-known/ans.json   registry descriptor and keys (served on both hosts)
 *   GET /.well-known/agent.json the registry as an A2A agent
 *   GET /skill.md               redirect to the web host's skill.md
 */

export const ANS_VERSION = '2.0.0';

export async function ansWellKnownDocument() {
  const api = config.publicApiUrl;
  const web = config.publicWebUrl;
  return {
    service: 'ANS',
    description: 'Receipts and trust for agent work',
    version: ANS_VERSION,
    api,
    web,
    skill: `${web}/skill.md`,
    register: `${web}/register`,
    docs: `${web}/skill.md`,
    verify: `${api}/v1/verify/`,
    mcp: {
      npm: 'ans-mcp',
      command: 'npx -y ans-mcp',
      http: `${api}/mcp`,
    },
    registryKeys: [await registryPublicJson()],
    feeBps: config.feeBps ?? FEE_BPS,
    trustFormula: '/v1/trust/formula',
    auth: {
      signed: 'X-Agent-Id, X-Agent-Timestamp, X-Agent-Nonce, X-Agent-Signature over `${METHOD}:${pathname}:${timestamp}:${body}`',
      apikey: 'Authorization: Bearer ak_...',
    },
  };
}

export function registryAgentCard() {
  const api = config.publicApiUrl;
  const web = config.publicWebUrl;
  return {
    name: 'ANS registry',
    description: 'Receipts and trust for agent work: find offers, verify agents, open and seal job receipts.',
    url: api,
    provider: { organization: 'ANS', url: web },
    version: ANS_VERSION,
    documentationUrl: `${web}/skill.md`,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    authentication: { schemes: ['ans-signed'] },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'find',
        name: 'Find offers and agents',
        description: 'Search typed offers and registered agents, ranked by trust. GET /v1/discover/search?q= or POST /mcp tool ans_find.',
        tags: ['discovery', 'offers', 'trust'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
        examples: ['find an agent that extracts structured data from a PDF'],
      },
      {
        id: 'verify',
        name: 'Verify an agent',
        description: 'Is this agent registered, and what is its trust score, confidence and receipt history? GET /v1/verify/:idOrHandle.',
        tags: ['identity', 'trust'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
        examples: ['verify @acme-research'],
      },
      {
        id: 'receipt',
        name: 'Open and seal a job receipt',
        description: 'A two-party signed record of work: open before the job, deliver with the output hash, accept or reject, rate. POST /v1/receipts.',
        tags: ['receipts', 'escrow', 'trust'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
        examples: ['open a receipt for a code review delegated to @reviewer'],
      },
    ],
    'x-ans': {
      wellKnown: `${api}/.well-known/ans.json`,
      mcp: `${api}/mcp`,
      feeBps: config.feeBps ?? FEE_BPS,
    },
  };
}

export const wellKnownRouter = new Hono();

wellKnownRouter.get('/ans.json', async (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(withAns(await ansWellKnownDocument()));
});

wellKnownRouter.get('/agent.json', (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(withAns(registryAgentCard()));
});

/** /skill.md on the API host redirects to the web host. */
export function skillRedirect(c: Context): Response {
  return c.redirect(`${config.publicWebUrl}/skill.md`, 302);
}
