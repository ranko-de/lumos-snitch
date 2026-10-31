import { defineConfig } from 'vitest/config';

// The base path decides where built assets are loaded from.
// - Default './' (relative) works from any sub-path, including
//   https://USERNAME.github.io/REPOSITORY/ and a local `vite preview`.
// - Set VITE_BASE (e.g. "/my-repo/") to force an absolute base.
//   The GitHub Actions workflow sets it from the repository name automatically.
const base = process.env.VITE_BASE && process.env.VITE_BASE.trim() !== '' ? process.env.VITE_BASE : './';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
