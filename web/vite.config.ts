import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs on port 3000 and Vite proxies /api (including the WebSocket) to it.
// changeOrigin stays off so the Host header matches the browser Origin, which the API checks.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', ws: true },
    },
  },
});
