import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, port: 5317, strictPort: true },
  preview: { host: true, port: 5318, strictPort: true },
});
