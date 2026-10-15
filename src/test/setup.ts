import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';

// Every test starts from empty storage so module level loads see a clean slate.
afterEach(() => {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* storage may be mocked to throw in a test */
  }
});
