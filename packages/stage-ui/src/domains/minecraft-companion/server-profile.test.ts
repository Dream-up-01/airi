import { describe, expect, it } from 'vitest'

import { parseMinecraftConsentGrant, parseMinecraftServerProfile } from './index'

describe('minecraft server profile and consent schemas', () => {
  it('accepts an explicit third-party offline profile', () => {
    const result = parseMinecraftServerProfile({
      contractVersion: 'minecraft-companion/v1',
      serverProfileId: 'pcl-private-1',
      host: '127.0.0.1',
      port: 25565,
      minecraftVersion: '1.21.1',
      runtime: 'fabric',
      authMode: 'offline',
      serverKind: 'third-party',
      accountProfileId: 'airi-bot',
      allowVirtualPlayerJoin: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing explicit auth and account decisions', () => {
    const result = parseMinecraftServerProfile({
      contractVersion: 'minecraft-companion/v1',
      host: 'localhost',
      port: 25565,
    })
    expect(result.success).toBe(false)
  })

  it('requires a separate join grant and preserves revoked state', () => {
    const result = parseMinecraftConsentGrant({
      contractVersion: 'minecraft-agent-control/v1',
      grantId: 'grant-1',
      serverProfileId: 'pcl-private-1',
      allowVirtualPlayerJoin: true,
      allowedActionKinds: ['look-at', 'send-chat'],
      grantedAt: 1_000,
      showPersistentIndicator: true,
    })
    expect(result.success).toBe(true)
    expect(parseMinecraftConsentGrant({ ...(result.success ? result.output : {}), revokedAt: 2_000 }).success).toBe(true)
  })

  it('rejects chronologically invalid or over-broad auto-approval grants', () => {
    const base = {
      contractVersion: 'minecraft-agent-control/v1',
      grantId: 'grant-2',
      serverProfileId: 'pcl-private-1',
      allowVirtualPlayerJoin: true,
      allowedActionKinds: ['look-at', 'send-chat'],
      grantedAt: 2_000,
      showPersistentIndicator: true,
    }
    expect(parseMinecraftConsentGrant({ ...base, revokedAt: 1_999 }).success).toBe(false)
    expect(parseMinecraftConsentGrant({ ...base, autoApproveActionKinds: ['jump'] }).success).toBe(false)
  })
})
