import type {
  LocalVoiceServiceId,
  LocalVoiceServiceStartResult,
  LocalVoiceServiceStopResult,
} from '@proj-airi/stage-ui/domains/localVoiceServices'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { electronStartLocalVoiceService, electronStopLocalVoiceService } from '@proj-airi/stage-ui/domains/localVoiceServices'

function getElectronIpcRenderer() {
  return (window as Window & {
    electron?: { ipcRenderer?: unknown }
  }).electron?.ipcRenderer
}

export async function startLocalVoiceService(
  serviceId: LocalVoiceServiceId,
): Promise<LocalVoiceServiceStartResult> {
  if (typeof window === 'undefined' || !isStageTamagotchi())
    return { ok: false, serviceId, errorCode: 'desktop_required' }

  const ipcRenderer = getElectronIpcRenderer()
  if (!ipcRenderer)
    return { ok: false, serviceId, errorCode: 'desktop_required' }

  const { context, dispose } = createContext(ipcRenderer as Parameters<typeof createContext>[0])
  try {
    const invokeStart = defineInvoke(context, electronStartLocalVoiceService)
    return await invokeStart({ serviceId })
  }
  catch {
    return { ok: false, serviceId, errorCode: 'launch_failed' }
  }
  finally {
    dispose('local-voice-service-start-complete')
  }
}

export async function stopLocalVoiceService(
  serviceId: LocalVoiceServiceId,
): Promise<LocalVoiceServiceStopResult> {
  if (typeof window === 'undefined' || !isStageTamagotchi())
    return { ok: false, serviceId, errorCode: 'desktop_required' }

  const ipcRenderer = getElectronIpcRenderer()
  if (!ipcRenderer)
    return { ok: false, serviceId, errorCode: 'desktop_required' }

  const { context, dispose } = createContext(ipcRenderer as Parameters<typeof createContext>[0])
  try {
    const invokeStop = defineInvoke(context, electronStopLocalVoiceService)
    return await invokeStop({ serviceId })
  }
  catch {
    return { ok: false, serviceId, errorCode: 'stop_failed' }
  }
  finally {
    dispose('local-voice-service-stop-complete')
  }
}
