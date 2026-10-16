import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5317,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:5319' },
  },
  preview: { host: true, port: 5318, strictPort: true, proxy: { '/api': 'http://127.0.0.1:5319' } },
});
