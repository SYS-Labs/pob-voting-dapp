import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  plugins: [
    svelte({
      hot: !process.env.VITEST,
      compilerOptions: {
        // Enable browser mode for testing
        dev: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Force browser mode for Svelte 5
    alias: {
      'svelte': 'svelte',
    },
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
    },
    conditions: ['browser'],
  },
});
