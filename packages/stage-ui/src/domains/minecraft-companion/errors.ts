import type { MinecraftStableErrorCode } from './contracts'

import { minecraftStableErrorCodes } from './contracts'

export class MinecraftCompanionError extends Error {
  readonly code: MinecraftStableErrorCode

  constructor(code: MinecraftStableErrorCode) {
    super(code)
    this.name = 'MinecraftCompanionError'
    this.code = code
  }
}

export function isMinecraftStableErrorCode(value: string): value is MinecraftStableErrorCode {
  return (minecraftStableErrorCodes as readonly string[]).includes(value)
}
