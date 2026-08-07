import { join, resolve } from 'node:path'
import { cwd } from 'node:process'

import vue from '@vitejs/plugin-vue'

import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@proj-airi/model-driver-mediapipe': resolve(join(import.meta.dirname, '..', '..', 'packages', 'model-driver-mediapipe', 'src', 'index.ts')),
    },
  },
  plugins: [
    vue(),
  ],
  test: {
    env: loadEnv('test', cwd(), ''),
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Browser-mode suites run through `vitest.browser.config.ts`; importing
    // `vitest-browser-vue` in the node forks pool throws at collection time.
    exclude: ['**/node_modules/**', '**/.git/**', 'src/**/*.browser.test.ts'],
  },
})
