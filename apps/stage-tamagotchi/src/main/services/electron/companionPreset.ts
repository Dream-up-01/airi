import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import { open, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { dialog } from 'electron'

import { electronCompanionPresetPickFile } from '../../../shared/eventa'

/** Keeps preset imports small enough for bounded decoding and Eventa transport. */
const MAX_PRESET_FILE_BYTES = 256 * 1024
const allowedExtensions = new Set(['.json', '.yaml', '.yml'])

/**
 * External boundaries required to select and read a companion preset file.
 */
export interface CompanionPresetFileReaderDependencies {
  /** Returns the selected absolute path, or `undefined` when cancelled. */
  pickFile: () => Promise<string | undefined>
  /** Reads at most `byteLimit` raw bytes after the extension has been accepted. */
  readFileBytes: (path: string, byteLimit: number) => Promise<Uint8Array>
  /** Reads the current file size before allocating its full content. */
  readFileSize: (path: string) => Promise<number>
}

/**
 * Normalizes decoded companion preset text.
 *
 * Before:
 * - `"\uFEFFschema_version: 1\r\n"`
 *
 * After:
 * - `"schema_version: 1\n"`
 */
function normalizePresetText(text: string): string {
  return text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
}

/**
 * Creates a constrained companion preset file reader.
 *
 * Use when:
 * - Electron main needs to return a user-selected YAML/JSON preset to a renderer.
 * - Tests need to verify file policy without opening native dialogs.
 *
 * Expects:
 * - The caller owns the native picker and filesystem implementation.
 * - Only `.json`, `.yaml`, and `.yml` files are accepted.
 *
 * Returns:
 * - A reader that returns a selected file, cancellation, or a stable error code.
 * - Expected filesystem and encoding failures never expose absolute paths.
 */
export function createCompanionPresetFileReader(dependencies: CompanionPresetFileReaderDependencies) {
  return async () => {
    const path = await dependencies.pickFile()
    if (!path)
      return { status: 'cancelled' as const }

    const extension = extname(path).toLowerCase()
    if (!allowedExtensions.has(extension))
      return { status: 'error' as const, error: 'unsupported_extension' as const }

    let fileSize: number
    try {
      fileSize = await dependencies.readFileSize(path)
    }
    catch {
      return { status: 'error' as const, error: 'stat_failed' as const }
    }
    if (fileSize > MAX_PRESET_FILE_BYTES)
      return { status: 'error' as const, error: 'file_too_large' as const }

    let bytes: Uint8Array
    try {
      // Read one byte beyond the accepted limit so a file that grows after
      // stat can be rejected without allocating its unbounded final size.
      bytes = await dependencies.readFileBytes(path, MAX_PRESET_FILE_BYTES + 1)
    }
    catch {
      return { status: 'error' as const, error: 'read_failed' as const }
    }
    if (bytes.byteLength > MAX_PRESET_FILE_BYTES)
      return { status: 'error' as const, error: 'file_changed_too_large' as const }

    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    catch {
      return { status: 'error' as const, error: 'invalid_utf8' as const }
    }

    return {
      status: 'selected' as const,
      file: {
        content: normalizePresetText(content),
        fileName: basename(path),
      },
    }
  }
}

/**
 * Registers the settings-window Eventa handler for companion preset selection.
 *
 * Use when:
 * - Wiring the Electron settings window RPC surface.
 *
 * Expects:
 * - The Eventa context targets the settings BrowserWindow.
 *
 * Returns:
 * - The Eventa handler cleanup function.
 */
export function createCompanionPresetFileService(params: {
  context: ReturnType<typeof createContext>['context']
  window: BrowserWindow
}) {
  async function readBoundedFile(path: string, byteLimit: number): Promise<Uint8Array> {
    const handle = await open(path, 'r')
    try {
      const bytes = new Uint8Array(byteLimit)
      let offset = 0
      while (offset < byteLimit) {
        // Regular file reads may return fewer bytes than requested, so keep
        // filling the fixed allocation until EOF or the hard boundary.
        const result = await handle.read(bytes, offset, byteLimit - offset, offset)
        if (result.bytesRead === 0)
          break
        offset += result.bytesRead
      }
      return bytes.subarray(0, offset)
    }
    finally {
      await handle.close()
    }
  }

  const pickAndRead = createCompanionPresetFileReader({
    pickFile: async () => {
      const result = await dialog.showOpenDialog(params.window, {
        properties: ['openFile'],
        filters: [
          { name: 'AIRI Companion Preset', extensions: ['yaml', 'yml', 'json'] },
        ],
      })
      return result.canceled ? undefined : result.filePaths[0]
    },
    readFileBytes: readBoundedFile,
    readFileSize: async path => (await stat(path)).size,
  })

  return defineInvokeHandler(params.context, electronCompanionPresetPickFile, pickAndRead)
}
