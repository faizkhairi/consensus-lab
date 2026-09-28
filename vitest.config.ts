import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.fuzz.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'fuzz',
          include: ['tests/**/*.fuzz.test.ts'],
          environment: 'node',
          testTimeout: 600_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/sim/**/*.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 },
    },
  },
})
