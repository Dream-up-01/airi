import { describe, expect, it, vi } from 'vitest'

import { SharedMicrophoneCaptureOwner } from './shared-microphone-owner'

function createTrack() {
  let ended: (() => void) | undefined
  return {
    track: {
      stop: vi.fn(),
      addEventListener: (_type: 'ended', listener: () => void) => {
        ended = listener
      },
    },
    end: () => ended?.(),
  }
}

describe('shared microphone capture owner', () => {
  it('opens one stream for concurrent consumers and stops after the last release', async () => {
    const { track } = createTrack()
    const stream = { getAudioTracks: () => [track] }
    const openStream = vi.fn(async () => stream)
    const owner = new SharedMicrophoneCaptureOwner({ openStream })

    const [canonical, cloud] = await Promise.all([
      owner.acquire('canonical'),
      owner.acquire('cloud'),
    ])
    expect(openStream).toHaveBeenCalledOnce()
    expect(canonical.stream).toBe(cloud.stream)
    expect(owner.consumerCount).toBe(2)

    cloud.release()
    expect(track.stop).not.toHaveBeenCalled()
    expect(owner.active).toBe(true)
    canonical.release()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(owner.active).toBe(false)
  })

  it('makes release and global stop idempotent', async () => {
    const { track } = createTrack()
    const owner = new SharedMicrophoneCaptureOwner({
      openStream: async () => ({ getAudioTracks: () => [track] }),
    })
    const lease = await owner.acquire('canonical')
    lease.release()
    lease.release()
    owner.stopAll()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('invalidates every consumer when the physical track ends', async () => {
    const { track, end } = createTrack()
    const onTrackEnded = vi.fn()
    const owner = new SharedMicrophoneCaptureOwner({
      openStream: async () => ({ getAudioTracks: () => [track] }),
      onTrackEnded,
    })
    await owner.acquire('canonical')
    await owner.acquire('cloud')
    end()
    expect(owner.active).toBe(false)
    expect(owner.consumerCount).toBe(0)
    expect(onTrackEnded).toHaveBeenCalledOnce()
  })

  it('uses the platform close hook exactly once', async () => {
    const { track } = createTrack()
    const stream = { getAudioTracks: () => [track] }
    const closeStream = vi.fn()
    const owner = new SharedMicrophoneCaptureOwner({
      openStream: async () => stream,
      closeStream,
    })

    const lease = await owner.acquire('canonical')
    lease.release()
    lease.release()
    owner.stopAll()

    expect(closeStream).toHaveBeenCalledOnce()
    expect(closeStream).toHaveBeenCalledWith(stream)
    expect(track.stop).not.toHaveBeenCalled()
  })

  it('rejects a duplicate consumer while its first acquisition is pending', async () => {
    const { track } = createTrack()
    interface TestStream { getAudioTracks: () => Array<typeof track> }
    let resolveOpen!: (stream: TestStream) => void
    const owner = new SharedMicrophoneCaptureOwner({
      openStream: () => new Promise<TestStream>((resolve) => {
        resolveOpen = resolve
      }),
    })

    const pending = owner.acquire('canonical')
    await expect(owner.acquire('canonical')).rejects.toThrow('perception_microphone_consumer_exists')
    resolveOpen({ getAudioTracks: () => [track] })
    const lease = await pending
    lease.release()
  })

  it('cancels a pending acquisition when all consumers are stopped', async () => {
    const { track } = createTrack()
    const stream = { getAudioTracks: () => [track] }
    const closeStream = vi.fn()
    let resolveOpen!: (openedStream: typeof stream) => void
    const owner = new SharedMicrophoneCaptureOwner({
      openStream: () => new Promise((resolve) => {
        resolveOpen = resolve
      }),
      closeStream,
    })

    const pending = owner.acquire('cloud')
    owner.stopAll()
    resolveOpen(stream)

    await expect(pending).rejects.toThrow('perception_microphone_acquire_cancelled')
    expect(owner.active).toBe(false)
    expect(owner.consumerCount).toBe(0)
    expect(closeStream).toHaveBeenCalledOnce()
  })
})
