/**
 * The stdio MCP server: `npx -y ans-mcp`.
 *
 * With a credentials file the session signs every request and receipt
 * canonical with the agent key. Without one it still starts, exposing
 * ans_register plus the read-only tools; ans_register writes the file
 * (mode 600) and switches the running session to signed mode.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AnsHttp, DEFAULT_API_URL } from './shared/client';
import { ANS_MCP_VERSION, ANS_SERVER_INSTRUCTIONS, ToolRefusal, registerAnsTools, type AnsToolsHandle } from './shared/tools';
import { capMicrosOf, defaultCredentialsPath, fileSpendLedger, readCredentials, writeCredentials } from './credentials';

export interface StdioServerOptions {
  env?: NodeJS.ProcessEnv;
  apiUrl?: string;
  credentialsPath?: string;
}

export function userAgent(): string {
  return `ans-mcp/${ANS_MCP_VERSION} node/${process.versions.node}`;
}

function requireRegisteredFrom(env: NodeJS.ProcessEnv, fileValue: boolean | undefined): boolean {
  const flag = (env.ANS_REQUIRE_REGISTERED ?? '').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(flag)) return false;
  if (['1', 'true', 'yes', 'on'].includes(flag)) return true;
  return fileValue !== false;
}

/** Build the server (without connecting it); exported for tests and embedding. */
export async function createStdioServer(opts: StdioServerOptions = {}): Promise<{ server: McpServer; tools: AnsToolsHandle; credentialsPath: string; apiUrl: string }> {
  const env = opts.env ?? process.env;
  const path = opts.credentialsPath ?? defaultCredentialsPath(env);
  const loaded = await readCredentials(path);
  const creds = loaded.status === 'ok' ? loaded.creds : null;
  const apiUrl = (opts.apiUrl || env.ANS_API_URL || creds?.api || DEFAULT_API_URL).replace(/\/+$/, '');

  if (loaded.status === 'invalid') {
    process.stderr.write(`ans-mcp: credentials file ${path} is unreadable (${loaded.error}); starting with read-only tools. Fix or move the file.\n`);
  }

  const identity = creds ? { agentId: creds.agentId, privateKey: creds.privateKey } : null;
  const http = new AnsHttp({ baseUrl: apiUrl, identity, headers: { 'User-Agent': userAgent() } });
  const server = new McpServer({ name: 'ans', title: 'ANS', version: ANS_MCP_VERSION }, { instructions: ANS_SERVER_INSTRUCTIONS });

  const tools = registerAnsTools(server, {
    http,
    identity,
    self: creds ? { agentId: creds.agentId, handle: creds.handle || null } : null,
    requireRegistered: requireRegisteredFrom(env, creds?.requireRegistered),
    localSpendCapMicros: async () => {
      const r = await readCredentials(path);
      return capMicrosOf(r.status === 'ok' ? r.creds : null);
    },
    spend: fileSpendLedger(path),
    transport: 'stdio',
    registerSrc: 'npx',
    credentialsPath: path,
    beforeRegister: async () => {
      const now = await readCredentials(path);
      if (now.status === 'ok') {
        throw new ToolRefusal(`Credentials already exist at ${path} (agent ${now.creds.handle ? `@${now.creds.handle}` : now.creds.agentId}). Restart the MCP server to use them.`);
      }
      if (now.status === 'invalid') {
        throw new ToolRefusal(`The credentials file at ${path} is unreadable (${now.error}). Registering would replace a key, so this session refuses. Ask your operator to fix or move the file.`);
      }
    },
    onRegister: async (c) => {
      await writeCredentials(path, {
        agentId: c.agentId,
        handle: c.handle,
        name: c.name,
        publicKey: c.publicKey,
        privateKey: c.privateKey,
        apiKey: c.apiKey,
        api: c.api,
        registeredAt: c.registeredAt,
        spendCapUsdPerDay: 0,
      });
    },
  });

  return { server, tools, credentialsPath: path, apiUrl };
}

export async function runStdioServer(opts: StdioServerOptions = {}): Promise<void> {
  const { server } = await createStdioServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const shutdown = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.stdin.on('end', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
