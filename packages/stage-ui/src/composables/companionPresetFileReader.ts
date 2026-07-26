import type { InjectionKey } from 'vue'

import { inject, provide } from 'vue'

/**
 * Parsed companion preset returned by a platform file adapter.
 */
export interface ParsedCompanionPresetFile {
  /** Sanitized basename suitable for display. */
  sourceName: string
  /** Untrusted parsed YAML/JSON value awaiting domain validation. */
  value: unknown
}

/** Stable, localizable failures produced by a platform preset file adapter. */
export type CompanionPresetImportErrorCode
  = | 'file_changed_too_large'
    | 'file_too_large'
    | 'invalid_format'
    | 'invalid_utf8'
    | 'read_failed'
    | 'stat_failed'
    | 'unknown'
    | 'unsupported_extension'

/**
 * Error raised by platform adapters without exposing paths or parser internals.
 *
 * Use when:
 * - A platform file boundary needs to expose a stable localizable failure.
 *
 * Expects:
 * - `code` contains no raw path, parser detail, or user file content.
 *
 * Returns:
 * - An Error carrying only the stable import error code.
 */
export class CompanionPresetImportError extends Error {
  constructor(public readonly code: CompanionPresetImportErrorCode) {
    super(`Companion preset import failed: ${code}`)
    this.name = 'CompanionPresetImportError'
  }
}

/**
 * Platform adapter used by shared Stage pages to request a companion preset.
 */
export interface CompanionPresetFileReader {
  /** Opens the platform picker and parses the selected file, or returns undefined on cancel. */
  pickAndParse: () => Promise<ParsedCompanionPresetFile | undefined>
}

const companionPresetFileReaderKey: InjectionKey<CompanionPresetFileReader> = Symbol('companion-preset-file-reader')

/**
 * Provides a platform-specific companion preset file reader.
 *
 * Use when:
 * - Desktop wires Eventa/Electron file access into shared Stage pages.
 * - Another platform has an equivalent safe picker and parser.
 *
 * Expects:
 * - The adapter does not expose absolute paths or credentials.
 *
 * Returns:
 * - Nothing; descendants access the adapter through `useCompanionPresetFileReader`.
 */
export function provideCompanionPresetFileReader(reader: CompanionPresetFileReader): void {
  provide(companionPresetFileReaderKey, reader)
}

/**
 * Reads the platform companion preset file adapter when available.
 *
 * Use when:
 * - A shared component should render import UI only on supported platforms.
 *
 * Expects:
 * - A parent may omit the provider on unsupported platforms.
 *
 * Returns:
 * - The adapter or `undefined` when the platform does not support safe import.
 */
export function useCompanionPresetFileReader(): CompanionPresetFileReader | undefined {
  return inject(companionPresetFileReaderKey, undefined)
}
