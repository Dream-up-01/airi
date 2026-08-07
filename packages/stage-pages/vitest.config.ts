import Vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    {
      name: 'stage-pages-test-route-block',
      enforce: 'pre',
      transform(_code, id) {
        if (id.includes('vue&type=route'))
          return 'export default {}'
      },
    },
    Vue(),
    Info(),
  ],
  test: {
    // NOTICE:
    // Paths here are relative to the working directory, so this config must be run
    // with cwd set to this package. Use the `test:browser` script, or the root
    // `test-pages:run` script which delegates through pnpm --filter.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts', '**/node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          exclude: ['**/node_modules/**'],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
