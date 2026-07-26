import type { QwenRealtimeSocketFactoryInput } from './qwen-realtime-protocol'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createQwenRealtimeSocketFactory } from './qwen-realtime-socket'

const { constructorCalls, FakeWebSocket } = vi.hoisted(() => {
  const constructorCalls: Array<{ url: string, options: Record<string, unknown> }> = []
  class FakeWebSocket {
    readyState = 0

    constructor(url: string, options: Record<string, unknown>) {
      constructorCalls.push({ url, options })
    }

    send(): void {}
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  return { constructorCalls, FakeWebSocket }
})

vi.mock('ws', () => ({ default: FakeWebSocket }))

describe('qwen realtime production socket factory', () => {
  beforeEach(() => constructorCalls.splice(0))

  it('connects only to the Beijing Qwen endpoint with a main-owned Bearer header', () => {
    const factory = createQwenRealtimeSocketFactory()
    factory(validInput())

    expect(constructorCalls).toEqual([{
      url: 'wss://workspace-1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-flash-realtime',
      options: {
        followRedirects: false,
        handshakeTimeout: 15_000,
        headers: { Authorization: 'Bearer local-secret' },
        maxPayload: 64 * 1024,
        perMessageDeflate: false,
        rejectUnauthorized: true,
        skipUTF8Validation: false,
      },
    }])
  })

  it.each([
    ['non-TLS endpoint', { url: 'ws://workspace-1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-flash-realtime' }],
    ['foreign host', { url: 'wss://workspace-1.example.com/api-ws/v1/realtime?model=qwen3.5-omni-flash-realtime' }],
    ['unexpected query', { url: 'wss://workspace-1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-flash-realtime&token=forbidden' }],
    ['unknown model', { url: 'wss://workspace-1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=other-model' }],
    ['whitespace in API key', { headers: { Authorization: 'Bearer local secret' } }],
    ['extra header', { headers: { Authorization: 'Bearer local-secret', Cookie: 'forbidden' } }],
  ])('rejects %s before constructing a socket', (_name, override) => {
    const factory = createQwenRealtimeSocketFactory()
    expect(() => factory({ ...validInput(), ...override } as QwenRealtimeSocketFactoryInput))
      .toThrowError(expect.objectContaining({ code: 'configuration-invalid' }))
    expect(constructorCalls).toEqual([])
  })
})

function validInput(): QwenRealtimeSocketFactoryInput {
  return {
    url: 'wss://workspace-1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-flash-realtime',
    headers: { Authorization: 'Bearer local-secret' },
  }
}
