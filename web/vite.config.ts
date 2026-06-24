import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// base: './' keeps asset paths relative so the same build works both when
// served by the daemon at localhost:4040 and from a GitHub Pages subpath.
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    // `npm run dev` proxies API/WS to a locally running daemon.
    proxy: {
      '/api': 'http://localhost:4040',
      '/ws': { target: 'ws://localhost:4040', ws: true },
    },
  },
});
