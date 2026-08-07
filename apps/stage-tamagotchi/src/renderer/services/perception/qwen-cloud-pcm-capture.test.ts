import { afterEach, describe, expect, it, vi } from 'vitest'

import { QwenCloudPcmCapture } from './qwen-cloud-pcm-capture'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('qwen cloud PCM capture', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('closes an initializing AudioContext and prevents late startup after stop', async () => {
    const moduleLoaded = deferred()
    const source = { connect: vi.fn(), disconnect: vi.fn() }
    const workletConnect = vi.fn()
    const workletDisconnect = vi.fn()
    const workletPort = { close: vi.fn(), onmessage: null }
    const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } }
    class AudioContextStub {
      static latest?: AudioContextStub
      state: AudioContextState = 'running'
      audioWorklet = { addModule: vi.fn(async () => moduleLoaded.promise) }
      close = vi.fn(async () => {
        this.state = 'closed'
      })

      createMediaStreamSource = vi.fn(() => source)
      createGain = vi.fn(() => gain)
      destination = {}

      constructor() {
        AudioContextStub.latest = this
      }
    }
    class AudioWorkletNodeStub {
      connect = workletConnect
      disconnect = workletDisconnect
      port = workletPort
    }
    vi.stubGlobal('AudioContext', AudioContextStub)
    vi.stubGlobal('AudioWorkletNode', AudioWorkletNodeStub)
    const stream = { getAudioTracks: () => [{ readyState: 'live' }] } as unknown as MediaStream
    const capture = new QwenCloudPcmCapture({ onChunk: vi.fn() })

    const starting = capture.start(stream)
    const context = AudioContextStub.latest!
    await vi.waitFor(() => expect(context.audioWorklet.addModule).toHaveBeenCalledOnce())
    await capture.stop()
    const closedBeforeModuleFinished = context.close.mock.calls.length
    moduleLoaded.resolve()
    const startError = await starting.then(() => undefined, error => error)
    await capture.stop()

    expect(closedBeforeModuleFinished).toBe(1)
    expect(startError).toEqual(new Error('cloud-pcm-start-cancelled'))
    expect(context.createMediaStreamSource).not.toHaveBeenCalled()
    expect(workletConnect).not.toHaveBeenCalled()
  })

  it('continues dismantling every audio node when closing the worklet port throws', async () => {
    const sourceDisconnect = vi.fn()
    const workletDisconnect = vi.fn()
    const gainDisconnect = vi.fn()
    const contextClose = vi.fn(async () => undefined)
    class AudioContextStub {
      state: AudioContextState = 'running'
      audioWorklet = { addModule: vi.fn(async () => undefined) }
      close = contextClose
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: sourceDisconnect }))
      createGain = vi.fn(() => ({ connect: vi.fn(), disconnect: gainDisconnect, gain: { value: 1 } }))
      destination = {}
    }
    class AudioWorkletNodeStub {
      connect = vi.fn()
      disconnect = workletDisconnect
      port = { close: vi.fn(() => { throw new Error('raw private port failure') }), onmessage: null }
    }
    vi.stubGlobal('AudioContext', AudioContextStub)
    vi.stubGlobal('AudioWorkletNode', AudioWorkletNodeStub)
    const stream = { getAudioTracks: () => [{ readyState: 'live' }] } as unknown as MediaStream
    const capture = new QwenCloudPcmCapture({ onChunk: vi.fn() })
    await capture.start(stream)

    await expect(capture.stop()).resolves.toBeUndefined()

    expect(workletDisconnect).toHaveBeenCalledOnce()
    expect(sourceDisconnect).toHaveBeenCalledOnce()
    expect(gainDisconnect).toHaveBeenCalledOnce()
    expect(contextClose).toHaveBeenCalledOnce()
  })

  it('dismantles nodes created before a partial construction failure', async () => {
    const sourceDisconnect = vi.fn()
    const workletDisconnect = vi.fn()
    const portClose = vi.fn()
    const gainDisconnect = vi.fn()
    const contextClose = vi.fn(async () => undefined)
    class AudioContextStub {
      state: AudioContextState = 'running'
      audioWorklet = { addModule: vi.fn(async () => undefined) }
      close = contextClose
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: sourceDisconnect }))
      createGain = vi.fn(() => ({
        connect: vi.fn(() => { throw new Error('cloud-pcm-connect-failed') }),
        disconnect: gainDisconnect,
        gain: { value: 1 },
      }))

      destination = {}
    }
    class AudioWorkletNodeStub {
      connect = vi.fn()
      disconnect = workletDisconnect
      port = { close: portClose, onmessage: null }
    }
    vi.stubGlobal('AudioContext', AudioContextStub)
    vi.stubGlobal('AudioWorkletNode', AudioWorkletNodeStub)
    const stream = { getAudioTracks: () => [{ readyState: 'live' }] } as unknown as MediaStream
    const capture = new QwenCloudPcmCapture({ onChunk: vi.fn() })

    await expect(capture.start(stream)).rejects.toThrow('cloud-pcm-connect-failed')

    expect(portClose).toHaveBeenCalledOnce()
    expect(workletDisconnect).toHaveBeenCalledOnce()
    expect(sourceDisconnect).toHaveBeenCalledOnce()
    expect(gainDisconnect).toHaveBeenCalledOnce()
    expect(contextClose).toHaveBeenCalledOnce()
  })
})
