import type {
  ModulePairingApprovalRequest,
  ModulePairingIdentity,
  ModulePairingProvider,
} from '@proj-airi/server-runtime'

import type {
  MinecraftPairedDevice,
  MinecraftPairingRequest,
} from '../../../../shared/eventa'

import { createHash } from 'node:crypto'

import { array, number, object, string } from 'valibot'

import { createConfig } from '../../../libs/electron/persistence'

interface PersistedMinecraftPairingDevice extends MinecraftPairedDevice {
  publicKey: string
}

interface PendingApproval {
  request: MinecraftPairingRequest
  publicKey: string
  resolve: (approved: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

const pairingStoreSchema = object({
  devices: array(object({
    deviceId: string(),
    displayName: string(),
    clientVersion: string(),
    fingerprint: string(),
    publicKey: string(),
    pairedAt: number(),
  })),
})

function publicKeyFingerprint(publicKey: string): string {
  return createHash('sha256').update(publicKey, 'utf8').digest('hex').slice(0, 16)
}

export class MinecraftPairingManager implements ModulePairingProvider {
  private readonly store = createConfig('minecraft-pairing', 'devices.json', pairingStoreSchema, {
    default: { devices: [] },
    autoHeal: true,
  })

  private readonly pending = new Map<string, PendingApproval>()
  private readonly revocationListeners = new Set<(deviceId: string) => void>()

  setup(): void {
    this.store.setup()
  }

  isPaired(identity: ModulePairingIdentity): boolean {
    return this.devices().some(device => device.deviceId === identity.deviceId && device.publicKey === identity.publicKey)
  }

  requestApproval(request: ModulePairingApprovalRequest): Promise<boolean> {
    const existing = this.pending.get(request.requestId)
    if (existing)
      return Promise.resolve(false)

    return new Promise<boolean>((resolve) => {
      const delay = Math.max(0, request.expiresAt - Date.now())
      const timer = setTimeout(() => this.resolvePending(request.requestId, false), delay)
      timer.unref?.()
      this.pending.set(request.requestId, {
        request: {
          requestId: request.requestId,
          deviceId: request.deviceId,
          displayName: request.displayName,
          clientVersion: request.clientVersion,
          verificationCode: request.verificationCode,
          expiresAt: request.expiresAt,
        },
        publicKey: request.publicKey,
        resolve,
        timer,
      })
    })
  }

  remember(identity: ModulePairingIdentity): void {
    const devices = this.devices().filter(device => device.deviceId !== identity.deviceId)
    devices.push({
      deviceId: identity.deviceId,
      displayName: identity.displayName,
      clientVersion: identity.clientVersion,
      fingerprint: publicKeyFingerprint(identity.publicKey),
      publicKey: identity.publicKey,
      pairedAt: Date.now(),
    })
    this.store.update({ devices })
  }

  listRequests(): MinecraftPairingRequest[] {
    const now = Date.now()
    return [...this.pending.values()]
      .map(entry => entry.request)
      .filter(request => request.expiresAt > now)
      .sort((left, right) => left.expiresAt - right.expiresAt)
  }

  approve(requestId: string): boolean {
    return this.resolvePending(requestId, true)
  }

  reject(requestId: string): boolean {
    return this.resolvePending(requestId, false)
  }

  cancelApproval(requestId: string): void {
    this.resolvePending(requestId, false)
  }

  listDevices(): MinecraftPairedDevice[] {
    return this.devices().map(({ publicKey: _publicKey, ...device }) => device)
  }

  revoke(deviceId: string): boolean {
    const devices = this.devices()
    const next = devices.filter(device => device.deviceId !== deviceId)
    if (next.length === devices.length)
      return false
    this.store.update({ devices: next })
    for (const listener of this.revocationListeners)
      listener(deviceId)
    return true
  }

  subscribeRevocations(listener: (deviceId: string) => void): () => void {
    this.revocationListeners.add(listener)
    return () => this.revocationListeners.delete(listener)
  }

  dispose(): void {
    for (const requestId of this.pending.keys())
      this.resolvePending(requestId, false)
    this.revocationListeners.clear()
  }

  private devices(): PersistedMinecraftPairingDevice[] {
    return [...(this.store.get()?.devices ?? [])]
  }

  private resolvePending(requestId: string, approved: boolean): boolean {
    const entry = this.pending.get(requestId)
    if (!entry)
      return false
    this.pending.delete(requestId)
    clearTimeout(entry.timer)
    entry.resolve(approved)
    return true
  }
}
