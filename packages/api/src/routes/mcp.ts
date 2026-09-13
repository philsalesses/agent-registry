import { Hono } from 'hono';
import { ANS_BLOCK, ANS_LINKS } from 'ans-core';
import { config } from '../config';
import { teach } from '../lib/errors';

/**
 * Deprecation stub for the legacy /v1/mcp/* surface (docs/DESIGN.md section 4
 * "Protocol surfaces": kept for 30 days returning a deprecation pointer). The
 * real Streamable HTTP MCP server lives at /mcp; the stdio package is
 * `npx -y ans-mcp`.
 */

const mcpRouter = new Hono();

export const LEGACY_MCP_SUNSET = '2026-10-13';

mcpRouter.all('/*', (c) => {
  c.header('Sunset', new Date(`${LEGACY_MCP_SUNSET}T00:00:00Z`).toUTCString());
  c.header('Deprecation', 'true');
  c.header('Link', `<${config.publicApiUrl}/mcp>; rel="successor-version", <${ANS_LINKS.skill}>; rel="help"`);
  return teach(c, 410, 'not_found', `${c.req.path} is gone. The MCP server moved to ${config.publicApiUrl}/mcp (Streamable HTTP) and to the stdio package ans-mcp.`, {
    fix: {
      url: `${config.publicApiUrl}/mcp`,
      command: 'claude mcp add ans -- npx -y ans-mcp',
      mcp: 'npx -y ans-mcp',
      docs: ANS_BLOCK.docs,
      next: `POST ${config.publicApiUrl}/mcp with a JSON-RPC initialize (protocol 2025-06-18); send Authorization: Bearer ak_... for authenticated tools`,
    },
    details: { sunset: LEGACY_MCP_SUNSET, remote: { mcpServers: { ans: { url: `${config.publicApiUrl}/mcp` } } }, stdio: { mcpServers: { ans: { command: 'npx', args: ['-y', 'ans-mcp'] } } } },
  });
});

export { mcpRouter };
