import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    setupFiles: ['src/test-setup.ts'],
    environment: 'node',
    // Exercise desktop startup separately from the Electron TypeScript build.
    include: ['src/**/*.test.ts', 'electron/**/*.test.mjs'],
  },
})
