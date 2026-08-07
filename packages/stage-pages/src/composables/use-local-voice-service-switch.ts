import type {
  LocalVoiceServiceId,
  LocalVoiceServiceStopResult,
} from '@proj-airi/stage-ui/domains/localVoiceServices'
import type {
  VoiceRuntimeQuiesceReason,
  VoiceRuntimeQuiesceResult,
} from '@proj-airi/stage-ui/services/voice-runtime-quiesce'

import { requestVoiceRuntimeQuiesce } from '@proj-airi/stage-ui/services/voice-runtime-quiesce'
import {
  GPT_SOVITS_LOCAL_DEFAULT_BASE_URL,
  QWEN3_ASR_LOCAL_DEFAULT_BASE_URL,
  SENSEVOICE_LOCAL_DEFAULT_BASE_URL,
} from '@proj-airi/stage-ui/stores/providers'
import { normalizeGptSovitsLocalBaseUrl } from '@proj-airi/stage-ui/stores/providers/gpt-sovits-local'
import { normalizeQwen3AsrLocalBaseUrl } from '@proj-airi/stage-ui/stores/providers/qwen3-asr-local'
import { normalizeSenseVoiceLocalBaseUrl } from '@proj-airi/stage-ui/stores/providers/sensevoice-local'

import { stopLocalVoiceService } from './use-local-voice-service-start'

export type LocalVoiceServiceSwitchNoticeCode = 'previous-service-not-managed' | 'previous-service-stop-failed'

export interface LocalVoiceServiceSwitchResult {
  ok: boolean
  noticeCode?: LocalVoiceServiceSwitchNoticeCode
}

export interface VoiceRuntimeQuiesceSwitchResult {
  ok: boolean
  /** True when no Stage owner acknowledged within the bounded wait. */
  timedOut: boolean
}

function isLoopbackHost(hostname: string) {
  return hostname === '127.0.0.1'
    || hostname === 'localhost'
    || hostname === '::1'
    || hostname === '[::1]'
}

function isEquivalentLoopbackEndpoint(actual: string | undefined, expected: string) {
  if (!actual)
    return false

  try {
    const actualUrl = new URL(actual)
    const expectedUrl = new URL(expected)
    const hostsMatch = actualUrl.hostname === expectedUrl.hostname
      || (isLoopbackHost(actualUrl.hostname) && isLoopbackHost(expectedUrl.hostname))
    return hostsMatch
      && actualUrl.protocol === expectedUrl.protocol
      && actualUrl.port === expectedUrl.port
      && actualUrl.pathname === expectedUrl.pathname
  }
  catch {
    return false
  }
}

/**
 * Only the AIRI-default loopback endpoints are owned by the Electron launcher.
 * A user-selected loopback endpoint may be another process and must never be
 * started or stopped as if it were AIRI-managed.
 */
export function isManagedLocalVoiceServiceEndpoint(serviceId: LocalVoiceServiceId, baseUrl: unknown) {
  if (serviceId === 'gpt-sovits')
    return isEquivalentLoopbackEndpoint(normalizeGptSovitsLocalBaseUrl(baseUrl), GPT_SOVITS_LOCAL_DEFAULT_BASE_URL)
  if (serviceId === 'qwen3-asr')
    return isEquivalentLoopbackEndpoint(normalizeQwen3AsrLocalBaseUrl(baseUrl), QWEN3_ASR_LOCAL_DEFAULT_BASE_URL)
  if (serviceId === 'sensevoice')
    return isEquivalentLoopbackEndpoint(normalizeSenseVoiceLocalBaseUrl(baseUrl), SENSEVOICE_LOCAL_DEFAULT_BASE_URL)
  return false
}

interface QuiesceVoiceRuntimeForSwitchOptions {
  reason: VoiceRuntimeQuiesceReason
  requestQuiesce?: (reason: VoiceRuntimeQuiesceReason) => Promise<VoiceRuntimeQuiesceResult>
}

interface StopAndDisposePreviousVoiceServiceOptions {
  previousProviderId?: string
  nextProviderId: string
  serviceIdForProvider: (providerId: string) => LocalVoiceServiceId | undefined
  stopService?: (serviceId: LocalVoiceServiceId) => Promise<LocalVoiceServiceStopResult>
  disposeProvider?: (providerId: string) => Promise<void>
}

/**
 * Requests cancellation of the active Stage voice runtime before settings are
 * published. A missing Stage owner is treated as a bounded timeout so that a
 * standalone settings page remains usable; an explicit failed acknowledgement
 * blocks the caller from publishing a potentially stale provider selection.
 */
export async function quiesceVoiceRuntimeForSwitch(
  options: QuiesceVoiceRuntimeForSwitchOptions,
): Promise<VoiceRuntimeQuiesceSwitchResult> {
  const result = await (options.requestQuiesce ?? requestVoiceRuntimeQuiesce)(options.reason)
  return {
    ok: result.status === 'quiesced',
    timedOut: result.status === 'timed-out',
  }
}

/**
 * Ends the old voice provider before any new provider is started or published.
 *
 * An unmanaged service is reported as a notice because AIRI cannot terminate
 * a process it did not start. A managed stop failure blocks the switch: the
 * caller must not start another service while the old one may still own its
 * endpoint.
 */
export async function stopAndDisposePreviousVoiceService(
  options: StopAndDisposePreviousVoiceServiceOptions,
): Promise<LocalVoiceServiceSwitchResult> {
  const {
    previousProviderId,
    nextProviderId,
    serviceIdForProvider,
    stopService = stopLocalVoiceService,
    disposeProvider,
  } = options

  if (!previousProviderId || previousProviderId === nextProviderId)
    return { ok: true }

  const previousServiceId = serviceIdForProvider(previousProviderId)
  let noticeCode: LocalVoiceServiceSwitchNoticeCode | undefined

  if (previousServiceId) {
    const stopResult = await stopService(previousServiceId)
    if (!stopResult.ok)
      return { ok: false, noticeCode: 'previous-service-stop-failed' }
    if (!stopResult.stopped)
      noticeCode = 'previous-service-not-managed'
  }

  await disposeProvider?.(previousProviderId)
  return { ok: true, noticeCode }
}
