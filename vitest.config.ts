import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // .claude/ holds Git worktrees with their own copies of the test files.
    exclude: [...configDefaults.exclude, '.claude/**', 'dist/**'],
  },
});
