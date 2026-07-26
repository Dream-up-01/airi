export const PERCEPTION_PCM_AUDIO_FORMAT = 'pcm-s16le-16000-mono' as const

export interface PerceptionPcmAudioChunk {
  chunkId: string
  capturedAt: number
  monotonicTimestamp: number
  format: typeof PERCEPTION_PCM_AUDIO_FORMAT
  samples: Int16Array
}

export type AudioFanoutLane = 'canonical-transcript' | 'cloud-perception'

export interface AudioFanoutDeliveryContext {
  signal: AbortSignal
  lane: AudioFanoutLane
  subscriberId: string
}

export interface AudioFanoutSubscriberOptions {
  subscriberId: string
  lane: AudioFanoutLane
  queueCapacity?: number
  overflow?: 'drop-oldest' | 'drop-newest'
  shouldAccept?: (chunk: PerceptionPcmAudioChunk) => boolean
  onChunk: (chunk: PerceptionPcmAudioChunk, context: AudioFanoutDeliveryContext) => void | Promise<void>
  onError?: (code: 'subscriber-failed') => void
}

export interface AudioFanoutSubscriberStats {
  subscriberId: string
  lane: AudioFanoutLane
  queuedChunks: number
  deliveredChunks: number
  droppedChunks: number
  gatedChunks: number
  failedChunks: number
}

export interface AudioFanoutSubscription {
  subscriberId: string
  lane: AudioFanoutLane
  stats: () => AudioFanoutSubscriberStats
  unsubscribe: () => void
}

interface SubscriberState {
  options: Required<Pick<AudioFanoutSubscriberOptions, 'queueCapacity' | 'overflow'>> & AudioFanoutSubscriberOptions
  queue: PerceptionPcmAudioChunk[]
  controller: AbortController
  draining: boolean
  deliveredChunks: number
  droppedChunks: number
  gatedChunks: number
  failedChunks: number
}

export interface AudioFanoutHubOptions {
  onEmpty?: () => void | Promise<void>
}

/**
 * Fanout queues are independent and each subscriber receives its own PCM copy.
 * A blocked cloud lane therefore cannot retain or mutate canonical ASR audio.
 */
export class AudioFanoutHub {
  readonly #subscribers = new Map<string, SubscriberState>()
  readonly #onEmpty?: AudioFanoutHubOptions['onEmpty']

  constructor(options: AudioFanoutHubOptions = {}) {
    this.#onEmpty = options.onEmpty
  }

  get subscriberCount(): number {
    return this.#subscribers.size
  }

  subscribe(options: AudioFanoutSubscriberOptions): AudioFanoutSubscription {
    if (this.#subscribers.has(options.subscriberId))
      throw new Error('perception_audio_subscriber_exists')

    const queueCapacity = options.queueCapacity ?? (options.lane === 'cloud-perception' ? 4 : 64)
    if (!Number.isInteger(queueCapacity) || queueCapacity < 1 || queueCapacity > 256)
      throw new Error('perception_audio_queue_capacity_invalid')

    const state: SubscriberState = {
      options: {
        ...options,
        queueCapacity,
        overflow: options.overflow ?? 'drop-oldest',
      },
      queue: [],
      controller: new AbortController(),
      draining: false,
      deliveredChunks: 0,
      droppedChunks: 0,
      gatedChunks: 0,
      failedChunks: 0,
    }
    this.#subscribers.set(options.subscriberId, state)

    let unsubscribed = false
    return {
      subscriberId: options.subscriberId,
      lane: options.lane,
      stats: () => this.#stats(state),
      unsubscribe: () => {
        if (unsubscribed)
          return
        unsubscribed = true
        this.#removeSubscriber(options.subscriberId)
      },
    }
  }

  publish(chunk: PerceptionPcmAudioChunk): void {
    validateChunk(chunk)
    for (const state of this.#subscribers.values()) {
      if (state.controller.signal.aborted)
        continue
      if (state.options.shouldAccept && !state.options.shouldAccept(chunk)) {
        state.gatedChunks += 1
        continue
      }

      if (state.queue.length >= state.options.queueCapacity) {
        state.droppedChunks += 1
        if (state.options.overflow === 'drop-newest')
          continue
        state.queue.shift()
      }

      state.queue.push(cloneChunk(chunk))
      void this.#drain(state)
    }
  }

  stopAll(): void {
    const subscriberIds = [...this.#subscribers.keys()]
    for (const subscriberId of subscriberIds)
      this.#removeSubscriber(subscriberId)
  }

  stats(): AudioFanoutSubscriberStats[] {
    return [...this.#subscribers.values()].map(state => this.#stats(state))
  }

  async #drain(state: SubscriberState): Promise<void> {
    if (state.draining)
      return
    state.draining = true
    try {
      while (state.queue.length > 0 && !state.controller.signal.aborted) {
        const chunk = state.queue.shift()
        if (!chunk)
          continue
        try {
          await state.options.onChunk(chunk, {
            signal: state.controller.signal,
            lane: state.options.lane,
            subscriberId: state.options.subscriberId,
          })
          if (!state.controller.signal.aborted)
            state.deliveredChunks += 1
        }
        catch {
          if (!state.controller.signal.aborted) {
            state.failedChunks += 1
            state.options.onError?.('subscriber-failed')
          }
        }
      }
    }
    finally {
      state.draining = false
    }
  }

  #removeSubscriber(subscriberId: string): void {
    const state = this.#subscribers.get(subscriberId)
    if (!state)
      return
    this.#subscribers.delete(subscriberId)
    state.controller.abort('subscriber-unsubscribed')
    state.queue.length = 0
    if (this.#subscribers.size === 0)
      void this.#onEmpty?.()
  }

  #stats(state: SubscriberState): AudioFanoutSubscriberStats {
    return {
      subscriberId: state.options.subscriberId,
      lane: state.options.lane,
      queuedChunks: state.queue.length,
      deliveredChunks: state.deliveredChunks,
      droppedChunks: state.droppedChunks,
      gatedChunks: state.gatedChunks,
      failedChunks: state.failedChunks,
    }
  }
}

function cloneChunk(chunk: PerceptionPcmAudioChunk): PerceptionPcmAudioChunk {
  return {
    ...chunk,
    samples: chunk.samples.slice(),
  }
}

function validateChunk(chunk: PerceptionPcmAudioChunk): void {
  if (!chunk.chunkId || chunk.format !== PERCEPTION_PCM_AUDIO_FORMAT || !Number.isFinite(chunk.capturedAt) || !Number.isFinite(chunk.monotonicTimestamp))
    throw new Error('perception_audio_chunk_invalid')
  if (!(chunk.samples instanceof Int16Array) || chunk.samples.byteLength > 64 * 1024)
    throw new Error('perception_audio_chunk_invalid')
}
