import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Development is isolated from production by default. Both API namespaces
// target the local FastAPI process. Explicit overrides support split services.
// These proxy targets are Vite server settings, never browser secrets.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const astroApi = env.ASTRO_API_TARGET || 'http://127.0.0.1:8000';
  const socialApi = env.SOCIAL_API_TARGET || 'http://127.0.0.1:8000';

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': { target: astroApi, changeOrigin: true },
        '/v1': { target: socialApi, changeOrigin: true },
      },
    },
  };
});
