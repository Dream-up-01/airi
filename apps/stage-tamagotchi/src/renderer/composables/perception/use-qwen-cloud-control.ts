import type { ComputedRef, InjectionKey } from 'vue'

import type { QwenCloudControlStatus } from '../../../shared/eventa/perception-cloud'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { computed, inject, onMounted, provide, shallowRef } from 'vue'

import {
  electronQwenCloudControlStatus,
  electronQwenCloudControlStop,
  electronQwenCloudControlValidate,
  parseQwenCloudControlStatus,
  QWEN_CLOUD_CONTROL_VERSION,
} from '../../../shared/eventa/perception-cloud'

export interface QwenCloudControlContext {
  status: ComputedRef<QwenCloudControlStatus | null>
  isLoading: ComputedRef<boolean>
  lastErrorCode: ComputedRef<string | undefined>
  refresh: () => Promise<void>
  validate: () => Promise<void>
  stop: () => Promise<void>
}

const qwenCloudControlKey: InjectionKey<QwenCloudControlContext> = Symbol('qwen-cloud-control')

export function provideQwenCloudControl(): QwenCloudControlContext {
  const invokeStatus = useElectronEventaInvoke(electronQwenCloudControlStatus)
  const invokeValidate = useElectronEventaInvoke(electronQwenCloudControlValidate)
  const invokeStop = useElectronEventaInvoke(electronQwenCloudControlStop)
  const status = shallowRef<QwenCloudControlStatus | null>(null)
  const isLoading = shallowRef(false)
  const lastErrorCode = shallowRef<string>()

  async function run(action: typeof invokeStatus): Promise<void> {
    if (isLoading.value)
      return
    isLoading.value = true
    lastErrorCode.value = undefined
    const requestId = `cloud-control:${crypto.randomUUID()}`
    try {
      const response = await action({ contractVersion: QWEN_CLOUD_CONTROL_VERSION, requestId })
      const parsed = parseQwenCloudControlStatus(response)
      if (!parsed.ok || parsed.value.requestId !== requestId)
        throw new Error('cloud-control-invalid-response')
      status.value = parsed.value
    }
    catch {
      lastErrorCode.value = 'cloud-control-unavailable'
    }
    finally {
      isLoading.value = false
    }
  }

  const context: QwenCloudControlContext = {
    status: computed(() => status.value),
    isLoading: computed(() => isLoading.value),
    lastErrorCode: computed(() => lastErrorCode.value),
    refresh: () => run(invokeStatus),
    validate: () => run(invokeValidate),
    stop: () => run(invokeStop),
  }
  provide(qwenCloudControlKey, context)
  onMounted(() => void context.refresh())
  return context
}

export function useQwenCloudControl(): QwenCloudControlContext {
  const context = inject(qwenCloudControlKey)
  if (!context)
    throw new Error('qwen_cloud_control_not_provided')
  return context
}
