import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment on purpose: any window/document access inside src/core throws ReferenceError,
    // which is exactly the guarantee the decoupled logic layer must give.
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
