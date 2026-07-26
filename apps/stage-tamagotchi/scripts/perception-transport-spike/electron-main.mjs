import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, ipcMain } from 'electron'

const CHANNEL = 'airi-perception-transport-spike'
const startedHeap = process.memoryUsage().heapUsed
let peakHeap = startedHeap
let acceptedBytes = 0
let acceptedMessages = 0
let cancelled = false
let droppedAfterCancel = 0

ipcMain.on(CHANNEL, (event, message) => {
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)

  if (message.type === 'cancel') {
    cancelled = true
    event.sender.send(`${CHANNEL}:ack`, {
      type: 'cancelled',
      sequence: message.sequence,
      receivedAt: performance.timeOrigin + performance.now(),
    })
    return
  }

  if (message.type === 'data') {
    if (cancelled) {
      droppedAfterCancel += 1
    }
    else {
      const bytes = message.bytes
      if (!(bytes instanceof Uint8Array)) {
        event.sender.send(`${CHANNEL}:error`, 'payload-not-uint8array')
        return
      }
      acceptedBytes += bytes.byteLength
      acceptedMessages += 1
    }
    event.sender.send(`${CHANNEL}:ack`, {
      type: cancelled ? 'dropped' : 'accepted',
      sequence: message.sequence,
      receivedAt: performance.timeOrigin + performance.now(),
    })
    return
  }

  if (message.type === 'finish') {
    event.sender.send(`${CHANNEL}:result`, {
      acceptedBytes,
      acceptedMessages,
      droppedAfterCancel,
      mainHeapDeltaBytes: peakHeap - startedHeap,
      transport: 'electron-ipc-structured-clone',
      transferListUsed: false,
    })
  }
})

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  })
  window.webContents.on('console-message', (event) => {
    const message = event.message
    if (!message.startsWith('PERCEPTION_TRANSPORT_SPIKE='))
      return
    console.info(message)
    app.quit()
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer exited before reporting spike results: ${details.reason}`)
    app.exit(1)
  })
  await window.loadFile(fileURLToPath(new URL('./renderer.html', import.meta.url)))
})

setTimeout(() => {
  console.error('Perception transport spike timed out.')
  app.exit(1)
}, 30_000).unref()
