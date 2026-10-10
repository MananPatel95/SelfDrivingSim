import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 3000,
  },
  assetsInclude: ['**/*.wasm'],
});
