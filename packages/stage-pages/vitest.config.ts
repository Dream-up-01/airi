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
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
