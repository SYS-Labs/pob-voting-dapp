import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
          // Split React and React-DOM into a vendor chunk
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
    // Increase chunk size warning limit to 600KB to reduce noise
    chunkSizeWarningLimit: 600,
  },
});
