import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Unit and integration tests run in jsdom. Browser behaviour that jsdom cannot model
// (layout, contentEditable, IME) is covered by the manual QA checklist instead.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
  },
});
