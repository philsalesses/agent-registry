import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The tests run the real API (packages/api) in-process. hono and
 * @hono/node-server come from packages/api instead of this package's own
 * dependencies, so the tiny middleware app and the API server share the API's
 * copies. Each alias points at the package's ESM entry, resolved through its real path.
 */
function esmEntry(name: string, fromPackages: string[]): string {
  for (const pkg of fromPackages) {
    const link = resolve(here, pkg, 'node_modules', name);
    if (!existsSync(link)) continue;
    const dir = realpathSync(link);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
      module?: string;
      main?: string;
    };
    const root = manifest.exports?.['.'];
    const fromExports =
      typeof root === 'string'
        ? root
        : root && typeof root === 'object'
          ? ((root as Record<string, unknown>).import as string | undefined) ?? ((root as Record<string, unknown>).default as string | undefined)
          : undefined;
    const entry = fromExports ?? manifest.module ?? manifest.main ?? 'index.js';
    return join(dir, typeof entry === 'string' ? entry : 'index.js');
  }
  throw new Error(`vitest.config: cannot find ${name} in ${fromPackages.join(', ')}`);
}

export default defineConfig({
  resolve: {
    alias: [
      { find: /^hono$/, replacement: esmEntry('hono', ['.', '../api']) },
      { find: /^@hono\/node-server$/, replacement: esmEntry('@hono/node-server', ['.', '../api']) },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Set before any test file imports the API, whose config and db modules read them at load
    env: {
      DATABASE_URL: process.env.ANS_SDK_TEST_DATABASE_URL ?? 'postgres://philsalesses@localhost:5433/agent_registry_t_sdk',
      ANS_DISABLE_JOBS: '1',
      ANS_QUIET: '1',
    },
    // One database: run files one after another
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
