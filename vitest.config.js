const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false, // One worker at a time — avoids MongoDB race conditions
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});