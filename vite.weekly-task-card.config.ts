import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/weekly-task-card/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist-weekly-task-card',
    emptyOutDir: true,
    rollupOptions: { input: path.resolve('weekly-task-card.html') },
  },
});
