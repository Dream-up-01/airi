import type { WebSocketEvent } from '@proj-airi/server-shared/types'

import type { Peer } from './types'

import { Buffer } from 'node:buffer'
import { generateKeyPairSync, sign } from 'node:crypto'

import { parse, stringify } from 'superjson'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setupApp } from './index'

interface TestWebSocketHandler {
  open?: (peer: Peer) => void
  message?: (peer: Peer, message: { text: () => string }) => void
  close?: (peer: Peer, details?: { code?: number, reason?: string, wasClean?: unknown }) => void
}

interface TestWsServer {
  accept: (
    adapter: { id: string, send: (message: { text: () => string }) => void | number, close?: () => void },
    options: { state: { rawPeer: Peer } },
  ) => void
  peers: {
    get: (peerId: string) => { receive: (message: { text: () => string }) => void } | undefined
  }
  remove: (peerId: string, details?: { code?: number, reason?: string, wasClean?: unknown }) => void
}

const h3Mocks = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
}))

vi.mock('h3', () => ({
  H3: class {
    get(path: string, handler: unknown) {
      h3Mocks.handlers.set(path, handler)
    }
  },
}))

vi.mock('@proj-airi/better-ws/server/h3', () => ({
  toH3Handler: vi.fn((server: TestWsServer, options: { state: (peer: Peer) => { rawPeer: Peer } }) => ({
    open(peer: Peer) {
      server.accept({
        id: peer.id,
        send: message => peer.send(message.text()),
        close: () => peer.close?.(),
      }, {
        state: options.state(peer),
      })
    },
    message(peer: Peer, message: { text: () => string }) {
      server.peers.get(peer.id)?.receive(message)
    },
    close(peer: Peer, details?: { code?: number, reason?: string, wasClean?: unknown }) {
      server.remove(peer.id, details)
    },
  })),
}))

function createPeer(id: string, onSend?: (data: string, peer: Peer) => void) {
  const sent: string[] = []
  const peer: Peer = {
    id,
    send: vi.fn((data) => {
      const serialized = String(data)
      sent.push(serialized)
      onSend?.(serialized, peer)
    }),
    close: vi.fn(),
    request: { url: `/ws?id=${id}` },
    remoteAddress: '127.0.0.1',
  }

  return {
    peer,
    sent,
  }
}

function wsHandler() {
  const handler = h3Mocks.handlers.get('/ws') as TestWebSocketHandler | undefined
  if (!handler) {
    throw new Error('Expected setupApp to register a /ws websocket handler.')
  }

  return handler
}

function sendEvent(
  handler: TestWebSocketHandler,
  peer: Peer,
  event: WebSocketEvent,
) {
  handler.message?.(peer, { text: () => stringify(event) })
}

function decodeEvents(sent: string[]) {
  return sent.map(message => parse<WebSocketEvent>(message))
}

function createExtensionModuleAnnounceEvent(): WebSocketEvent {
  return {
    type: 'extension:module:announce',
    data: {
      name: 'memory',
      possibleEvents: [],
      identity: {
        id: 'memory-module-1',
        extension: {
          id: 'extension-1',
        },
      },
    },
    metadata: {
      source: {
        kind: 'plugin',
        id: 'extension-1',
        plugin: {
          id: 'extension-1',
        },
      },
      event: {
        id: 'announce-1',
      },
    },
  }
}

function createFabricModuleAnnounceEvent(moduleInstanceId: string): WebSocketEvent {
  return {
    type: 'extension:module:announce',
    data: {
      name: 'minecraft-bot',
      possibleEvents: [],
      identity: {
        id: moduleInstanceId,
        extension: {
          id: 'airi-mc-connect',
          version: '0.1.0-alpha.1',
        },
        labels: { runtime: 'fabric' },
      },
    },
    metadata: {
      source: {
        kind: 'plugin',
        id: moduleInstanceId,
        plugin: { id: 'airi-mc-connect' },
      },
      event: { id: 'fabric-announce-1' },
    },
  }
}

function createModuleAuthenticateEvent(): WebSocketEvent {
  return {
    type: 'module:authenticate',
    data: { token: 'secret' },
    metadata: {
      source: {
        kind: 'plugin',
        id: 'extension-1',
        plugin: { id: 'extension-1' },
      },
      event: { id: 'authenticate-1' },
    },
  }
}

function createPairingHelloEvent(moduleInstanceId: string, publicKey: string): WebSocketEvent {
  return {
    type: 'module:pairing:hello',
    data: {
      protocolVersion: 1,
      moduleInstanceId,
      deviceId: 'device-1',
      publicKey,
      algorithm: 'Ed25519',
      displayName: 'AIRI MC Connect',
      clientVersion: '0.1.0-alpha.1',
    },
    metadata: {
      source: {
        kind: 'plugin',
        id: moduleInstanceId,
        plugin: { id: 'airi-mc-connect' },
      },
      event: { id: 'pairing-hello-1' },
    },
  }
}

function createPairingProofEvent(params: {
  moduleInstanceId: string
  requestId: string
  nonce: string
  publicKey: string
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']
}): WebSocketEvent {
  const payload = Buffer.from([
    'airi-module-pairing-v1',
    '1',
    params.moduleInstanceId,
    params.requestId,
    'device-1',
    params.nonce,
  ].join('\n'), 'utf8')

  return {
    type: 'module:pairing:prove',
    data: {
      protocolVersion: 1,
      moduleInstanceId: params.moduleInstanceId,
      requestId: params.requestId,
      deviceId: 'device-1',
      publicKey: params.publicKey,
      signature: sign(null, payload, params.privateKey).toString('base64'),
    },
    metadata: {
      source: {
        kind: 'plugin',
        id: params.moduleInstanceId,
        plugin: { id: 'airi-mc-connect' },
      },
      event: { id: 'pairing-proof-1' },
    },
  } as WebSocketEvent
}

describe('setupApp websocket liveness', () => {
  beforeEach(() => {
    h3Mocks.handlers.clear()
    vi.useFakeTimers({ now: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('commits authentication before acknowledging a client that announces immediately', () => {
    const runtime = setupApp({ auth: { token: 'secret' } })
    const handler = wsHandler()
    const modulePeer = createPeer('module-peer', (message, peer) => {
      const event = parse<WebSocketEvent>(message)
      if (event.type === 'module:authenticated')
        sendEvent(handler, peer, createExtensionModuleAnnounceEvent())
    })

    handler.open?.(modulePeer.peer)
    sendEvent(handler, modulePeer.peer, createModuleAuthenticateEvent())

    expect(decodeEvents(modulePeer.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'module:authenticated' }),
      expect.objectContaining({ type: 'extension:module:announced' }),
    ]))
    expect(decodeEvents(modulePeer.sent)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({ message: 'must authenticate before announcing' }),
      }),
    ]))

    runtime.dispose()
  })

  it('binds a paired proof to the protocol version and module process identity', async () => {
    const keyPair = generateKeyPairSync('ed25519')
    const publicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    const runtime = setupApp({
      auth: {
        token: '',
        modulePairing: {
          isPaired: () => true,
          requestApproval: () => true,
          remember: () => {},
        },
      },
    })
    const handler = wsHandler()
    const modulePeer = createPeer('module-peer')
    const moduleInstanceId = 'fabric-process-1'

    handler.open?.(modulePeer.peer)
    sendEvent(handler, modulePeer.peer, createPairingHelloEvent(moduleInstanceId, publicKey))

    await vi.waitFor(() => {
      expect(decodeEvents(modulePeer.sent)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'module:pairing:challenge',
          data: expect.objectContaining({ moduleInstanceId }),
        }),
      ]))
    })

    const challenge = decodeEvents(modulePeer.sent)
      .find(event => event.type === 'module:pairing:challenge')!
    sendEvent(handler, modulePeer.peer, createPairingProofEvent({
      moduleInstanceId,
      requestId: challenge.data.requestId,
      nonce: challenge.data.nonce,
      publicKey,
      privateKey: keyPair.privateKey,
    }))

    await vi.waitFor(() => {
      expect(decodeEvents(modulePeer.sent)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'module:authenticated' }),
      ]))
    })

    runtime.dispose()
  })

  it('rejects a pairing proof replayed under a different module process identity', async () => {
    const keyPair = generateKeyPairSync('ed25519')
    const publicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    const runtime = setupApp({
      auth: {
        token: '',
        modulePairing: {
          isPaired: () => true,
          requestApproval: () => true,
          remember: () => {},
        },
      },
    })
    const handler = wsHandler()
    const modulePeer = createPeer('module-peer')

    handler.open?.(modulePeer.peer)
    sendEvent(handler, modulePeer.peer, createPairingHelloEvent('fabric-process-1', publicKey))
    await vi.waitFor(() => {
      expect(decodeEvents(modulePeer.sent).some(event => event.type === 'module:pairing:challenge')).toBe(true)
    })
    const challenge = decodeEvents(modulePeer.sent)
      .find(event => event.type === 'module:pairing:challenge')!

    sendEvent(handler, modulePeer.peer, createPairingProofEvent({
      moduleInstanceId: 'fabric-process-2',
      requestId: challenge.data.requestId,
      nonce: challenge.data.nonce,
      publicKey,
      privateKey: keyPair.privateKey,
    }))

    await vi.waitFor(() => {
      expect(decodeEvents(modulePeer.sent)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          data: expect.objectContaining({ message: 'pairing-proof-invalid' }),
        }),
      ]))
    })

    runtime.dispose()
  })

  it('closes and de-announces an authenticated module when its paired device is revoked', async () => {
    const keyPair = generateKeyPairSync('ed25519')
    const publicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    let revokeDevice: ((deviceId: string) => void) | undefined
    const runtime = setupApp({
      auth: {
        token: '',
        modulePairing: {
          isPaired: () => true,
          requestApproval: () => true,
          remember: () => {},
          subscribeRevocations(listener) {
            revokeDevice = listener
            return () => {
              revokeDevice = undefined
            }
          },
        },
      },
    })
    const handler = wsHandler()
    const observer = createPeer('observer')
    const modulePeer = createPeer('module-peer')
    const moduleInstanceId = 'fabric-process-1'

    handler.open?.(observer.peer)
    handler.open?.(modulePeer.peer)
    sendEvent(handler, modulePeer.peer, createPairingHelloEvent(moduleInstanceId, publicKey))
    await vi.waitFor(() => {
      expect(decodeEvents(modulePeer.sent).some(event => event.type === 'module:pairing:challenge')).toBe(true)
    })
    const challenge = decodeEvents(modulePeer.sent)
      .find(event => event.type === 'module:pairing:challenge')!
    sendEvent(handler, modulePeer.peer, createPairingProofEvent({
      moduleInstanceId,
      requestId: challenge.data.requestId,
      nonce: challenge.data.nonce,
      publicKey,
      privateKey: keyPair.privateKey,
    }))
    await vi.waitFor(() => {
      expect(decodeEvents(modulePeer.sent).filter(event => event.type === 'module:authenticated')).toHaveLength(2)
    })
    sendEvent(handler, modulePeer.peer, createFabricModuleAnnounceEvent(moduleInstanceId))
    observer.sent.length = 0

    revokeDevice?.('device-1')

    await vi.waitFor(() => {
      expect(modulePeer.peer.close).toHaveBeenCalledOnce()
      expect(decodeEvents(observer.sent)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'extension:module:de-announced',
          data: expect.objectContaining({
            name: 'minecraft-bot',
            reason: 'pairing-revoked',
          }),
        }),
      ]))
    })

    runtime.dispose()
  })

  it('broadcasts extension module unhealthy events from better-ws liveness checks', () => {
    const runtime = setupApp({ heartbeat: { readTimeout: 20_000 } })
    const handler = wsHandler()
    const observer = createPeer('observer')
    const modulePeer = createPeer('module-peer')

    handler.open?.(observer.peer)
    handler.open?.(modulePeer.peer)
    sendEvent(handler, modulePeer.peer, createExtensionModuleAnnounceEvent())
    observer.sent.length = 0

    vi.advanceTimersByTime(25_000)

    expect(decodeEvents(observer.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'registry:modules:health:unhealthy',
        data: {
          name: 'memory',
          identity: {
            id: 'memory-module-1',
            extension: {
              id: 'extension-1',
            },
          },
          reason: 'heartbeat late',
        },
      }),
    ]))

    runtime.dispose()
  })

  it('de-announces expired extension modules when better-ws removes stale peers', () => {
    const runtime = setupApp({ heartbeat: { readTimeout: 20_000 } })
    const handler = wsHandler()
    const observer = createPeer('observer')
    const modulePeer = createPeer('module-peer')

    handler.open?.(observer.peer)
    handler.open?.(modulePeer.peer)
    sendEvent(handler, modulePeer.peer, createExtensionModuleAnnounceEvent())
    observer.sent.length = 0

    vi.advanceTimersByTime(25_000)
    handler.message?.(observer.peer, { text: () => 'pong' })
    observer.sent.length = 0
    vi.advanceTimersByTime(25_000)

    expect(modulePeer.peer.close).toHaveBeenCalledOnce()
    expect(decodeEvents(observer.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'extension:module:de-announced',
        data: expect.objectContaining({
          name: 'memory',
          reason: 'heartbeat expired',
        }),
      }),
    ]))

    runtime.dispose()
  })

  it('de-announces extension modules before accepting a same-id reconnect', () => {
    const runtime = setupApp({ heartbeat: { readTimeout: 20_000 } })
    const handler = wsHandler()
    const observer = createPeer('observer')
    const firstModulePeer = createPeer('module-peer')
    const secondModulePeer = createPeer('module-peer')

    handler.open?.(observer.peer)
    handler.open?.(firstModulePeer.peer)
    sendEvent(handler, firstModulePeer.peer, createExtensionModuleAnnounceEvent())
    observer.sent.length = 0

    handler.open?.(secondModulePeer.peer)

    expect(decodeEvents(observer.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'extension:module:de-announced',
        data: expect.objectContaining({
          name: 'memory',
          reason: 'connection closed',
        }),
      }),
    ]))

    runtime.dispose()
  })

  it('closes each raw peer once during runtime disposal', () => {
    const runtime = setupApp({ heartbeat: { readTimeout: 20_000 } })
    const handler = wsHandler()
    const peer = createPeer('peer-1')

    handler.open?.(peer.peer)
    runtime.dispose()

    expect(peer.peer.close).toHaveBeenCalledOnce()
  })
})
