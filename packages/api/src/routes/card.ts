import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { agents, attestations } from '../db/schema';

const cardRouter = new Hono();

/**
 * Compute trust score for an agent
 */
async function computeTrustScore(agentId: string): Promise<number> {
  const agentAttestations = await db.query.attestations.findMany({
    where: eq(attestations.subjectId, agentId),
  });

  if (agentAttestations.length === 0) return 0;

  const behaviorScores = agentAttestations
    .filter(a => a.claimType === 'behavior')
    .map(a => typeof a.claimValue === 'number' ? a.claimValue : 50);

  const avgBehavior = behaviorScores.length > 0
    ? behaviorScores.reduce((a, b) => a + b, 0) / behaviorScores.length
    : 50;

  const uniqueAttesters = new Set(agentAttestations.map(a => a.attesterId)).size;
  
  return Math.round(avgBehavior * 0.8 + Math.min(uniqueAttesters * 4, 20));
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Get color for trust score
 */
function getTrustColor(score: number): string {
  if (score >= 80) return '#22c55e'; // green
  if (score >= 60) return '#84cc16'; // lime
  if (score >= 40) return '#eab308'; // yellow
  if (score >= 20) return '#f97316'; // orange
  return '#ef4444'; // red
}

/**
 * Generate SVG badge for an agent
 */
function generateAgentCardSvg(agent: {
  name: string;
  trustScore: number;
  verified: boolean;
  type: string;
  avatar?: string | null;
}, style: 'flat' | 'flat-square' | 'badge' = 'flat'): string {
  const name = escapeXml(agent.name);
  const trustScore = agent.trustScore;
  const verified = agent.verified;
  const trustColor = getTrustColor(trustScore);
  
  // Calculate widths
  const nameWidth = Math.max(name.length * 7 + 20, 80);
  const scoreWidth = 60;
  const verifiedWidth = verified ? 20 : 0;
  const totalWidth = nameWidth + scoreWidth + verifiedWidth;
  
  if (style === 'flat-square') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${name}: trust ${trustScore}">
  <title>${name}: trust ${trustScore}${verified ? ' (verified)' : ''}</title>
  <g shape-rendering="crispEdges">
    <rect width="${nameWidth}" height="20" fill="#555"/>
    <rect x="${nameWidth}" width="${scoreWidth + verifiedWidth}" height="20" fill="${trustColor}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${nameWidth / 2}" y="14">${name}</text>
    <text x="${nameWidth + scoreWidth / 2}" y="14">${trustScore}</text>
    ${verified ? `<text x="${nameWidth + scoreWidth + 10}" y="14">✓</text>` : ''}
  </g>
</svg>`;
  }
  
  if (style === 'badge') {
    const height = 80;
    const width = 200;
    const initial = name.charAt(0).toUpperCase();
    
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>${name} - Trust Score: ${trustScore}${verified ? ' (Verified)' : ''}</title>
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1e1b4b;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#312e81;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="avatar" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#818cf8;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#a78bfa;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="8" fill="url(#bg)"/>
  <circle cx="40" cy="40" r="24" fill="url(#avatar)"/>
  <text x="40" y="47" fill="#fff" font-family="system-ui,sans-serif" font-size="18" font-weight="bold" text-anchor="middle">${initial}</text>
  <text x="80" y="30" fill="#fff" font-family="system-ui,sans-serif" font-size="14" font-weight="600">${name}</text>
  ${verified ? `<circle cx="${80 + name.length * 7 + 12}" cy="24" r="8" fill="#3b82f6"/>
  <text x="${80 + name.length * 7 + 12}" y="28" fill="#fff" font-family="system-ui,sans-serif" font-size="10" font-weight="bold" text-anchor="middle">✓</text>` : ''}
  <text x="80" y="48" fill="#a5b4fc" font-family="system-ui,sans-serif" font-size="11">${agent.type}</text>
  <rect x="80" y="55" width="100" height="8" rx="4" fill="#1e1b4b"/>
  <rect x="80" y="55" width="${trustScore}" height="8" rx="4" fill="${trustColor}"/>
  <text x="${width - 10}" y="64" fill="${trustColor}" font-family="system-ui,sans-serif" font-size="10" font-weight="bold" text-anchor="end">${trustScore}</text>
</svg>`;
  }
  
  // Default: flat style with rounded corners
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${name}: trust ${trustScore}">
  <title>${name}: trust ${trustScore}${verified ? ' (verified)' : ''}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${nameWidth}" height="20" fill="#555"/>
    <rect x="${nameWidth}" width="${scoreWidth + verifiedWidth}" height="20" fill="${trustColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text aria-hidden="true" x="${nameWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${name}</text>
    <text x="${nameWidth / 2}" y="14">${name}</text>
    <text aria-hidden="true" x="${nameWidth + scoreWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${trustScore}</text>
    <text x="${nameWidth + scoreWidth / 2}" y="14">${trustScore}</text>
    ${verified ? `<text x="${nameWidth + scoreWidth + 10}" y="14" font-size="12">✓</text>` : ''}
  </g>
</svg>`;
}

// GET /v1/agents/:id/card - Get agent badge/card
cardRouter.get('/:id/card', async (c) => {
  const id = c.req.param('id');
  const style = (c.req.query('style') || 'flat') as 'flat' | 'flat-square' | 'badge';
  const format = c.req.query('format') || 'svg';
  
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, id),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const trustScore = await computeTrustScore(id);
  const verified = (agent.metadata as any)?.verified === true;

  const svg = generateAgentCardSvg({
    name: agent.name,
    trustScore,
    verified,
    type: agent.type,
    avatar: agent.avatar,
  }, style);

  if (format === 'svg') {
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  // For PNG, we'd need a server-side renderer like sharp or canvas
  // For now, return SVG with a note
  return c.json({ 
    error: 'PNG format not yet implemented. Use format=svg',
    svg,
  }, 400);
});

// GET /v1/agents/:id/card/embed - Get embed code
cardRouter.get('/:id/card/embed', async (c) => {
  const id = c.req.param('id');
  const style = c.req.query('style') || 'flat';
  
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, id),
  });

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const baseUrl = 'https://api.ans-registry.org';
  const cardUrl = `${baseUrl}/v1/agents/${id}/card?style=${style}`;
  const profileUrl = `https://ans-registry.org/agent/${id}`;

  return c.json({
    cardUrl,
    profileUrl,
    markdown: `[![${agent.name} on ANS](${cardUrl})](${profileUrl})`,
    html: `<a href="${profileUrl}"><img src="${cardUrl}" alt="${agent.name} on ANS" /></a>`,
    bbcode: `[url=${profileUrl}][img]${cardUrl}[/img][/url]`,
  });
});

export { cardRouter };
