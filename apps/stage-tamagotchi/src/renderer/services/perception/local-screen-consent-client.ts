import type { PerceptionConsentGrant } from '@proj-airi/stage-ui/domains/perception'

import type {
  LocalScreenCaptureExclusionRequest,
  LocalScreenConsentRegisterRequest,
  LocalScreenConsentRevokeRequest,
  LocalScreenConsentSnapshot,
} from '../../../shared/eventa/perception-local-screen-consent'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'

import {
  electronLocalScreenCaptureExclusion,
  electronLocalScreenConsentRegister,
  electronLocalScreenConsentRevoke,
  LOCAL_SCREEN_CONSENT_VERSION,
  parseLocalScreenCaptureExclusionStatus,
  parseLocalScreenConsentSnapshot,
} from '../../../shared/eventa/perception-local-screen-consent'

export interface LocalScreenConsentInvocations {
  register: (request: LocalScreenConsentRegisterRequest, options?: { signal?: AbortSignal }) => Promise<LocalScreenConsentSnapshot>
  revoke: (request: LocalScreenConsentRevokeRequest, options?: { signal?: AbortSignal }) => Promise<LocalScreenConsentSnapshot>
  setCaptureExclusion: (request: LocalScreenCaptureExclusionRequest, options?: { signal?: AbortSignal }) => Promise<unknown>
}

export class LocalScreenConsentClient {
  readonly #invocations: LocalScreenConsentInvocations

  constructor(invocations: LocalScreenConsentInvocations = createElectronInvocations()) {
    this.#invocations = invocations
  }

  async register(
    sessionId: string,
    generation: number,
    grant: PerceptionConsentGrant,
    signal?: AbortSignal,
  ): Promise<LocalScreenConsentSnapshot> {
    const response = await this.#invocations.register({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId,
      generation,
      grant,
    }, { signal })
    return parseSnapshot(response)
  }

  async revoke(
    sessionId: string,
    generation: number,
    grantId: string,
    reason: LocalScreenConsentRevokeRequest['reason'],
    signal?: AbortSignal,
  ): Promise<LocalScreenConsentSnapshot> {
    const response = await this.#invocations.revoke({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId,
      generation,
      grantId,
      reason,
    }, { signal })
    return parseSnapshot(response)
  }

  async setCaptureExclusion(
    sessionId: string,
    generation: number,
    grantId: string,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.#invocations.setCaptureExclusion({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId,
      generation,
      grantId,
      enabled,
    }, { signal })
    const parsed = parseLocalScreenCaptureExclusionStatus(response)
    if (!parsed.ok || parsed.value.enabled !== enabled)
      throw new Error('local_screen_capture_exclusion_failed')
  }
}

function createElectronInvocations(): LocalScreenConsentInvocations {
  const { context } = createContext(window.electron.ipcRenderer)
  return {
    setCaptureExclusion: defineInvoke(context, electronLocalScreenCaptureExclusion),
    register: defineInvoke(context, electronLocalScreenConsentRegister),
    revoke: defineInvoke(context, electronLocalScreenConsentRevoke),
  }
}

function parseSnapshot(input: unknown): LocalScreenConsentSnapshot {
  const parsed = parseLocalScreenConsentSnapshot(input)
  if (!parsed.ok)
    throw new Error('local_screen_consent_response_invalid')
  return parsed.value
}
