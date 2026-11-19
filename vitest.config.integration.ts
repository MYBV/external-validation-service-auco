import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.int-spec.ts'],
    // .claude/ holds Git worktrees with their own copies of the test files.
    exclude: [...configDefaults.exclude, '.claude/**', 'dist/**'],
    // Real MongoDB and DynamoDB Local: run files one at a time.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
