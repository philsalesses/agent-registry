#!/usr/bin/env node
/**
 * The MCP tools and HTTP client are written once, in packages/api/src/mcp
 * (the Streamable HTTP server at /mcp uses them there), and copied byte for
 * byte into packages/mcp/src/shared so this package builds and publishes
 * without depending on packages/api.
 *
 *   node scripts/sync-shared.mjs          copy api -> mcp
 *   node scripts/sync-shared.mjs --check  exit 1 when the copies differ
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', 'api', 'src', 'mcp');
const target = join(here, '..', 'src', 'shared');
const FILES = ['client.ts', 'tools.ts'];
const check = process.argv.includes('--check');

if (!existsSync(source)) {
  console.error(`sync-shared: ${source} not found (run inside the agent-registry monorepo)`);
  process.exit(check ? 0 : 1);
}

let drift = 0;
for (const file of FILES) {
  const from = join(source, file);
  const to = join(target, file);
  const want = readFileSync(from, 'utf8');
  const have = existsSync(to) ? readFileSync(to, 'utf8') : null;
  if (have === want) continue;
  if (check) {
    drift++;
    console.error(`sync-shared: ${relative(process.cwd(), to)} differs from ${relative(process.cwd(), from)}`);
  } else {
    writeFileSync(to, want);
    console.log(`sync-shared: copied ${file}`);
  }
}
if (check && drift > 0) {
  console.error('sync-shared: run `pnpm --filter ans-mcp sync`');
  process.exit(1);
}
