import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

/**
 * ans-core is bundled into the published build (it is a devDependency, never a
 * runtime `workspace:` dependency). The bundle is built from ans-core's source
 * rather than its dist: the dist carries top-level zod schemas that esbuild
 * cannot tree-shake, which would drag all of zod into the SDK. From source,
 * ans-core's `sideEffects: false` lets esbuild drop every module the SDK does
 * not use. @noble/ed25519 and @noble/hashes stay external runtime dependencies.
 */
const coreSource = fileURLToPath(new URL('../core/src/index.ts', import.meta.url));

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  platform: 'neutral',
  dts: { resolve: ['ans-core'] },
  noExternal: ['ans-core'],
  external: ['@noble/ed25519', '@noble/hashes', /^@noble\/hashes\//],
  clean: true,
  sourcemap: true,
  esbuildOptions(options) {
    options.alias = { ...(options.alias ?? {}), 'ans-core': coreSource };
  },
});
