export interface MicrophoneTrackLike {
  readyState?: string
  stop: () => void
  addEventListener?: (type: 'ended', listener: () => void, options?: { once?: boolean }) => void
}

export interface MicrophoneStreamLike {
  getAudioTracks: () => MicrophoneTrackLike[]
}

export interface SharedMicrophoneLease<TStream extends MicrophoneStreamLike> {
  consumerId: string
  stream: TStream
  release: () => void
}

export interface SharedMicrophoneCaptureOwnerOptions<TStream extends MicrophoneStreamLike> {
  openStream: () => Promise<TStream>
  closeStream?: (stream: TStream) => void
  onTrackEnded?: () => void
}

/**
 * Owns exactly one microphone stream. Permission checks remain outside this
 * class so no subscriber can implicitly expand or request a consent grant.
 */
export class SharedMicrophoneCaptureOwner<TStream extends MicrophoneStreamLike = MicrophoneStreamLike> {
  readonly #openStream: () => Promise<TStream>
  readonly #closeStream?: (stream: TStream) => void
  readonly #onTrackEnded?: () => void
  readonly #consumers = new Set<string>()
  readonly #pendingConsumers = new Map<string, symbol>()
  #stream?: TStream
  #opening?: { epoch: number, promise: Promise<TStream> }
  #epoch = 0

  constructor(options: SharedMicrophoneCaptureOwnerOptions<TStream>) {
    this.#openStream = options.openStream
    this.#closeStream = options.closeStream
    this.#onTrackEnded = options.onTrackEnded
  }

  get consumerCount(): number {
    return this.#consumers.size
  }

  get active(): boolean {
    return this.#stream !== undefined
  }

  async acquire(consumerId: string): Promise<SharedMicrophoneLease<TStream>> {
    if (!consumerId)
      throw new Error('perception_microphone_consumer_invalid')
    if (this.#consumers.has(consumerId) || this.#pendingConsumers.has(consumerId))
      throw new Error('perception_microphone_consumer_exists')

    const epoch = this.#epoch
    const pendingToken = Symbol(consumerId)
    this.#pendingConsumers.set(consumerId, pendingToken)
    let stream: TStream
    try {
      stream = await this.#ensureStream(epoch)
      if (epoch !== this.#epoch) {
        if (this.#consumers.size === 0)
          this.#stopStream()
        throw new Error('perception_microphone_acquire_cancelled')
      }
      this.#consumers.add(consumerId)
    }
    finally {
      if (this.#pendingConsumers.get(consumerId) === pendingToken)
        this.#pendingConsumers.delete(consumerId)
    }
    let released = false
    return {
      consumerId,
      stream,
      release: () => {
        if (released)
          return
        released = true
        this.#consumers.delete(consumerId)
        if (this.#consumers.size === 0)
          this.#stopStream()
      },
    }
  }

  stopAll(): void {
    this.#epoch += 1
    this.#consumers.clear()
    this.#pendingConsumers.clear()
    this.#opening = undefined
    this.#stopStream()
  }

  async #ensureStream(epoch: number): Promise<TStream> {
    if (this.#stream)
      return this.#stream
    if (this.#opening?.epoch === epoch)
      return this.#opening.promise

    const opening = {
      epoch,
      promise: undefined as unknown as Promise<TStream>,
    }
    opening.promise = this.#openStream()
      .then((stream) => {
        if (stream.getAudioTracks().length === 0)
          throw new Error('perception_microphone_track_missing')
        if (epoch !== this.#epoch) {
          this.#closeDetachedStream(stream)
          throw new Error('perception_microphone_acquire_cancelled')
        }
        this.#stream = stream
        for (const track of stream.getAudioTracks()) {
          track.addEventListener?.('ended', () => {
            if (this.#stream !== stream)
              return
            this.#stream = undefined
            this.#consumers.clear()
            this.#onTrackEnded?.()
          }, { once: true })
        }
        return stream
      })
      .finally(() => {
        if (this.#opening === opening)
          this.#opening = undefined
      })
    this.#opening = opening
    return opening.promise
  }

  #stopStream(): void {
    const stream = this.#stream
    this.#stream = undefined
    if (!stream)
      return
    this.#closeDetachedStream(stream)
  }

  #closeDetachedStream(stream: TStream): void {
    if (this.#closeStream) {
      this.#closeStream(stream)
      return
    }
    for (const track of stream.getAudioTracks())
      track.stop()
  }
}
