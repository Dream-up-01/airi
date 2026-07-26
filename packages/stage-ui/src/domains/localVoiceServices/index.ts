import { defineInvokeEventa } from '@moeru/eventa'

export const localVoiceServiceIds = ['gpt-sovits', 'qwen3-asr', 'sensevoice'] as const

export type LocalVoiceServiceId = typeof localVoiceServiceIds[number]

export type LocalVoiceServiceStartErrorCode
  = | 'desktop_required'
    | 'launcher_missing'
    | 'launch_failed'
    | 'startup_timeout'
    | 'app_stopping'

export type LocalVoiceServiceStartResult
  = | {
    ok: true
    serviceId: LocalVoiceServiceId
    alreadyRunning: boolean
  }
  | {
    ok: false
    serviceId: LocalVoiceServiceId
    errorCode: LocalVoiceServiceStartErrorCode
  }

export type LocalVoiceServiceStopResult
  = | {
    ok: true
    serviceId: LocalVoiceServiceId
    stopped: boolean
  }
  | {
    ok: false
    serviceId: LocalVoiceServiceId
    errorCode: 'desktop_required' | 'stop_failed'
  }

export const electronStartLocalVoiceService = defineInvokeEventa<
  LocalVoiceServiceStartResult,
  { serviceId: LocalVoiceServiceId }
>('eventa:invoke:electron:local-voice-service:start')

export const electronStopLocalVoiceService = defineInvokeEventa<
  LocalVoiceServiceStopResult,
  { serviceId: LocalVoiceServiceId }
>('eventa:invoke:electron:local-voice-service:stop')

export function isLocalVoiceServiceId(value: unknown): value is LocalVoiceServiceId {
  return typeof value === 'string' && localVoiceServiceIds.includes(value as LocalVoiceServiceId)
}
