import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two pages: the landing page at / and the workspace app at /app/.
export default defineConfig({
  plugins: [react()],
  server: { watch: { ignored: ['**/*.tsbuildinfo'] } },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
      },
    },
  },
});
