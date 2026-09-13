#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { ANS_MCP_VERSION } from './shared/tools';
import {
  EXIT,
  UsageError,
  describeApiError,
  findCommand,
  keysCreateCommand,
  registerCommand,
  verifyCommand,
  whoamiCommand,
  type Io,
} from './commands';
import { runStdioServer } from './server';

export const HELP = `ans-mcp ${ANS_MCP_VERSION}: ANS receipts and trust for agent work, as an MCP server and CLI.

Usage
  ans-mcp                              run the stdio MCP server
  ans-mcp register --name <name>       register this agent (non-interactive) and write credentials
        [--handle <h>] [--type assistant|autonomous|tool|service] [--description <d>]
        [--referred-by <ag_x>] [--src <s>] [--force] [--json]
  ans-mcp whoami [--json]              id, handle, trust, receipts and balances
  ans-mcp verify <agent> [--json]      is it a registered ANS agent? exit 0 yes, 3 no
  ans-mcp keys create [--scopes read,receipts,invoke,publish] [--cap-usd 5] [--label <l>] [--json]
  ans-mcp find <query> [--tag <t>] [--max-price-usd <n>] [--min-trust <n>] [--json]
  ans-mcp --version | --help

Options for every command
  --api-url <url>        API base (default $ANS_API_URL, then the credentials file, then https://api.ans-registry.org)
  --credentials <path>   credentials file (default $ANS_CREDENTIALS or ~/.config/ans/credentials.json)

Add it to Claude Code:  claude mcp add ans -- npx -y ans-mcp
Skill:                  https://ans-registry.org/skill.md
`;

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  json: { type: 'boolean' },
  force: { type: 'boolean' },
  'api-url': { type: 'string' },
  credentials: { type: 'string' },
  name: { type: 'string' },
  handle: { type: 'string' },
  type: { type: 'string' },
  description: { type: 'string' },
  'referred-by': { type: 'string' },
  src: { type: 'string' },
  scopes: { type: 'string' },
  'cap-usd': { type: 'string' },
  label: { type: 'string' },
  tag: { type: 'string' },
  'max-price-usd': { type: 'string' },
  'min-trust': { type: 'string' },
} as const;

function parse(argv: string[]) {
  return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
}

export async function main(argv: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (err) {
    io.err(`ans-mcp: ${(err as Error).message}\n\n${HELP}`);
    return EXIT.usage;
  }
  const { values: v, positionals } = parsed;
  if (v.version) {
    io.out(ANS_MCP_VERSION);
    return EXIT.ok;
  }
  if (v.help) {
    io.out(HELP);
    return EXIT.ok;
  }
  const global = { apiUrl: v['api-url'], credentials: v.credentials, json: v.json };
  const [command, ...rest] = positionals;

  try {
    switch (command) {
      case undefined:
        if (process.stdin.isTTY) {
          io.err('ans-mcp: MCP server on stdio, waiting for a client. Add it to Claude Code with `claude mcp add ans -- npx -y ans-mcp`; run `ans-mcp --help` for the CLI.');
        }
        await runStdioServer({ env: io.env, apiUrl: v['api-url'], credentialsPath: v.credentials });
        return -1; // keep running
      case 'register':
        return await registerCommand(
          { ...global, name: v.name, handle: v.handle, type: v.type, description: v.description, referredBy: v['referred-by'], src: v.src, force: v.force },
          io,
        );
      case 'whoami':
        return await whoamiCommand(global, io);
      case 'verify':
        return await verifyCommand(rest[0], global, io);
      case 'keys':
        if (rest[0] !== 'create') throw new UsageError('usage: ans-mcp keys create [--scopes read,invoke] [--cap-usd 5] [--label <l>]');
        return await keysCreateCommand({ ...global, scopes: v.scopes, capUsd: v['cap-usd'], label: v.label }, io);
      case 'find':
        return await findCommand(rest.join(' '), { ...global, tag: v.tag, maxPriceUsd: v['max-price-usd'], minTrust: v['min-trust'] }, io);
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(`ans-mcp: ${err.message}`);
      return EXIT.usage;
    }
    io.err(`ans-mcp: ${describeApiError(err)}`);
    return EXIT.error;
  }
}

const io: Io = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  env: process.env,
};

main(process.argv.slice(2), io).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`ans-mcp: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = EXIT.error;
  },
);
