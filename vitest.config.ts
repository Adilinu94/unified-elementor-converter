import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@elconv/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@elconv/extractors': resolve(__dirname, 'packages/extractors/src/index.ts'),
      '@elconv/target-v3': resolve(__dirname, 'packages/target-v3/src/index.ts'),
      '@elconv/target-v4': resolve(__dirname, 'packages/target-v4/src/index.ts'),
      '@elconv/mcp': resolve(__dirname, 'packages/mcp/src/index.ts'),
      '@elconv/qa': resolve(__dirname, 'packages/qa/src/index.ts'),
      '@elconv/cli': resolve(__dirname, 'packages/cli/src/index.ts'),
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
