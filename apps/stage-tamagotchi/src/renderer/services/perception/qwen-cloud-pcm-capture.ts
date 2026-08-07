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

  async start(stream: MediaStream, signal?: AbortSignal): Promise<void> {
    if (this.#context)
      throw new Error('cloud-pcm-capture-busy')
    if (signal?.aborted)
      throw new Error('cloud-pcm-start-cancelled')
    if (!stream.getAudioTracks().some(track => track.readyState === 'live'))
      throw new Error('cloud-pcm-track-missing')
    const context = new AudioContext({ sampleRate: 16_000, latencyHint: 'interactive' })
    let source: MediaStreamAudioSourceNode | undefined
    let worklet: AudioWorkletNode | undefined
    let silentGain: GainNode | undefined
    this.#context = context
    try {
      await abortable(context.audioWorklet.addModule(workletUrl), signal)
      if (this.#context !== context)
        throw new Error('cloud-pcm-start-cancelled')
      if (context.state === 'suspended')
        await abortable(context.resume(), signal)
      if (this.#context !== context)
        throw new Error('cloud-pcm-start-cancelled')
      source = context.createMediaStreamSource(stream)
      worklet = new AudioWorkletNode(context, 'qwen-cloud-pcm-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      })
      silentGain = context.createGain()
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
      this.#source = source
      this.#worklet = worklet
      this.#silentGain = silentGain
    }
    catch (error) {
      const cancelled = this.#context !== context
      if (!cancelled)
        this.#context = undefined
      await cleanupPcmResources({ context, source, worklet, silentGain })
      if (cancelled)
        throw new Error('cloud-pcm-start-cancelled')
      throw error
    }
  }

  async stop(): Promise<void> {
    const context = this.#context
    const source = this.#source
    const worklet = this.#worklet
    const silentGain = this.#silentGain
    this.#context = undefined
    this.#worklet = undefined
    this.#source = undefined
    this.#silentGain = undefined
    this.#sequence = 0
    await cleanupPcmResources({ context, source, worklet, silentGain })
  }
}

async function cleanupPcmResources(input: {
  context?: AudioContext
  source?: MediaStreamAudioSourceNode
  worklet?: AudioWorkletNode
  silentGain?: GainNode
}): Promise<void> {
  const operations = [
    () => input.worklet?.port.close(),
    () => input.worklet?.disconnect(),
    () => input.source?.disconnect(),
    () => input.silentGain?.disconnect(),
    () => input.context && input.context.state !== 'closed' ? input.context.close() : undefined,
  ].map((cleanup) => {
    try {
      return Promise.resolve(cleanup())
    }
    catch {
      return Promise.resolve()
    }
  })
  await Promise.allSettled(operations)
}

async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal)
    return operation
  const activeSignal = signal
  if (activeSignal.aborted)
    throw new Error('cloud-pcm-start-cancelled')
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => finish(() => reject(new Error('cloud-pcm-start-cancelled')))
    activeSignal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    )

    function finish(done: () => void): void {
      activeSignal.removeEventListener('abort', onAbort)
      done()
    }
  })
}
