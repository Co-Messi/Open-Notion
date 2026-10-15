import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Node 25 and later ship their own experimental localStorage global, which shadows jsdom's.
// The flag that turns it off exists from Node 22.4, and older versions reject unknown flags.
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const knowsWebstorageFlag = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 4);

// Unit and integration tests run in jsdom. Browser behaviour that jsdom cannot model
// (layout, contentEditable, IME) is covered by the manual QA checklist instead.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    // The property and fuzz suites run thousands of operations; shared CI runners are several times slower.
    testTimeout: 60000,
    poolOptions: { forks: { execArgv: knowsWebstorageFlag ? ['--no-experimental-webstorage'] : [] } },
  },
});
