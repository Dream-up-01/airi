import type { MinecraftConsentGrant, MinecraftServerProfile } from './contracts'

export function canJoinMinecraftServer(profile: MinecraftServerProfile, grant: MinecraftConsentGrant): boolean {
  return profile.serverProfileId === grant.serverProfileId
    && profile.allowVirtualPlayerJoin
    && grant.allowVirtualPlayerJoin
    && grant.revokedAt === undefined
}

export function isMinecraftConsentActive(grant: MinecraftConsentGrant, now: number): boolean {
  return grant.grantedAt <= now && grant.revokedAt === undefined
}
