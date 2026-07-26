import type { MinecraftPairedDevice, MinecraftPairingRequest } from '../../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useIntervalFn } from '@vueuse/core'
import { onScopeDispose, shallowRef } from 'vue'

import {
  electronApproveMinecraftPairing,
  electronListMinecraftPairedDevices,
  electronListMinecraftPairingRequests,
  electronRejectMinecraftPairing,
  electronRevokeMinecraftPairedDevice,
} from '../../../shared/eventa'

export function useMinecraftPairing() {
  const requests = shallowRef<readonly MinecraftPairingRequest[]>([])
  const devices = shallowRef<readonly MinecraftPairedDevice[]>([])
  const error = shallowRef<string>()
  let refreshing = false

  const listRequests = useElectronEventaInvoke(electronListMinecraftPairingRequests)
  const listDevices = useElectronEventaInvoke(electronListMinecraftPairedDevices)
  const approveRequest = useElectronEventaInvoke(electronApproveMinecraftPairing)
  const rejectRequest = useElectronEventaInvoke(electronRejectMinecraftPairing)
  const revokeDevice = useElectronEventaInvoke(electronRevokeMinecraftPairedDevice)

  async function refresh() {
    if (refreshing)
      return
    refreshing = true
    try {
      const [nextRequests, nextDevices] = await Promise.all([listRequests(), listDevices()])
      requests.value = nextRequests
      devices.value = nextDevices
      error.value = undefined
    }
    catch (cause) {
      error.value = errorMessageFrom(cause) ?? 'pairing-unavailable'
    }
    finally {
      refreshing = false
    }
  }

  async function approve(requestId: string) {
    await approveRequest({ requestId })
    await refresh()
  }

  async function reject(requestId: string) {
    await rejectRequest({ requestId })
    await refresh()
  }

  async function revoke(deviceId: string) {
    await revokeDevice({ deviceId })
    await refresh()
  }

  const polling = useIntervalFn(() => void refresh(), 1_000, { immediate: true })
  onScopeDispose(() => polling.pause())

  return { requests, devices, error, refresh, approve, reject, revoke }
}
