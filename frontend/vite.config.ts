import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 8080,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split ethers.js into its own chunk since it's the largest dependency
          'ethers': ['ethers'],
          // Split Svelte into a vendor chunk
          'svelte-vendor': ['svelte', 'svelte/internal'],
        },
      },
    },
    // Increase chunk size warning limit to 600KB to reduce noise
    chunkSizeWarningLimit: 600,
  },
});
