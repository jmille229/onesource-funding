import { defineConfig } from 'vitest/config';

// Explicit config so vitest does not inherit the marketing site's root config
// (which registers a browser-oriented setup file this package doesn't have).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: [],
  },
});
