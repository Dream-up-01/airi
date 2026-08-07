/**
 * Memory-only queue for realtime PCM chunks.
 *
 * Realtime speech prioritizes the newest audio. When an upstream provider is
 * slow, retaining every old chunk makes the transcript increasingly stale, so
 * overflow drops complete oldest chunks instead of growing without bound.
 */
export class BoundedPcmChunkQueue {
  private readonly chunks: ArrayBuffer[] = []
  private queuedBytes = 0

  constructor(private readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
      throw new RangeError('maxBytes must be a positive safe integer')
  }

  get size() {
    return this.chunks.length
  }

  get byteLength() {
    return this.queuedBytes
  }

  enqueue(chunk: ArrayBuffer) {
    if (chunk.byteLength > this.maxBytes)
      return { accepted: false, droppedChunks: 1, droppedBytes: chunk.byteLength }

    let droppedChunks = 0
    let droppedBytes = 0
    while (this.queuedBytes + chunk.byteLength > this.maxBytes) {
      const dropped = this.chunks.shift()
      if (!dropped)
        break
      this.queuedBytes -= dropped.byteLength
      droppedChunks += 1
      droppedBytes += dropped.byteLength
    }

    this.chunks.push(chunk)
    this.queuedBytes += chunk.byteLength
    return { accepted: true, droppedChunks, droppedBytes }
  }

  dequeue() {
    const chunk = this.chunks.shift()
    if (chunk)
      this.queuedBytes -= chunk.byteLength
    return chunk
  }

  clear() {
    this.chunks.length = 0
    this.queuedBytes = 0
  }
}
