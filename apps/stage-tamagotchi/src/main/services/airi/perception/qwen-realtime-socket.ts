import type {
  QwenRealtimeSocketEvent,
  QwenRealtimeSocketFactory,
  QwenRealtimeSocketFactoryInput,
  QwenRealtimeSocketLike,
} from './qwen-realtime-protocol'

import WebSocket from 'ws'

const QWEN_REALTIME_HOST_SUFFIX = '.cn-beijing.maas.aliyuncs.com'
const QWEN_REALTIME_PATH = '/api-ws/v1/realtime'
const QWEN_REALTIME_MODELS = new Set([
  'qwen3.5-omni-flash-realtime',
  'qwen3.5-omni-plus-realtime',
])
const MAX_PROVIDER_EVENT_BYTES = 64 * 1024

export class QwenRealtimeSocketError extends Error {
  constructor(readonly code: 'configuration-invalid') {
    super(code)
    this.name = 'QwenRealtimeSocketError'
  }
}

export function createQwenRealtimeSocketFactory(): QwenRealtimeSocketFactory {
  return (input) => {
    const validated = validateSocketInput(input)
    const socket = new WebSocket(validated.url, {
      followRedirects: false,
      handshakeTimeout: 15_000,
      headers: { Authorization: validated.authorization },
      maxPayload: MAX_PROVIDER_EVENT_BYTES,
      perMessageDeflate: false,
      rejectUnauthorized: true,
      skipUTF8Validation: false,
    })
    return new QwenRealtimeSocketAdapter(socket)
  }
}

class QwenRealtimeSocketAdapter implements QwenRealtimeSocketLike {
  constructor(private readonly socket: WebSocket) {}

  get readyState(): number {
    return this.socket.readyState
  }

  send(data: string): void {
    this.socket.send(data)
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason)
  }

  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: QwenRealtimeSocketEvent) => void,
    options?: { once?: boolean },
  ): void {
    switch (type) {
      case 'message':
        this.socket.addEventListener('message', event => listener({ data: event.data }), options)
        break
      case 'open':
        this.socket.addEventListener('open', () => listener({}), options)
        break
      case 'error':
        this.socket.addEventListener('error', () => listener({}), options)
        break
      case 'close':
        this.socket.addEventListener('close', () => listener({}), options)
        break
    }
  }
}

function validateSocketInput(input: QwenRealtimeSocketFactoryInput): {
  url: string
  authorization: string
} {
  if (!isRecord(input) || !hasExactKeys(input, ['headers', 'url']) || typeof input.url !== 'string' || !isRecord(input.headers) || !hasExactKeys(input.headers, ['Authorization']))
    throw new QwenRealtimeSocketError('configuration-invalid')

  const authorization = input.headers.Authorization
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer '))
    throw new QwenRealtimeSocketError('configuration-invalid')
  const apiKey = authorization.slice('Bearer '.length)
  if (apiKey.length < 8 || apiKey.length > 512 || containsWhitespaceOrControl(apiKey))
    throw new QwenRealtimeSocketError('configuration-invalid')

  let url: URL
  try {
    url = new URL(input.url)
  }
  catch {
    throw new QwenRealtimeSocketError('configuration-invalid')
  }
  const workspaceId = url.hostname.endsWith(QWEN_REALTIME_HOST_SUFFIX)
    ? url.hostname.slice(0, -QWEN_REALTIME_HOST_SUFFIX.length)
    : ''
  const queryKeys = [...url.searchParams.keys()]
  if (url.protocol !== 'wss:'
    || url.username !== ''
    || url.password !== ''
    || url.port !== ''
    || url.hash !== ''
    || url.pathname !== QWEN_REALTIME_PATH
    || !/^[a-z0-9][a-z0-9-]{2,63}$/u.test(workspaceId)
    || queryKeys.length !== 1
    || queryKeys[0] !== 'model'
    || !QWEN_REALTIME_MODELS.has(url.searchParams.get('model') ?? '')) {
    throw new QwenRealtimeSocketError('configuration-invalid')
  }

  return { url: input.url, authorization }
}

function containsWhitespaceOrControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x20 || codePoint === 0x7F || character.trim().length === 0)
      return true
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index])
}
