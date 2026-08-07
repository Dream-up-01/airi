import type { BaseVAD } from './vad'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createVADStates } from './vad'

class FakeAudioNode {
  connect = vi.fn()
  disconnect = vi.fn()
  port = { onmessage: null as ((event: MessageEvent) => void) | null }
}

class FakeAudioContext {
  state: AudioContextState = 'running'
  destination = new FakeAudioNode()
  audioWorklet = {
    addModule: vi.fn(async () => {}),
  }

  createMediaStreamSource = vi.fn(() => new FakeAudioNode())
  createGain = vi.fn(() => ({
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }))

  async resume() {
    this.state = 'running'
  }

  suspend = vi.fn(async () => {
    this.state = 'suspended'
  })

  close = vi.fn(async () => {
    this.state = 'closed'
  })
}

class FakeAudioWorkletNode extends FakeAudioNode {
  static instances: FakeAudioWorkletNode[] = []

  constructor() {
    super()
    FakeAudioWorkletNode.instances.push(this)
  }
}

function createVADMock() {
  return {
    initialize: vi.fn<BaseVAD['initialize']>(async () => {}),
    processAudio: vi.fn<BaseVAD['processAudio']>(async () => {}),
    reset: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }
}

function latestWorkletNode() {
  const node = FakeAudioWorkletNode.instances.at(-1)
  if (!node)
    throw new Error('Expected a VAD audio worklet node.')

  return node
}

function postWorkletAudio(node: FakeAudioWorkletNode, samples: number[]) {
  node.port.onmessage?.({
    data: { buffer: new Float32Array(samples) },
  } as MessageEvent)
}

describe('createVADStates', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeAudioWorkletNode.instances = []
  })

  it('does not stop the caller-owned microphone stream when disposing VAD nodes', async () => {
    // NOTICE:
    // Vitest node tests do not provide Web Audio constructors.
    // The regression is about our ownership policy around a caller-owned MediaStream, not browser audio.
    // Source/context: packages/stage-ui/src/libs/audio/vad.ts dispose previously called track.stop().
    // Removal condition: replace this with a browser-mode Web Audio lifecycle test.
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const stop = vi.fn()
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream

    const vad = createVADMock()
    const manager = createVADStates(vad, '/vad-worklet.js')
    await manager.initialize()
    await manager.start(stream)
    manager.dispose()

    expect(stop).not.toHaveBeenCalled()
  })

  it('disconnects the previous microphone source before starting a new graph', async () => {
    // NOTICE:
    // Device changes and playback echo gating can rebuild the graph against a new stream.
    // This fake Web Audio graph keeps the regression focused on duplicate source-node wiring.
    // Removal condition: replace this with browser-mode Web Audio graph lifecycle coverage.
    const createdSources: FakeAudioNode[] = []
    class ReconnectAudioContext extends FakeAudioContext {
      createMediaStreamSource = vi.fn(() => {
        const source = new FakeAudioNode()
        createdSources.push(source)
        return source
      })
    }

    vi.stubGlobal('AudioContext', ReconnectAudioContext)
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const stream = {
      getTracks: () => [],
    } as unknown as MediaStream

    const vad = createVADMock()
    const manager = createVADStates(vad, '/vad-worklet.js')
    await manager.initialize()
    await manager.start(stream)
    await manager.start(stream)

    expect(createdSources).toHaveLength(2)
    expect(createdSources[0].disconnect).toHaveBeenCalledTimes(1)
    expect(createdSources[1].disconnect).not.toHaveBeenCalled()
  })

  it('disconnects microphone input while paused and can rebuild it on resume', async () => {
    const createdSources: FakeAudioNode[] = []
    class PausableAudioContext extends FakeAudioContext {
      createMediaStreamSource = vi.fn(() => {
        const source = new FakeAudioNode()
        createdSources.push(source)
        return source
      })
    }

    vi.stubGlobal('AudioContext', PausableAudioContext)
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const stream = { getTracks: () => [] } as unknown as MediaStream

    const vad = createVADMock()
    const manager = createVADStates(vad, '/vad-worklet.js')
    await manager.initialize()
    await manager.start(stream)
    await manager.stop()

    expect(createdSources[0].disconnect).toHaveBeenCalledTimes(1)
    expect(vad.reset).toHaveBeenCalledTimes(1)

    await manager.start(stream)

    expect(createdSources).toHaveLength(2)
    expect(createdSources[1].disconnect).not.toHaveBeenCalled()
  })

  it('ignores a delayed worklet callback after VAD is stopped', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const stream = { getTracks: () => [] } as unknown as MediaStream
    const vad = createVADMock()
    const manager = createVADStates(vad, '/vad-worklet.js')

    await manager.initialize()
    await manager.start(stream)
    const delayedCallback = latestWorkletNode().port.onmessage

    await manager.stop()
    delayedCallback?.({ data: { buffer: new Float32Array([0.1, 0.2]) } } as MessageEvent)
    await Promise.resolve()

    expect(vad.processAudio).not.toHaveBeenCalled()
  })

  it('ignores a delayed worklet callback after VAD is disposed', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const stream = { getTracks: () => [] } as unknown as MediaStream
    const vad = createVADMock()
    const manager = createVADStates(vad, '/vad-worklet.js')

    await manager.initialize()
    await manager.start(stream)
    const delayedCallback = latestWorkletNode().port.onmessage

    manager.dispose()
    delayedCallback?.({ data: { buffer: new Float32Array([0.1, 0.2]) } } as MessageEvent)
    await Promise.resolve()

    expect(vad.processAudio).not.toHaveBeenCalled()
  })

  it('ignores callbacks from a replaced microphone graph while processing the new graph', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const firstStream = { getTracks: () => [] } as unknown as MediaStream
    const secondStream = { getTracks: () => [] } as unknown as MediaStream
    const vad = createVADMock()
    const manager = createVADStates(vad, '/vad-worklet.js')

    await manager.initialize()
    await manager.start(firstStream)
    const delayedCallback = latestWorkletNode().port.onmessage

    await manager.start(secondStream)
    delayedCallback?.({ data: { buffer: new Float32Array([0.1, 0.2]) } } as MessageEvent)
    postWorkletAudio(latestWorkletNode(), [0.3, 0.4])

    await vi.waitFor(() => expect(vad.processAudio).toHaveBeenCalledTimes(1))
    expect(vad.processAudio).toHaveBeenLastCalledWith(
      new Float32Array([0.3, 0.4]),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('aborts active VAD processing on stop so it cannot emit stale behavior', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const stream = { getTracks: () => [] } as unknown as MediaStream
    let resolveProcessing: (() => void) | undefined
    let processingCompleted = false
    const staleEvents: string[] = []
    const vad = createVADMock()
    vad.processAudio.mockImplementation(async (_buffer, options) => {
      await new Promise<void>((resolve) => {
        resolveProcessing = resolve
      })

      if (!options?.signal?.aborted)
        staleEvents.push('speech-start')

      processingCompleted = true
    })
    const manager = createVADStates(vad, '/vad-worklet.js')

    await manager.initialize()
    await manager.start(stream)
    postWorkletAudio(latestWorkletNode(), [0.1, 0.2])
    await vi.waitFor(() => expect(vad.processAudio).toHaveBeenCalledTimes(1))

    await manager.stop()
    resolveProcessing?.()
    await vi.waitFor(() => expect(processingCompleted).toBe(true))

    expect(vad.processAudio.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(staleEvents).toEqual([])
  })

  it('bounds pending worklet audio and keeps the newest chunks', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const stream = { getTracks: () => [] } as unknown as MediaStream
    let resolveFirstChunk: (() => void) | undefined
    const processedSamples: number[] = []
    const vad = createVADMock()
    vad.processAudio.mockImplementation(async (buffer) => {
      processedSamples.push(buffer[0])
      if (processedSamples.length === 1) {
        await new Promise<void>((resolve) => {
          resolveFirstChunk = resolve
        })
      }
    })
    const manager = createVADStates(vad, '/vad-worklet.js', { maxQueuedChunks: 2 })

    await manager.initialize()
    await manager.start(stream)
    const node = latestWorkletNode()
    postWorkletAudio(node, [1])
    await vi.waitFor(() => expect(processedSamples).toEqual([1]))

    postWorkletAudio(node, [2])
    postWorkletAudio(node, [3])
    postWorkletAudio(node, [4])
    resolveFirstChunk?.()

    await vi.waitFor(() => expect(processedSamples).toEqual([1, 3, 4]))
  })
})
