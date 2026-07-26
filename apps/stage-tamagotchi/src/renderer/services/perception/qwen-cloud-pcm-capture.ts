import workletUrl from '../../workers/perception/qwen-cloud-pcm.worklet?worker&url'

export interface QwenCloudPcmChunk {
  sequence: number
  capturedAt: number
  monotonicTimestamp: number
  pcm: Uint8Array
}

export interface QwenCloudPcmCaptureOptions {
  onChunk: (chunk: QwenCloudPcmChunk) => void
  now?: () => number
  monotonicNow?: () => number
}

/** AudioWorklet subscriber over the shared microphone MediaStream. */
export class QwenCloudPcmCapture {
  readonly #onChunk: QwenCloudPcmCaptureOptions['onChunk']
  readonly #now: () => number
  readonly #monotonicNow: () => number
  #context?: AudioContext
  #source?: MediaStreamAudioSourceNode
  #worklet?: AudioWorkletNode
  #silentGain?: GainNode
  #sequence = 0

  constructor(options: QwenCloudPcmCaptureOptions) {
    this.#onChunk = options.onChunk
    this.#now = options.now ?? Date.now
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
  }

  async start(stream: MediaStream): Promise<void> {
    if (this.#context)
      throw new Error('cloud-pcm-capture-busy')
    if (!stream.getAudioTracks().some(track => track.readyState === 'live'))
      throw new Error('cloud-pcm-track-missing')
    const context = new AudioContext({ sampleRate: 16_000, latencyHint: 'interactive' })
    try {
      await context.audioWorklet.addModule(workletUrl)
      if (context.state === 'suspended')
        await context.resume()
      const source = context.createMediaStreamSource(stream)
      const worklet = new AudioWorkletNode(context, 'qwen-cloud-pcm-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      })
      const silentGain = context.createGain()
      silentGain.gain.value = 0
      worklet.port.onmessage = (event: MessageEvent<unknown>) => {
        if (!(event.data instanceof Int16Array) || event.data.byteLength === 0 || event.data.byteLength > 64 * 1024)
          return
        const pcm = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
        this.#sequence += 1
        try {
          this.#onChunk({
            sequence: this.#sequence,
            capturedAt: this.#now(),
            monotonicTimestamp: this.#monotonicNow(),
            pcm,
          })
        }
        finally {
          pcm.fill(0)
        }
      }
      source.connect(worklet)
      worklet.connect(silentGain)
      silentGain.connect(context.destination)
      this.#context = context
      this.#source = source
      this.#worklet = worklet
      this.#silentGain = silentGain
    }
    catch (error) {
      await context.close().catch(() => undefined)
      throw error
    }
  }

  async stop(): Promise<void> {
    const context = this.#context
    this.#context = undefined
    this.#worklet?.port.close()
    this.#worklet?.disconnect()
    this.#source?.disconnect()
    this.#silentGain?.disconnect()
    this.#worklet = undefined
    this.#source = undefined
    this.#silentGain = undefined
    this.#sequence = 0
    if (context && context.state !== 'closed')
      await context.close().catch(() => undefined)
  }
}
