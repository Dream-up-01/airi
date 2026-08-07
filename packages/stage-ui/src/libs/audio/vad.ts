export interface BaseVADConfig {
  // Sample rate of the audio
  sampleRate: number
  // Probabilities above this value are considered speech
  speechThreshold: number
  // Threshold to exit speech state
  exitThreshold: number
  // Minimum silence duration to consider speech ended (ms)
  minSilenceDurationMs: number
  // Padding to add before and after speech (ms)
  speechPadMs: number
  // Minimum duration of speech to consider valid (ms)
  minSpeechDurationMs: number
  // Maximum buffer duration in seconds
  maxBufferDuration: number
  // Size of input buffers from audio source
  newBufferSize: number
}

export interface VADEvents {
  // Emitted when speech is detected
  'speech-start': void
  // Emitted when speech has ended
  'speech-end': void
  // Emitted when a complete speech segment is ready for transcription
  'speech-ready': { buffer: Float32Array, duration: number }
  // Emitted for status updates and errors
  'status': { type: string, message: string }
  // Debug info
  'debug': { message: string, data?: any }
}

export type VADEventCallback<K extends keyof VADEvents> = (event: VADEvents[K]) => void

export interface VADProcessOptions {
  /**
   * Cancels work that belongs to a stopped or replaced microphone graph.
   */
  signal?: AbortSignal
}

export interface BaseVAD {
  initialize: () => Promise<void>
  processAudio: (inputBuffer: Float32Array, options?: VADProcessOptions) => Promise<void>
  on: <K extends keyof VADEvents>(event: K, callback: VADEventCallback<K>) => void
  off: <K extends keyof VADEvents>(event: K, callback: VADEventCallback<K>) => void
}

export interface VADAudioOptions {
  /**
   * Audio context options
   */
  audioContextOptions?: AudioContextOptions

  /**
   * The minimum size of audio chunks to process
   */
  minChunkSize?: number

  /**
   * Maximum number of unprocessed chunks retained for the active microphone graph.
   * Older chunks are discarded first to keep VAD responsive to live input.
   */
  maxQueuedChunks?: number

  /**
   * VAD configuration options
   */
  vadConfig?: Partial<BaseVADConfig>
}

interface ActiveVADRun {
  controller: AbortController
  generation: number
  node: AudioWorkletNode
}

interface PendingAudioChunk {
  buffer: Float32Array
  run: ActiveVADRun
}

export function createVADStates(vad: BaseVAD, vadAudioWorkletUrl: string, options?: VADAudioOptions) {
  let audioWorkletNode: AudioWorkletNode | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let silentGainNode: GainNode | null = null
  let workletInitialized = false
  let lifecycleGeneration = 0
  let activeRun: ActiveVADRun | null = null
  let pendingAudioChunks: PendingAudioChunk[] = []
  let processingPromise: Promise<void> | null = null
  let lifecycleQueue: Promise<void> = Promise.resolve()

  const {
    audioContextOptions = {
      sampleRate: 16000,
      latencyHint: 'interactive',
    },
  } = options || {}

  const minChunkSize = normalizeNonNegativeInteger(options?.minChunkSize, 0)
  const maxQueuedChunks = normalizePositiveInteger(options?.maxQueuedChunks, 4)

  let audioContext = new AudioContext(audioContextOptions)

  function normalizePositiveInteger(value: number | undefined, fallback: number) {
    if (!Number.isFinite(value))
      return fallback

    return Math.max(1, Math.floor(value!))
  }

  function normalizeNonNegativeInteger(value: number | undefined, fallback: number) {
    if (!Number.isFinite(value))
      return fallback

    return Math.max(0, Math.floor(value!))
  }

  function resetVADState() {
    const reset = Reflect.get(vad, 'reset')
    if (typeof reset === 'function')
      Reflect.apply(reset, vad, [])
  }

  function enqueueLifecycle(operation: () => Promise<void>) {
    const next = lifecycleQueue.then(operation, operation)
    lifecycleQueue = next.then(() => undefined, () => undefined)
    return next
  }

  function isActiveRun(run: ActiveVADRun) {
    return (
      activeRun === run
      && audioWorkletNode === run.node
      && lifecycleGeneration === run.generation
      && !run.controller.signal.aborted
    )
  }

  function invalidateActiveRun() {
    lifecycleGeneration += 1
    activeRun?.controller.abort()
    activeRun = null
    pendingAudioChunks = []

    return lifecycleGeneration
  }

  function cloneWorkletBuffer(buffer: unknown) {
    if (buffer instanceof Float32Array)
      return buffer.slice()

    if (buffer instanceof ArrayBuffer)
      return new Float32Array(buffer.slice(0))

    return undefined
  }

  function scheduleAudioProcessing() {
    if (processingPromise)
      return

    processingPromise = processQueuedAudio().finally(() => {
      processingPromise = null
      if (pendingAudioChunks.length > 0)
        scheduleAudioProcessing()
    })
  }

  async function processQueuedAudio() {
    while (pendingAudioChunks.length > 0) {
      const chunk = pendingAudioChunks.shift()
      if (!chunk || !isActiveRun(chunk.run))
        continue

      try {
        await vad.processAudio(chunk.buffer, { signal: chunk.run.controller.signal })
      }
      catch {
        // The worker can fail independently from the microphone graph. Keep raw audio and
        // provider error details out of the console, and continue processing future chunks.
      }
    }
  }

  function enqueueWorkletAudio(run: ActiveVADRun, rawBuffer: unknown) {
    if (!isActiveRun(run))
      return

    const buffer = cloneWorkletBuffer(rawBuffer)
    if (!buffer || buffer.length === 0 || buffer.length < minChunkSize || !isActiveRun(run))
      return

    while (pendingAudioChunks.length >= maxQueuedChunks)
      pendingAudioChunks.shift()

    pendingAudioChunks.push({ buffer, run })
    scheduleAudioProcessing()
  }

  /**
   * Disconnects caller-owned microphone graph nodes before rebuilding the input graph.
   */
  function disconnectInputGraph() {
    if (sourceNode) {
      sourceNode.disconnect()
      sourceNode = null
    }
    if (silentGainNode) {
      silentGainNode.disconnect()
      silentGainNode = null
    }
  }

  function disconnectWorkletNode() {
    const node = audioWorkletNode
    audioWorkletNode = null
    if (!node)
      return

    node.port.onmessage = null
    node.disconnect()
  }

  function teardownAudioGraph() {
    disconnectInputGraph()
    disconnectWorkletNode()
  }

  function initialize() {
    return enqueueLifecycle(async () => {
      if (audioContext.state === 'closed') {
        audioContext = new AudioContext(audioContextOptions)
        workletInitialized = false
      }

      if (workletInitialized)
        return

      try {
        await audioContext.audioWorklet.addModule(vadAudioWorkletUrl)
        if (audioContext.state !== 'closed')
          workletInitialized = true
      }
      catch (error) {
        console.error('Failed to initialize audio worklet:', error)
        throw error
      }
    })
  }

  function start(stream: MediaStream) {
    const replacesActiveRun = activeRun !== null
    const generation = invalidateActiveRun()

    return enqueueLifecycle(async () => {
      if (generation !== lifecycleGeneration)
        return

      if (audioContext.state === 'closed' || !workletInitialized)
        throw new Error('Audio system not initialized. Call initialize() first.')

      teardownAudioGraph()
      if (replacesActiveRun)
        resetVADState()

      try {
        if (audioContext.state === 'suspended')
          await audioContext.resume()

        if (generation !== lifecycleGeneration || !workletInitialized)
          return

        const node = new AudioWorkletNode(audioContext, 'vad-audio-worklet-processor')
        const run: ActiveVADRun = {
          controller: new AbortController(),
          generation,
          node,
        }

        audioWorkletNode = node
        activeRun = run
        node.port.onmessage = (event) => {
          enqueueWorkletAudio(run, event.data?.buffer)
        }

        sourceNode = audioContext.createMediaStreamSource(stream)
        sourceNode.connect(node)

        // Connect the worklet to a silent destination to keep the audio graph active.
        silentGainNode = audioContext.createGain()
        silentGainNode.gain.value = 0
        node.connect(silentGainNode)
        silentGainNode.connect(audioContext.destination)
      }
      catch (error) {
        if (generation === lifecycleGeneration) {
          activeRun?.controller.abort()
          activeRun = null
          pendingAudioChunks = []
          teardownAudioGraph()
          resetVADState()
        }

        console.error('Failed to start microphone:', error)
        throw error
      }
    })
  }

  function stop() {
    invalidateActiveRun()

    return enqueueLifecycle(async () => {
      teardownAudioGraph()
      resetVADState()

      if (audioContext.state !== 'closed')
        await audioContext.suspend()
    })
  }

  function dispose() {
    invalidateActiveRun()
    teardownAudioGraph()
    resetVADState()

    // The MediaStream is owned by the caller (settings audio device store). VAD only borrows it
    // to build an AudioNode graph, so disposing VAD must not stop the microphone device itself.
    if (audioContext.state !== 'closed')
      void audioContext.close()

    workletInitialized = false
  }

  return {
    initialize,
    start,
    stop,
    dispose,
  }
}
