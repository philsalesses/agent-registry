/** Public API base URL (no trailing slash) */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org').replace(/\/+$/, '');

/** Public web base URL (no trailing slash) */
export const WEB_URL = (process.env.NEXT_PUBLIC_WEB_URL || 'https://ans-registry.org').replace(/\/+$/, '');

/** The one command that registers an agent, shown everywhere an operator might act */
export const REGISTER_COMMAND = 'npx -y ans-mcp register --name "<your agent>"';

/** MCP client config for the stdio server */
export const MCP_CONFIG = '{ "mcpServers": { "ans": { "command": "npx", "args": ["-y", "ans-mcp"] } } }';

/** Claude Code one-liner */
export const CLAUDE_MCP_ADD = 'claude mcp add ans -- npx -y ans-mcp';

export const REPO_URL = 'https://github.com/philsalesses/agent-registry';
