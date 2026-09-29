import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// For `npm run dev`, point these at running owner/cloud containers
// (e.g. `docker compose port`) or leave them and use the nginx build.
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api/owner': { target: process.env.OWNER_URL ?? 'http://localhost:4000', rewrite: (p) => p.replace(/^\/api\/owner/, '') },
      '/api/cloud': { target: process.env.CLOUD_URL ?? 'http://localhost:5000', rewrite: (p) => p.replace(/^\/api\/cloud/, '') },
    },
  },
});
