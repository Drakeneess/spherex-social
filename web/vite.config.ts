import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Feature-branch development: run the new asynchronous IRSA API locally.
// Social endpoints remain on Railway, preserving existing accounts and posts.
// Override either target via ASTRO_API_TARGET / SOCIAL_API_TARGET if needed.
// These are Vite development-proxy settings, not browser-exposed variables.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const astroApi = env.ASTRO_API_TARGET || 'http://127.0.0.1:8000';
  const socialApi = env.SOCIAL_API_TARGET ||
    'https://api-production-a831f79f.up.railway.app';

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
