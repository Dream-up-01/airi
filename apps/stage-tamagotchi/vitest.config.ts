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
    exclude: ['**/node_modules/**', '**/.git/**'],
  },
})
