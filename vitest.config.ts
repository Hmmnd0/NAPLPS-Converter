import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom provides DOMParser for the SVG-parsing helpers
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
