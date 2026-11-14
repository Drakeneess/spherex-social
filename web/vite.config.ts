import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During local development, requests stay same-origin and Vite proxies them
// to the existing Railway API. Production builds can set VITE_API_BASE_URL.
const railwayApi = 'https://api-production-a831f79f.up.railway.app';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/v1': { target: railwayApi, changeOrigin: true },
      '/api': { target: railwayApi, changeOrigin: true },
    },
  },
});
