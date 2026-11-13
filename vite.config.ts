import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'client',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  test: { root: '.', include: ['tests/**/*.test.ts'] },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/api': 'http://localhost:3000',
    },
  },
});
