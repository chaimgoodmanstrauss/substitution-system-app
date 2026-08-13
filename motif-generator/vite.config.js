import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: { port: Number(process.env.PORT) || 5173 },
});
