import { describe, expect, it } from 'vitest'

import { BoundedPcmChunkQueue } from './bounded-pcm-queue'

describe('bounded PCM chunk queue', () => {
  it('drops the oldest complete chunks when the realtime budget is full', () => {
    const queue = new BoundedPcmChunkQueue(6)
    const first = new ArrayBuffer(2)
    const second = new ArrayBuffer(2)
    const third = new ArrayBuffer(2)
    const latest = new ArrayBuffer(2)

    queue.enqueue(first)
    queue.enqueue(second)
    queue.enqueue(third)
    const result = queue.enqueue(latest)

    expect(result).toEqual({ accepted: true, droppedChunks: 1, droppedBytes: 2 })
    expect(queue.byteLength).toBe(6)
    expect(queue.dequeue()).toBe(second)
    expect(queue.dequeue()).toBe(third)
    expect(queue.dequeue()).toBe(latest)
  })

  it('rejects an oversized chunk instead of retaining a partial PCM frame', () => {
    const queue = new BoundedPcmChunkQueue(4)
    const result = queue.enqueue(new ArrayBuffer(6))

    expect(result).toEqual({ accepted: false, droppedChunks: 1, droppedBytes: 6 })
    expect(queue.size).toBe(0)
  })
})
