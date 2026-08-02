import { defineConfig } from 'vitest/config';

// This is a Node API package with no stylesheets, but vitest runs on Vite, and
// Vite resolves config by walking UP the directory tree. Left alone it reaches
// the repo root and picks up the marketing site's postcss.config.js / vitest
// setup file — neither of which this package's dependencies can satisfy. CI
// installs only the constructpm workspace, so that failed there while passing
// locally (where the root's node_modules happens to have tailwindcss).
//
// Pinning root and supplying an inline postcss config stops the upward search.
export default defineConfig({
  root: __dirname,
  // An inline postcss config disables Vite's config-file discovery entirely.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: [],
  },
});
