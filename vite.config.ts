import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { themeMotion } from './build/themeMotion.ts';

const API = `http://127.0.0.1:${process.env.CEA_PORT ?? 5179}`;

export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [themeMotion()] } },
  server: {
    port: 5178,
    host: '127.0.0.1',
    proxy: { '/api': API, '/files': API, '/play': API },
  },
  // Sandpack 单独成块且按需加载，体积是库本身的
  build: { chunkSizeWarningLimit: 700 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
