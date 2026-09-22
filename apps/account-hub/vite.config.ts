import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

const appRoot = import.meta.dirname;
const repositoryRoot = path.resolve(appRoot, '../..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, '');
  const devApiTarget = process.env.DEV_API_TARGET ?? env.DEV_API_TARGET ?? 'http://127.0.0.1:8790';

  return {
    root: appRoot,
    publicDir: path.resolve(repositoryRoot, 'public'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(repositoryRoot, 'src') },
    },
    server: {
      port: Number(process.env.ACCOUNT_HUB_DEV_PORT || 5178),
      strictPort: true,
      // Keep the administrative development UI loopback-only instead of
      // advertising it on the LAN. Member connectors use token-auth endpoints.
      host: '127.0.0.1',
      proxy: {
        '/api/overseas': {
          target: devApiTarget,
          changeOrigin: true,
          timeout: 0,
          proxyTimeout: 0,
        },
      },
    },
    build: {
      outDir: path.resolve(repositoryRoot, 'dist-account-hub'),
      emptyOutDir: true,
    },
  };
});
