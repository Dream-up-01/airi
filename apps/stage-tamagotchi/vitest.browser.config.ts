import { join, resolve } from 'node:path'

import Vue from '@vitejs/plugin-vue'
import UnoCss from 'unocss/vite'
import Info from 'unplugin-info/vite'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [Info(), Vue(), UnoCss()],
  resolve: {
    alias: {
      '@proj-airi/stage-ui': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src')),
    },
  },
  optimizeDeps: {
    exclude: ['@proj-airi/stage-ui/*'],
  },
  server: {
    fs: { strict: false },
  },
  test: {
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
