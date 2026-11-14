
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_URL =
  'https://api-production-a831f79f.up.railway.app';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: API_URL,
        changeOrigin: true,
      },
      '/v1': {
        target: API_URL,
        changeOrigin: true,
      },
    },
  },
});
