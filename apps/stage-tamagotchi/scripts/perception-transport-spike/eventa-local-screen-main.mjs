import { fileURLToPath } from 'node:url'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, BrowserWindow, ipcMain } from 'electron'

import { eventaLocalScreenSpike } from './eventa-local-screen-contract.mjs'

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: false,
      preload: fileURLToPath(new URL('./eventa-local-screen-preload.mjs', import.meta.url)),
      sandbox: false,
    },
  })
  const { context } = createContext(ipcMain, window)
  defineInvokeHandler(context, eventaLocalScreenSpike, async (incoming, options) => {
    let frameCount = 0
    let acceptedBytes = 0
    const order = []
    for await (const message of incoming) {
      if (message.type === 'cancel-probe') {
        await new Promise((resolveCancel) => {
          const signal = options?.abortController?.signal
          if (signal?.aborted)
            resolveCancel()
          else
            signal?.addEventListener('abort', resolveCancel, { once: true })
        })
        return { cancelObserved: options?.abortController?.signal.aborted === true }
      }
      order.push(message.type)
      if (message.type === 'frame') {
        if (!(message.jpeg instanceof Uint8Array))
          throw new Error('jpeg-not-uint8array')
        frameCount += 1
        acceptedBytes += message.jpeg.byteLength
      }
    }
    return { frameCount, acceptedBytes, order }
  })

  ipcMain.once('airi-perception-eventa-spike:result', (_event, result) => {
    console.info(`PERCEPTION_EVENTA_SPIKE=${JSON.stringify(result)}`)
    app.quit()
  })
  ipcMain.once('airi-perception-eventa-spike:error', (_event, error) => {
    console.error(`PERCEPTION_EVENTA_SPIKE_ERROR=${error}`)
    app.exit(1)
  })
  await window.loadURL('data:text/html,<html><body></body></html>')
  window.webContents.send('airi-perception-eventa-spike:start')
})

setTimeout(() => {
  console.error('Perception Eventa local-screen spike timed out.')
  app.exit(1)
}, 10_000).unref()
