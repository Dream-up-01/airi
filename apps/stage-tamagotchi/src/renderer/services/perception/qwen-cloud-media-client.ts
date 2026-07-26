import type { PerceptionConsentGrant } from '@proj-airi/stage-ui/domains/perception'

import type {
  PerceptionMediaCompletedResult,
  PerceptionMediaTransportAck,
  PerceptionMediaTransportMessage,
} from '../../../shared/eventa/perception'

import { defineInvoke, defineStreamInvoke } from '@moeru/eventa'
import { getElectronEventaContext } from '@proj-airi/electron-vueuse'

import {
  electronPerceptionMediaStream,
  parsePerceptionMediaTransportAck,
} from '../../../shared/eventa/perception'
import {
  electronQwenCloudGrantRegister,
  electronQwenCloudGrantRevoke,
  parseQwenCloudGrantSnapshot,
  QWEN_CLOUD_GRANT_VERSION,
} from '../../../shared/eventa/perception-cloud'

export interface QwenCloudMediaClientRun {
  sessionId: string
  generation: number
  windowId: string
  frameGrant: PerceptionConsentGrant
  audioGrant: PerceptionConsentGrant
  messages: ReadableStream<PerceptionMediaTransportMessage>
  signal: AbortSignal
  onAck?: (ack: PerceptionMediaTransportAck) => void
}

export class QwenCloudMediaClient {
  readonly #register: CloudMediaInvokes['register']
  readonly #revoke: CloudMediaInvokes['revoke']
  readonly #stream: CloudMediaInvokes['stream']

  constructor(context = getElectronEventaContext()) {
    const invokes = createInvokes(context)
    this.#register = invokes.register
    this.#revoke = invokes.revoke
    this.#stream = invokes.stream
  }

  async run(input: QwenCloudMediaClientRun): Promise<PerceptionMediaCompletedResult> {
    validateRun(input)
    const registered: string[] = []
    try {
      for (const grant of [input.frameGrant, input.audioGrant]) {
        const snapshot = await this.#register({
          contractVersion: QWEN_CLOUD_GRANT_VERSION,
          sessionId: input.sessionId,
          generation: input.generation,
          grant,
        }, { signal: input.signal })
        const parsed = parseQwenCloudGrantSnapshot(snapshot)
        if (!parsed.ok || !parsed.value.activeGrantIds.includes(grant.grantId))
          throw new Error('cloud-consent-registration-failed')
        registered.push(grant.grantId)
      }

      let completed: PerceptionMediaCompletedResult | undefined
      const responses = this.#stream(input.messages, { signal: input.signal })
      for await (const raw of responses) {
        const parsed = parsePerceptionMediaTransportAck(raw)
        if (!parsed.ok)
          throw new Error('cloud-media-response-invalid')
        const ack = parsed.value
        if (ack.sessionId !== input.sessionId || ack.generation !== input.generation || ack.windowId !== input.windowId)
          throw new Error('cloud-media-response-stale')
        input.onAck?.(ack)
        if (ack.type === 'rejected')
          throw new Error(`cloud-media-${ack.errorCode}`)
        if (ack.type === 'completed')
          completed = ack.result
      }
      if (!completed)
        throw new Error('cloud-media-response-incomplete')
      return completed
    }
    finally {
      input.messages.cancel('cloud-media-finished').catch(() => undefined)
      for (const grantId of registered.reverse()) {
        await this.#revoke({
          contractVersion: QWEN_CLOUD_GRANT_VERSION,
          sessionId: input.sessionId,
          generation: input.generation,
          grantId,
          reason: input.signal.aborted ? 'permission-revoked' : 'user-stop',
        }).catch(() => undefined)
      }
    }
  }
}

function createInvokes(context: ReturnType<typeof getElectronEventaContext>) {
  return {
    register: defineInvoke(context, electronQwenCloudGrantRegister),
    revoke: defineInvoke(context, electronQwenCloudGrantRevoke),
    stream: defineStreamInvoke(context, electronPerceptionMediaStream),
  }
}

type CloudMediaInvokes = ReturnType<typeof createInvokes>

function validateRun(input: QwenCloudMediaClientRun): void {
  if (!input.sessionId || !input.windowId || !Number.isInteger(input.generation) || input.generation < 1)
    throw new Error('cloud-media-run-invalid')
  if (input.frameGrant.grantId === input.audioGrant.grantId
    || input.frameGrant.allowedModalities.length !== 1
    || input.audioGrant.allowedModalities.length !== 1
    || input.audioGrant.allowedModalities[0] !== 'microphone-audio') {
    throw new Error('cloud-media-consent-invalid')
  }
}
