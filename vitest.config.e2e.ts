import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // .claude/ holds Git worktrees with their own copies of the test files.
    exclude: [...configDefaults.exclude, '.claude/**', 'dist/**'],
  },
});
