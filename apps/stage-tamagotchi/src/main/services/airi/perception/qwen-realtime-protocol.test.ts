import type {
  QwenRealtimeSocketEvent,
  QwenRealtimeSocketFactoryInput,
  QwenRealtimeSocketLike,
} from './qwen-realtime-protocol'

import { QWEN_FLASH_REALTIME_MODEL_ID, QWEN_PLUS_REALTIME_MODEL_ID } from '@proj-airi/stage-ui/domains/perception'
import { describe, expect, it, vi } from 'vitest'

import {
  QwenRealtimeProtocolSession,
} from './qwen-realtime-protocol'

describe('qwen realtime main-owned protocol', () => {
  it('uses China mainland auth, text-only Manual control, and real audio before images', async () => {
    const socket = new FakeSocket()
    const factory = vi.fn((input: QwenRealtimeSocketFactoryInput) => {
      expect(input.url).toBe('wss://workspace-1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-flash-realtime')
      expect(input.headers.Authorization).toBe('Bearer local-secret')
      return socket
    })
    const session = new QwenRealtimeProtocolSession({
      workspaceId: 'workspace-1',
      apiKey: 'local-secret',
      modelId: QWEN_FLASH_REALTIME_MODEL_ID,
      sourceKind: 'screen-cloud',
      socketFactory: factory,
      eventId: incrementingId(),
    })

    await session.open()
    const update = socket.sentJson()[0]
    expect(update).toMatchObject({
      type: 'session.update',
      session: {
        modalities: ['text'],
        input_audio_format: 'pcm',
        turn_detection: null,
        enable_search: false,
        tools: [],
      },
    })
    expect(update.session).not.toHaveProperty('voice')
    expect(JSON.stringify(session.status)).not.toMatch(/workspace|secret|api.?key/iu)

    expect(() => session.appendImage(jpeg())).toThrowError(expect.objectContaining({ code: 'audio-required-before-image' }))
    session.appendAudio(new Uint8Array([1, 0, 2, 0]))
    session.appendImage(jpeg())
    const completed = session.requestCompleted()
    expect(socket.sentJson().slice(-2).map(event => event.type)).toEqual(['input_audio_buffer.commit', 'response.create'])

    socket.emitMessage({
      event_id: 'server-1',
      type: 'response.text.delta',
      response_id: 'response-1',
      item_id: 'item-1',
      output_index: 0,
      content_index: 0,
      delta: '{"events":',
    })
    socket.emitMessage({
      event_id: 'server-2',
      type: 'response.text.done',
      response_id: 'response-1',
      item_id: 'item-1',
      output_index: 0,
      content_index: 0,
      text: '{"events":[]}',
    })
    socket.emitMessage(responseDone())

    await expect(completed).resolves.toEqual({
      responseId: 'response-1',
      completedText: '{"events":[]}',
      usage: {
        inputTextImageTokens: 150,
        inputAudioTokens: 25,
        outputTextTokens: 10,
        outputAudioTokens: 0,
      },
    })
    expect(session.status.state).toBe('completed')
  })

  it('forbids camera Plus and any provider audio output', async () => {
    expect(() => new QwenRealtimeProtocolSession({
      workspaceId: 'workspace-1',
      apiKey: 'local-secret',
      modelId: QWEN_PLUS_REALTIME_MODEL_ID,
      sourceKind: 'camera-cloud',
      socketFactory: () => new FakeSocket(),
    })).toThrowError(expect.objectContaining({ code: 'configuration-invalid' }))

    const socket = new FakeSocket()
    const session = sessionFor(socket)
    await session.open()
    session.appendAudio(new Uint8Array([1, 0]))
    session.appendImage(jpeg())
    const completed = session.requestCompleted()
    socket.emitMessage({ type: 'response.audio.delta', delta: 'forbidden' })
    await expect(completed).rejects.toEqual(expect.objectContaining({ code: 'output-audio-forbidden' }))
  })

  it('rejects partial-only responses and cancels without retaining media', async () => {
    const socket = new FakeSocket()
    const controller = new AbortController()
    const session = sessionFor(socket)
    await session.open(controller.signal)
    session.appendAudio(new Uint8Array([1, 0]))
    session.appendImage(jpeg())
    const completed = session.requestCompleted()
    socket.emitMessage(responseDone())
    await expect(completed).rejects.toEqual(expect.objectContaining({ code: 'response-incomplete' }))

    const secondSocket = new FakeSocket()
    const secondController = new AbortController()
    const second = sessionFor(secondSocket)
    await second.open(secondController.signal)
    secondController.abort()
    expect(second.status).toMatchObject({ state: 'failed', lastErrorCode: 'cancelled', hasAudio: false, hasImage: false })
    expect(secondSocket.closed).toBe(true)
  })
})

class FakeSocket implements QwenRealtimeSocketLike {
  readyState = 1
  readonly sent: string[] = []
  readonly listeners = new Map<string, Array<(event: QwenRealtimeSocketEvent) => void>>()
  closed = false

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }

  addEventListener(type: string, listener: (event: QwenRealtimeSocketEvent) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: QwenRealtimeSocketEvent) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(candidate => candidate !== listener))
  }

  emitMessage(value: unknown): void {
    for (const listener of this.listeners.get('message') ?? [])
      listener({ data: JSON.stringify(value) })
  }

  sentJson(): any[] {
    return this.sent.map(value => JSON.parse(value))
  }
}

function sessionFor(socket: FakeSocket): QwenRealtimeProtocolSession {
  return new QwenRealtimeProtocolSession({
    workspaceId: 'workspace-1',
    apiKey: 'local-secret',
    modelId: QWEN_FLASH_REALTIME_MODEL_ID,
    sourceKind: 'screen-cloud',
    socketFactory: () => socket,
    eventId: incrementingId(),
  })
}

function incrementingId(): () => string {
  let value = 0
  return () => `event-${++value}`
}

function jpeg(): Uint8Array {
  return new Uint8Array([0xFF, 0xD8, 0x01, 0x02, 0xFF, 0xD9])
}

function responseDone() {
  return {
    event_id: 'server-3',
    type: 'response.done',
    response: {
      id: 'response-1',
      object: 'realtime.response',
      conversation_id: 'conversation-1',
      status: 'completed',
      modalities: ['text'],
      output: [{
        id: 'item-1',
        object: 'realtime.item',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'text', text: '{"events":[]}' }],
      }],
      usage: {
        total_tokens: 185,
        input_tokens: 175,
        output_tokens: 10,
        input_tokens_details: { text_tokens: 100, image_tokens: 50, audio_tokens: 25 },
        output_tokens_details: { text_tokens: 10, audio_tokens: 0 },
      },
    },
  }
}
