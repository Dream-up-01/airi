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

import { useLogg } from '@guiiai/logg'
import { array, number, object, string } from 'valibot'

import { createConfig } from '../../../libs/electron/persistence'

/**
 * Non-sensitive projection of a pending pairing request, handed to approval
 * surfaces that live outside any renderer window.
 *
 * The device public key is deliberately absent: out-of-band surfaces only need
 * to identify the request and let the user compare the verification code.
 */
export interface MinecraftPairingNotice {
  /** Correlates the notice with `approve`, `reject` and `cancelApproval`. */
  requestId: string
  /** Mod-reported device label, shown to the user as-is. */
  displayName: string
  /** Short code the user compares against the code shown inside the game. */
  verificationCode: string
  /** Epoch milliseconds after which the request rejects itself. */
  expiresAt: number
}

/**
 * Out-of-band notification port for pairing approvals.
 *
 * Implementations run outside any renderer window so a pairing request stays
 * actionable when the perception panel is closed. Every callback is treated as
 * best-effort: throwing must never stall the pairing state machine.
 */
export interface MinecraftPairingNotifier {
  /** Invoked once per newly registered pending request. */
  onRequested: (notice: MinecraftPairingNotice) => void
  /** Invoked once when a pending request is approved, rejected or expires. */
  onResolved?: (requestId: string) => void
}

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
  private readonly log = useLogg('minecraft-pairing').useGlobalConfig()
  private notifier?: MinecraftPairingNotifier

  constructor(params: {
    /** Out-of-band approval surface, when one is available at construction time. */
    notifier?: MinecraftPairingNotifier
  } = {}) {
    this.notifier = params.notifier
  }

  setup(): void {
    this.store.setup()
  }

  /**
   * Attaches (or clears) the out-of-band approval surface after construction.
   *
   * Use when:
   * - The notifier depends on collaborators that only exist later in the
   *   application composition, such as the settings window manager
   *
   * Expects:
   * - At most one notifier at a time; a later call replaces the previous port
   */
  setNotifier(notifier: MinecraftPairingNotifier | undefined): void {
    this.notifier = notifier
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
      const pendingRequest: MinecraftPairingRequest = {
        requestId: request.requestId,
        deviceId: request.deviceId,
        displayName: request.displayName,
        clientVersion: request.clientVersion,
        verificationCode: request.verificationCode,
        expiresAt: request.expiresAt,
      }
      this.pending.set(request.requestId, {
        request: pendingRequest,
        publicKey: request.publicKey,
        resolve,
        timer,
      })

      // Announce only after the request is pending, so an approval triggered
      // synchronously from the notification still finds it in `pending`.
      this.notifyRequested(pendingRequest)
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
    this.notifyResolved(requestId)
    return true
  }

  /**
   * Hands a pending request to the out-of-band approval surface.
   *
   * The notifier is untrusted infrastructure (OS notification centre), so a
   * failure is logged and swallowed instead of leaking into the pairing state
   * machine, which the Fabric mod treats as terminal.
   */
  private notifyRequested(request: MinecraftPairingRequest): void {
    if (!this.notifier)
      return

    try {
      this.notifier.onRequested({
        requestId: request.requestId,
        displayName: request.displayName,
        verificationCode: request.verificationCode,
        expiresAt: request.expiresAt,
      })
    }
    catch (error) {
      this.log.withError(error).warn(`Failed to announce Minecraft pairing request ${request.requestId}`)
    }
  }

  /** Lets the out-of-band surface withdraw a notice whose request is no longer actionable. */
  private notifyResolved(requestId: string): void {
    if (!this.notifier?.onResolved)
      return

    try {
      this.notifier.onResolved(requestId)
    }
    catch (error) {
      this.log.withError(error).warn(`Failed to withdraw the Minecraft pairing notice for ${requestId}`)
    }
  }
}
