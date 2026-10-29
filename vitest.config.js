import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['sdk/**/*.test.js', 'cli/**/*.test.js'],
    setupFiles: ['./vitest.setup.js'],
  },
});
