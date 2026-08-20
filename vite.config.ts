import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/openAIHackathon/' : '/',
  server: {
    host: '127.0.0.1',
    port: 43127,
  },
}));
