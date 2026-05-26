/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/Temist/',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'echarts': ['echarts'],
          'xlsx': ['xlsx'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
