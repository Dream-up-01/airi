import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { errorMessageFrom } from '@moeru/std'
import { ipcRenderer } from 'electron'

import { eventaLocalScreenSpike } from './eventa-local-screen-contract.mjs'

const { context } = createContext(ipcRenderer)
const invoke = defineInvoke(context, eventaLocalScreenSpike)
const frame = new Uint8Array(190 * 1024)
frame[0] = 0xFF
frame[1] = 0xD8
frame[frame.length - 2] = 0xFF
frame[frame.length - 1] = 0xD9

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue({ type: 'open', sequence: 0 })
    for (let sequence = 1; sequence <= 4; sequence += 1)
      controller.enqueue({ type: 'frame', sequence, jpeg: frame })
    controller.enqueue({ type: 'complete', sequence: 5 })
    controller.close()
  },
})

ipcRenderer.once('airi-perception-eventa-spike:start', async () => {
  try {
    const startedAt = performance.now()
    const result = await invoke(stream, { signal: AbortSignal.timeout(5_000) })
    const cancellation = new AbortController()
    const cancelStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'cancel-probe', sequence: 0 })
      },
    })
    const pendingCancel = invoke(cancelStream, { signal: cancellation.signal })
    setTimeout(() => cancellation.abort('spike-cancel'), 50)
    let cancellationCode = 'completed-before-cancel'
    try {
      await pendingCancel
    }
    catch (error) {
      cancellationCode = error instanceof Error ? error.name : 'unknown'
    }
    ipcRenderer.send('airi-perception-eventa-spike:result', {
      ...result,
      cancellationCode,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    })
  }
  catch (error) {
    ipcRenderer.send('airi-perception-eventa-spike:error', errorMessageFrom(error) ?? 'unknown')
  }
})
