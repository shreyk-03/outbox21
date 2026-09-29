import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// RTL auto-cleanup only runs automatically with globals enabled; wire it up
// explicitly so renders never leak between tests.
afterEach(() => {
  cleanup();
});
