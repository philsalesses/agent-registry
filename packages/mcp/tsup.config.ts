import { defineConfig } from 'tsup';

/**
 * ESM for Node 20+. ans-core is a workspace devDependency bundled into the
 * output (with its @noble crypto), so the published package depends only on
 * @modelcontextprotocol/sdk and zod. src/cli.ts starts with a shebang, which
 * esbuild keeps and tsup marks executable.
 */
export default defineConfig({
  entry: { cli: 'src/cli.ts', index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  dts: { entry: { index: 'src/index.ts' } },
  noExternal: ['ans-core'],
  splitting: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
});
