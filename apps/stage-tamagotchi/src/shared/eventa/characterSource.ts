import type { CharacterSourceFileErrorCode } from '@proj-airi/stage-ui/composables/characterSourceFileReader'

import { defineInvokeEventa } from '@moeru/eventa'

/** UTF-8 source document returned without an absolute filesystem path. */
export interface ElectronCharacterSourceFile {
  /** SHA-256 digest calculated by Electron main from the selected bytes. */
  contentHash: string
  /** Strictly decoded UTF-8 source text. */
  content: string
  /** Basename only, suitable for display. */
  fileName: string
  /** Trusted format hint derived from the accepted extension. */
  format: 'docx' | 'json' | 'md' | 'plain-text' | 'txt' | 'yaml'
}

/** Stable platform failures that never include a machine-local path. */
export type ElectronCharacterSourceFileErrorCode = CharacterSourceFileErrorCode

/** Result of one request-scoped native source-file selection. */
export type ElectronCharacterSourcePickResult
  = | { status: 'cancelled' }
    | { error: ElectronCharacterSourceFileErrorCode, status: 'error' }
    | { file: ElectronCharacterSourceFile, status: 'selected' }

export interface ElectronCharacterSourceRequest {
  /** Renderer-owned correlation ID used to cancel and reject stale work. */
  requestId: string
}

export const electronCharacterSourcePickFile = defineInvokeEventa<ElectronCharacterSourcePickResult, ElectronCharacterSourceRequest>('eventa:invoke:electron:character-source:pick-file')
export const electronCharacterSourceCancel = defineInvokeEventa<void, ElectronCharacterSourceRequest>('eventa:invoke:electron:character-source:cancel')
